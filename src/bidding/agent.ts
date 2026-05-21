import type { MyelinEnvelope, Sovereignty } from "../types";
import type { SigningIdentity } from "../identity/types";
import type { Subscription } from "../transport/types";
import { createEnvelope } from "../envelope";
import { signBidResponse } from "./response";
import { deriveBidRequestSubject } from "./subjects";
import type { BidRequest, BidResponse, SelectionStrategy } from "./types";

const SELECTION_STRATEGIES: ReadonlySet<SelectionStrategy> = new Set<SelectionStrategy>([
  "lowest-load",
  "lowest-cost",
  "highest-match",
]);

export interface BidEvaluator {
  /** Current load, in [0, 1]. */
  getLoad(): number | Promise<number>;
  /** Capability fit for the requested requirements, in [0, 1]. */
  evaluateMatch(requirements: readonly string[]): number | Promise<number>;
  /** Optional cost quote. When omitted, no `cost` is attached to the bid. */
  getCost?(request: BidRequest): number | Promise<number>;
  /** Should this agent bid on the request at all? */
  shouldBid(request: BidRequest): boolean | Promise<boolean>;
  /** Optional constraints to attach to the bid (e.g. data residency). */
  getConstraints?(request: BidRequest): readonly string[] | Promise<readonly string[]>;
}

export type AgentTransportSubscribe = (
  subject: string,
  handler: (envelope: MyelinEnvelope) => Promise<void>,
) => Promise<Subscription>;

export type AgentTransportPublish = (
  subject: string,
  envelope: MyelinEnvelope,
) => Promise<void>;

export interface BiddingAgentOptions {
  org: string;
  source: string;
  sovereignty: Sovereignty;
  identity: SigningIdentity;
  evaluator: BidEvaluator;
  capabilities: readonly string[];
  subscribe: AgentTransportSubscribe;
  publish: AgentTransportPublish;
  /**
   * Optional observation hook for declined / malformed / errored
   * requests. Tests use this to assert decision paths without
   * scraping the transport; production callers can route it to
   * logs or metrics.
   */
  onObservation?: (obs: AgentObservation) => void;
}

export type AgentObservationKind =
  | "received"
  | "bid-sent"
  | "declined"
  | "skipped-malformed"
  | "error";

export interface AgentObservation {
  kind: AgentObservationKind;
  capability: string;
  task_id?: string;
  reason?: string;
}

export interface BiddingAgent {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Agent-side participant in F-10 bidding.
 *
 * On `start()`, subscribes to `local.{principal}.tasks.bid-request.{capability}`
 * for every capability in `options.capabilities` — NO queue group, every
 * agent sees every request. On each incoming bid-request envelope:
 *
 *   1. Decode `envelope.payload` as a {@link BidRequest}. Malformed
 *      payloads are observed as `skipped-malformed` and ignored.
 *   2. Ask `evaluator.shouldBid(request)`. If false, observed as
 *      `declined` and skipped.
 *   3. Collect `getLoad()`, `evaluateMatch()`, optional `getCost()`,
 *      optional `getConstraints()` from the evaluator.
 *   4. Sign a {@link BidResponse} via {@link signBidResponse} and
 *      publish a `tasks.bid-response` envelope to the inbox the
 *      requester chose (`request.reply_to`).
 *
 * `stop()` unsubscribes every active subscription. Calls after stop
 * are no-ops. Calling `start()` twice without an intervening `stop()`
 * is an error — bidding state is per-instance.
 *
 * Out of scope for this slice (T-5.2):
 *   - Queue-group competition between agents (spec is explicit: no
 *     queue group, every agent sees every request).
 *   - Capability-discovery wiring (F-11 owns the registry).
 *   - Bidding-side rate limiting / token bucket.
 */
export function createBiddingAgent(options: BiddingAgentOptions): BiddingAgent {
  const {
    org,
    source,
    sovereignty,
    identity,
    evaluator,
    capabilities,
    subscribe,
    publish,
    onObservation,
  } = options;

  if (capabilities.length === 0) {
    throw new Error("createBiddingAgent: capabilities must be a non-empty array");
  }

  // Defensive copy so caller mutations after start cannot change the
  // active subscription set.
  const ownedCapabilities = [...capabilities];

  let subs: Subscription[] = [];
  let started = false;

  const observe = (obs: AgentObservation): void => {
    if (!onObservation) return;
    try {
      onObservation(obs);
    } catch {
      // Listener errors must never crash the bidding loop. The
      // observer contract is fire-and-forget; faulty observers are
      // the caller's problem to detect via their own instrumentation.
    }
  };

  const parseBidRequest = (payload: unknown): BidRequest | null => {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.task_id !== "string" || p.task_id.length === 0) return null;
    if (!Array.isArray(p.requirements) || p.requirements.some((r) => typeof r !== "string")) return null;
    if (typeof p.priority !== "number") return null;
    if (typeof p.bid_timeout_ms !== "number") return null;
    if (
      typeof p.selection_strategy !== "string" ||
      !SELECTION_STRATEGIES.has(p.selection_strategy as SelectionStrategy)
    ) {
      return null;
    }
    if (typeof p.reply_to !== "string" || p.reply_to.length === 0) return null;
    return {
      task_id: p.task_id,
      requirements: p.requirements as string[],
      priority: p.priority,
      bid_timeout_ms: p.bid_timeout_ms,
      selection_strategy: p.selection_strategy as SelectionStrategy,
      reply_to: p.reply_to,
      ...(typeof p.task_summary === "string" ? { task_summary: p.task_summary } : {}),
    };
  };

