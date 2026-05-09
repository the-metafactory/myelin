import type { MyelinEnvelope, Sovereignty, DistributionMode } from "../types";
import type { SigningIdentity } from "../identity/types";
import type { EnvelopePublisher, EnvelopeSubscriber, Subscription } from "../transport/types";
import { signEnvelope } from "../identity/sign";
import {
  type LifecycleState,
  type ReceivedPayload,
  type AssignedPayload,
  type StartedPayload,
  type ProgressPayload,
  type CompletedPayload,
  type FailedPayload,
  type AbortedPayload,
  type DispatchLifecycleEnvelope,
  STATE_TO_TYPE,
} from "./types";
import { generateCorrelationId } from "./correlation";

// F-020 emitter + consumer for dispatch lifecycle envelopes.

/**
 * Build the canonical NATS subject for a dispatch lifecycle event.
 *
 *     local.{org}.dispatch.task.{state}
 */
export function deriveLifecycleSubject(org: string, state: LifecycleState): string {
  return `local.${org}.dispatch.task.${state}`;
}

/** Wildcard for subscribing to every lifecycle state of an org. */
export function deriveLifecycleWildcard(org: string): string {
  return `local.${org}.dispatch.task.>`;
}

/**
 * Emission rules per distribution mode (per design doc §Event-driven
 * lifecycle / Emission Rules):
 *
 *   | state      | Broadcast | Direct | Delegate |
 *   | received   |     ✓     |   ✓    |    ✓     |
 *   | assigned   |     ✓     |   ✓    |    ✓     |
 *   | started    |           |        |    ✓     |
 *   | progress   |           |        |    ✓     |
 *   | completed  |     ✓     |   ✓    |    ✓     |
 *   | failed     |     ✓     |   ✓    |    ✓     |
 *   | aborted    |           |        |    ✓     |
 */
const DELEGATE_ONLY_STATES: ReadonlySet<LifecycleState> = new Set([
  "started",
  "progress",
  "aborted",
]);

export function validateEmissionRules(state: LifecycleState, mode: DistributionMode): void {
  if (DELEGATE_ONLY_STATES.has(state) && mode !== "delegate") {
    throw new Error(`dispatch lifecycle: '${state}' state only valid for delegate mode (got '${mode}')`);
  }
}

export interface LifecycleEmitterOptions {
  publisher: EnvelopePublisher;
  org: string;
  // Source string used on emitted envelopes — typically the orchestrator
  // identity, e.g. "metafactory.cortex.dispatch".
  source: string;
  sovereignty: Sovereignty;
  // Optional Ed25519 identity for signed lifecycle envelopes. Without it,
  // events ride unsigned (chain-of-stamps coverage requires this).
  identity?: SigningIdentity | null;
}

export interface LifecycleEmitter {
  received(input: Omit<ReceivedPayload, "timestamp">): Promise<DispatchLifecycleEnvelope>;
  assigned(input: Omit<AssignedPayload, "timestamp">): Promise<DispatchLifecycleEnvelope>;
  started(input: Omit<StartedPayload, "timestamp">): Promise<DispatchLifecycleEnvelope>;
  progress(input: Omit<ProgressPayload, "timestamp">): Promise<DispatchLifecycleEnvelope>;
  completed(input: Omit<CompletedPayload, "timestamp">): Promise<DispatchLifecycleEnvelope>;
  failed(input: Omit<FailedPayload, "timestamp">): Promise<DispatchLifecycleEnvelope>;
  aborted(input: Omit<AbortedPayload, "timestamp">): Promise<DispatchLifecycleEnvelope>;
}

/**
 * Construct an emitter that publishes lifecycle envelopes for one
 * orchestrator identity. Each helper validates the emission rules,
 * builds and (optionally) signs the envelope, and publishes to the
 * canonical subject.
 */
export function createLifecycleEmitter(options: LifecycleEmitterOptions): LifecycleEmitter {
  const { publisher, org, source, sovereignty, identity } = options;

  async function emit<S extends LifecycleState>(
    state: S,
    payload: Record<string, unknown>,
  ): Promise<DispatchLifecycleEnvelope> {
    const mode = payload.distribution_mode as DistributionMode;
    if (!mode) {
      throw new Error(`dispatch lifecycle: payload.distribution_mode required for state '${state}'`);
    }
    validateEmissionRules(state, mode);

    const correlation_id = (payload.correlation_id as string) ?? generateCorrelationId();
    const enriched = { ...payload, correlation_id, timestamp: new Date().toISOString() };

    const envelope: MyelinEnvelope = {
      id: crypto.randomUUID(),
      source,
      type: STATE_TO_TYPE[state],
      timestamp: new Date().toISOString(),
      correlation_id,
      sovereignty: { ...sovereignty },
      payload: enriched,
    };

    const finalEnvelope = identity
      ? await signEnvelope(envelope, identity.privateKey, identity.did)
      : envelope;

    await publisher.publish(
      {
        source,
        type: envelope.type,
        correlation_id,
        sovereignty,
        payload: enriched,
      },
      deriveLifecycleSubject(org, state),
    );

    return finalEnvelope as DispatchLifecycleEnvelope;
  }

  return {
    received: (input) => emit("received", { ...input } as Record<string, unknown>),
    assigned: (input) => emit("assigned", { ...input } as Record<string, unknown>),
    started: (input) => emit("started", { ...input } as Record<string, unknown>),
    progress: (input) => emit("progress", { ...input } as Record<string, unknown>),
    completed: (input) => emit("completed", { ...input } as Record<string, unknown>),
    failed: (input) => emit("failed", { ...input } as Record<string, unknown>),
    aborted: (input) => emit("aborted", { ...input } as Record<string, unknown>),
  };
}

export interface SubscribeLifecycleOptions {
  subscriber: EnvelopeSubscriber;
  org: string;
  handler: (envelope: DispatchLifecycleEnvelope) => Promise<void>;
  // Optional filter to specific lifecycle states. When omitted the
  // subscription is via the wildcard subject (all 7 states).
  states?: LifecycleState[];
}

/**
 * Subscribe to lifecycle events. Single subject when one state is
 * requested; wildcard for all-states or a multi-state subset (the
 * subscriber filters in-process).
 */
export async function subscribeLifecycle(opts: SubscribeLifecycleOptions): Promise<Subscription> {
  const { subscriber, org, handler, states } = opts;
  if (states && states.length === 1) {
    return subscriber.subscribe(deriveLifecycleSubject(org, states[0]!), async (env) => {
      await handler(env as DispatchLifecycleEnvelope);
    });
  }
  const stateSet = states ? new Set(states) : null;
  return subscriber.subscribe(deriveLifecycleWildcard(org), async (env) => {
    if (stateSet) {
      const tail = env.type.split(".").pop();
      if (!tail || !stateSet.has(tail as LifecycleState)) return;
    }
    await handler(env as DispatchLifecycleEnvelope);
  });
}
