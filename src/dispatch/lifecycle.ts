import type { Sovereignty, DistributionMode } from "../types";
import type { EnvelopePublisher, EnvelopeSubscriber, Subscription } from "../transport/types";
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
  // Note: signing happens at the transport layer (EnvelopeTransport
  // owns the SigningIdentity). The emitter does not construct or sign
  // envelopes itself — it hands the publisher a payload + subject and
  // lets the transport do its job. Earlier drafts of this file had a
  // local `identity` option that signed a throwaway envelope; that was
  // removed (myelin#49 review).
}

export interface LifecycleEmitter {
  received(input: Omit<ReceivedPayload, "timestamp">): Promise<void>;
  assigned(input: Omit<AssignedPayload, "timestamp">): Promise<void>;
  started(input: Omit<StartedPayload, "timestamp">): Promise<void>;
  progress(input: Omit<ProgressPayload, "timestamp">): Promise<void>;
  completed(input: Omit<CompletedPayload, "timestamp">): Promise<void>;
  failed(input: Omit<FailedPayload, "timestamp">): Promise<void>;
  aborted(input: Omit<AbortedPayload, "timestamp">): Promise<void>;
}

/**
 * Construct an emitter that publishes lifecycle envelopes for one
 * orchestrator identity. Each helper validates the emission rules and
 * publishes payload + subject through the supplied EnvelopePublisher.
 * The transport layer owns envelope construction (id, timestamp) and
 * signing (when configured with a SigningIdentity).
 */
export function createLifecycleEmitter(options: LifecycleEmitterOptions): LifecycleEmitter {
  const { publisher, org, source, sovereignty } = options;

  async function emit<S extends LifecycleState>(
    state: S,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const mode = payload.distribution_mode as DistributionMode | undefined;
    if (!mode) {
      throw new Error(`dispatch lifecycle: payload.distribution_mode required for state '${state}'`);
    }
    validateEmissionRules(state, mode);

    const correlation_id =
      typeof payload.correlation_id === "string" ? payload.correlation_id : generateCorrelationId();
    const enriched = { ...payload, correlation_id, timestamp: new Date().toISOString() };

    await publisher.publish(
      {
        source,
        type: STATE_TO_TYPE[state],
        correlation_id,
        sovereignty,
        payload: enriched,
      },
      deriveLifecycleSubject(org, state),
    );
  }

  return {
    received: (input) => emit("received", { ...input }),
    assigned: (input) => emit("assigned", { ...input }),
    started: (input) => emit("started", { ...input }),
    progress: (input) => emit("progress", { ...input }),
    completed: (input) => emit("completed", { ...input }),
    failed: (input) => emit("failed", { ...input }),
    aborted: (input) => emit("aborted", { ...input }),
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
  if (states?.length === 1) {
    return subscriber.subscribe(deriveLifecycleSubject(org, states[0]), async (env) => {
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
