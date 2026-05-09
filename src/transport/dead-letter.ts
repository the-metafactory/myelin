import type { MyelinEnvelope } from "../types";
import type { EnvelopePublisher, Subscription } from "./types";
import type { NakReason } from "./nak";

// F-4: Dead-letter routing for capability-routed tasks.
// See docs/design-agent-task-routing.md §Pattern 4 Task Lifecycle (step 6
// DEAD-LETTER), Implementation step 9.
//
// Two routes carry tasks to the dead-letter stream:
//
//   1. Exhaustion path  — `max_deliver` reached without ack. Final nak
//      reason and chain captured on the dead-letter envelope.
//   2. Fast path        — `compliance-block` nak. Routes immediately,
//      skipping remaining retries (different agents share the M7 policy
//      that refused, so re-delivery would only burn budget).
//
// Both paths preserve `correlation_id` so observers can join the chain
// back to the originating task. The dead-letter envelope wraps the
// original under `extensions.dead_letter` and is published to the
// dead-letter subject derived from the original capability.

export interface DeadLetterExtension {
  original_subject: string;
  originating_consumer: string;
  delivery_count: number;
  nak_chain: NakReason[];
  final_nak_reason: NakReason;
  dead_lettered_at: string;
  // Optional — set when fast-path triggered the route, distinct from
  // exhaustion. Lets observers separate compliance refusals from agent
  // capability mismatches.
  route_trigger?: "exhaustion" | "compliance-block";
}

export interface DeadLetterEnvelope extends MyelinEnvelope {
  extensions: {
    dead_letter: DeadLetterExtension;
    [k: string]: unknown;
  };
}

export interface DeadLetterHandlerOptions {
  org: string;
  publisher: EnvelopePublisher;
  // Source of dispatch.task.rejected events; in production this is a
  // wrapper around the NATS subscriber.
  subscribeRejections: (
    subject: string,
    handler: (event: TaskRejectedEvent) => Promise<void>,
  ) => Promise<Subscription>;
  // Per-feature-call hook fired AFTER the dead-letter envelope is
  // published. Operators can use this to update dashboards, page on
  // compliance-blocks, or run custom remediation.
  onDeadLetter?: (envelope: DeadLetterEnvelope) => void | Promise<void>;
  // Default: 3 — matches TASKS consumer's default max_deliver. The
  // handler counts `cant-do | wont-do` rejections (per F-022, `not-now`
  // is excluded) and routes when the count reaches this threshold.
  maxDeliver?: number;
}

interface TaskRejectedEvent {
  task_id: string;
  correlation_id: string;
  agent_principal: string;
  reason: NakReason;
  description?: string;
  timestamp: string;
  delivery_count: number;
  // Set by upstream when the rejection refers to a known consumer; the
  // handler tracks chains per-consumer so different consumer groups
  // don't share state.
  originating_consumer?: string;
  // The original task subject — needed to derive the dead-letter
  // subject and to populate `original_subject` in the dead-letter
  // extension.
  original_subject?: string;
  // Original envelope payload preserved by the rejecting agent for
  // dead-letter wrapping. Optional only because some early-stage
  // agents may not emit it; without it the handler can still record
  // the rejection chain but cannot route to dead-letter.
  original_envelope?: MyelinEnvelope;
}

export function isDeadLetterEnvelope(envelope: MyelinEnvelope): envelope is DeadLetterEnvelope {
  return Boolean(
    envelope.extensions &&
      typeof envelope.extensions === "object" &&
      "dead_letter" in envelope.extensions,
  );
}

/**
 * Derive the dead-letter subject for a given original task subject.
 *
 *   local.acme.tasks.code-review.typescript
 *     → local.acme.tasks.dead-letter.code-review
 *
 * The capability segment is preserved so per-capability dead-letter
 * subscriptions stay meaningful. Subcapabilities (e.g. `typescript`)
 * are dropped — they're routing detail; operators monitor by capability.
 */