  const handleRequest = async (capability: string, envelope: MyelinEnvelope): Promise<void> => {
    const request = parseBidRequest(envelope.payload);
    if (!request) {
      observe({ kind: "skipped-malformed", capability, reason: "envelope.payload is not a BidRequest" });
      return;
    }

    observe({ kind: "received", capability, task_id: request.task_id });

    try {
      const willBid = await evaluator.shouldBid(request);
      if (!willBid) {
        observe({ kind: "declined", capability, task_id: request.task_id, reason: "shouldBid returned false" });
        return;
      }

      const load = await evaluator.getLoad();
      const capabilityMatch = await evaluator.evaluateMatch(request.requirements);
      const cost = evaluator.getCost ? await evaluator.getCost(request) : undefined;
      const constraints = evaluator.getConstraints
        ? await evaluator.getConstraints(request)
        : undefined;

      const bid: BidResponse = await signBidResponse(
        {
          task_id: request.task_id,
          bidder: identity.did,
          load,
          capability_match: capabilityMatch,
          ...(cost !== undefined ? { cost } : {}),
          ...(constraints && constraints.length > 0 ? { constraints: [...constraints] } : {}),
        },
        identity,
      );

      const replyEnvelope = createEnvelope({
        source,
        type: "tasks.bid-response",
        sovereignty,
        payload: { ...bid },
        ...(envelope.correlation_id ? { correlation_id: envelope.correlation_id } : {}),
      });

      await publish(request.reply_to, replyEnvelope);
      observe({ kind: "bid-sent", capability, task_id: request.task_id });
    } catch (err) {
      observe({
        kind: "error",
        capability,
        task_id: request.task_id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    async start(): Promise<void> {
      if (started) {
        throw new Error("createBiddingAgent: agent already started");
      }
      started = true;
      try {
        for (const capability of ownedCapabilities) {
          const subject = deriveBidRequestSubject(org, capability);
          const sub = await subscribe(subject, (envelope) => handleRequest(capability, envelope));
          subs.push(sub);
        }
      } catch (err) {
        // Best-effort rollback so partial subscriptions don't leak.
        // The exception is propagated so the caller knows start failed.
        for (const s of subs) {
          try {
            await s.unsubscribe();
          } catch {
            /* swallow during rollback */
          }
        }
        subs = [];
        started = false;
        throw err;
      }
    },

    async stop(): Promise<void> {
      const toClose = subs;
      subs = [];
      started = false;
      for (const s of toClose) {
        try {
          await s.unsubscribe();
        } catch {
          /* swallow — stop is best-effort */
        }
      }
    },
  };
}