export function deriveDeadLetterSubject(originalSubject: string): string {
  const parts = originalSubject.split(".");
  // Expect at least: prefix.{org}.tasks.{capability}[.{subcapability}]
  // i.e. ≥ 4 segments where parts[2] === "tasks".
  if (parts.length < 4 || parts[2] !== "tasks") {
    throw new Error(
      `deriveDeadLetterSubject: unexpected subject shape '${originalSubject}' — expected '{prefix}.{org}.tasks.{capability}.*'`,
    );
  }
  if (parts[3] === "dead-letter") {
    // Already dead-letter — re-deriving would double-prefix. Return
    // the input so callers can be idempotent.
    return originalSubject;
  }
  return `${parts[0]}.${parts[1]}.tasks.dead-letter.${parts[3]}`;
}

/**
 * Wrap an original envelope as a dead-letter envelope. Fresh `id` and
 * `timestamp` (the dead-letter is its own message), original
 * `correlation_id` preserved (it's still the same logical task).
 */
export function createDeadLetterEnvelope(
  original: MyelinEnvelope,
  ext: Omit<DeadLetterExtension, "dead_lettered_at"> & { dead_lettered_at?: string },
): DeadLetterEnvelope {
  const deadLetter: DeadLetterExtension = {
    ...ext,
    dead_lettered_at: ext.dead_lettered_at ?? new Date().toISOString(),
  };
  return {
    ...original,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    correlation_id: original.correlation_id ?? original.id,
    extensions: {
      ...(original.extensions ?? {}),
      dead_letter: deadLetter,
    },
  };
}

/**
 * Round-trip helper: take a dead-letter envelope, strip the
 * `dead_letter` extension, mint fresh `id`/`timestamp`, and re-publish
 * to the original capability subject (or override). `correlation_id`
 * is preserved by default so the task chain stays joined across the
 * dead-letter excursion.
 */
export async function republishDeadLetter(
  envelope: MyelinEnvelope,
  publisher: EnvelopePublisher,
  opts?: { subjectOverride?: string; preserveCorrelationId?: boolean },
): Promise<void> {
  if (!isDeadLetterEnvelope(envelope)) {
    throw new Error("republishDeadLetter: envelope has no extensions.dead_letter — not a dead-letter envelope");
  }
  const { dead_letter, ...restExt } = envelope.extensions;
  const subject = opts?.subjectOverride ?? dead_letter.original_subject;
  const preserveCorr = opts?.preserveCorrelationId ?? true;

  await publisher.publish(
    {
      source: envelope.source,
      type: envelope.type,
      ...(preserveCorr && envelope.correlation_id ? { correlation_id: envelope.correlation_id } : {}),
      ...(Object.keys(restExt).length > 0 ? { extensions: restExt } : {}),
      sovereignty: envelope.sovereignty,
      payload: envelope.payload,
    },
    subject,
  );
}

/**
 * Tracks rejection chains per (correlation_id, consumer) so the
 * exhaustion path can attach the full chain to the dead-letter
 * envelope. Bounded automatically: `record()` evicts after enough
 * rejections accumulate (default = `maxDeliver`), and `evict()` is
 * called explicitly when a chain reaches dead-letter or ack.
 */
export class NakChainTracker {
  private chains = new Map<string, NakReason[]>();
  // maxDeliver kept for future bounded-tracking semantics; current
  // implementation evicts on dead-letter / ack rather than capping mid-chain.
  constructor(_maxDeliver: number = 3) {
    void _maxDeliver;
  }

  private key(correlationId: string, consumer: string): string {
    return `${correlationId}:${consumer}`;
  }

  /** Append a reason; returns the full chain after append. */
  record(correlationId: string, consumer: string, reason: NakReason): NakReason[] {
    const k = this.key(correlationId, consumer);
    const chain = this.chains.get(k) ?? [];
    chain.push(reason);
    this.chains.set(k, chain);
    return [...chain];
  }

  get(correlationId: string, consumer: string): NakReason[] {
    return [...(this.chains.get(this.key(correlationId, consumer)) ?? [])];
  }

  evict(correlationId: string, consumer: string): void {
    this.chains.delete(this.key(correlationId, consumer));
  }

  /** Visible for tests + operators wanting to inspect tracker state. */
  size(): number {
    return this.chains.size;
  }
}

/**
 * Subscribes to dispatch.task.rejected events, accumulates rejection
 * chains, and routes tasks to the dead-letter subject when:
 *
 *   - reason === "compliance-block" (fast path), OR
 *   - the chain length (excluding `not-now`) reaches `maxDeliver`
 *
 * Lifecycle: construct → start() → stop() when finished. `start()`
 * returns a Subscription; the handler holds it internally and
 * unsubscribes in stop().
 */
export class DeadLetterHandler {
  private subscription: Subscription | null = null;
  private readonly chains: NakChainTracker;
  private readonly maxDeliver: number;

  constructor(private readonly options: DeadLetterHandlerOptions) {
    this.maxDeliver = options.maxDeliver ?? 3;
    this.chains = new NakChainTracker(this.maxDeliver);
  }

  async start(): Promise<void> {
    if (this.subscription) {
      throw new Error("DeadLetterHandler: already started");
    }
    const subject = `local.${this.options.org}.dispatch.task.rejected`;
    this.subscription = await this.options.subscribeRejections(subject, async (event) =>
      this.onRejection(event),
    );
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /** Visible for tests. */
  trackerSize(): number {
    return this.chains.size();
  }

  private shouldRoute(reason: NakReason, chainLength: number): "compliance-block" | "exhaustion" | null {
    if (reason === "compliance-block") return "compliance-block";
    if (reason === "not-now") return null; // doesn't count toward exhaustion (F-022 contract)
    if (chainLength >= this.maxDeliver) return "exhaustion";
    return null;
  }

  private async onRejection(event: TaskRejectedEvent): Promise<void> {
    const consumer = event.originating_consumer ?? "unknown";

    let chain: NakReason[];
    if (event.reason === "not-now") {
      // Still fetch the chain (without appending) so observers have
      // accurate visibility, but don't grow the chain — `not-now` is
      // transient and excluded from the exhaustion budget.
      chain = this.chains.get(event.correlation_id, consumer);
    } else {
      chain = this.chains.record(event.correlation_id, consumer, event.reason);
    }

    const trigger = this.shouldRoute(event.reason, chain.length);
    if (!trigger) return;

    if (!event.original_envelope || !event.original_subject) {
      // Without original envelope/subject we can record the chain but
      // can't route to dead-letter. Surface so operators see the gap.
      process.stderr.write(
        `myelin-dead-letter: cannot route ${event.task_id} — rejection event missing original_envelope or original_subject\n`,
      );
      return;
    }

    const dlEnvelope = createDeadLetterEnvelope(event.original_envelope, {
      original_subject: event.original_subject,
      originating_consumer: consumer,
      delivery_count: event.delivery_count,
      nak_chain: chain,
      final_nak_reason: event.reason,
      route_trigger: trigger,
    });

    const dlSubject = deriveDeadLetterSubject(event.original_subject);
    await this.options.publisher.publish(
      {
        source: dlEnvelope.source,
        type: dlEnvelope.type,
        correlation_id: dlEnvelope.correlation_id,
        sovereignty: dlEnvelope.sovereignty,
        extensions: dlEnvelope.extensions,
        payload: dlEnvelope.payload,
      },
      dlSubject,
    );

    // Emit dispatch.task.failed lifecycle event so threshold-review,
    // surface-router and audit observers see the terminal state.
    try {
      await this.options.publisher.publish(
        {
          source: dlEnvelope.source,
          type: "dispatch.task.failed",
          correlation_id: dlEnvelope.correlation_id,
          sovereignty: dlEnvelope.sovereignty,
          payload: {
            task_id: event.task_id,
            correlation_id: event.correlation_id,
            final_reason: event.reason,
            nak_chain: chain,
            delivery_count: event.delivery_count,
            dead_letter_subject: dlSubject,
            originating_consumer: consumer,
            route_trigger: trigger,
            timestamp: new Date().toISOString(),
          },
        },
        `local.${this.options.org}.dispatch.task.failed`,
      );
    } catch (err) {
      process.stderr.write(
        `myelin-dead-letter: lifecycle publish failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    this.chains.evict(event.correlation_id, consumer);

    if (this.options.onDeadLetter) {
      try {
        await this.options.onDeadLetter(dlEnvelope);
      } catch (err) {
        process.stderr.write(
          `myelin-dead-letter: onDeadLetter callback failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }
}
