import type { Sovereignty } from "../types";
import type { EnvelopePublisher, EnvelopeSubscriber, Subscription } from "../transport/types";
import {
  dispatchTaskLifecycleSubject,
  dispatchTaskLifecycleWildcard,
} from "../subjects";
import {
  type LifecycleState,
  type DispatchLifecycleEnvelope,
  STATE_TO_TYPE,
} from "./types";
export {
  createLifecycleEvent,
  createLifecycleEvent as createDispatchLifecycleEvent,
  validateEmissionRules,
} from "../lifecycle/event";
export type {
  CreateLifecycleEventOptions,
  LifecycleEventPayloadInput,
  LifecyclePublishEvent,
} from "../lifecycle/event";
import {
  createLifecycleEvent,
  type LifecycleEventPayloadInput,
} from "../lifecycle/event";

// F-020 emitter + consumer for dispatch lifecycle envelopes.

/**
 * Build the canonical NATS subject for a dispatch lifecycle event.
 *
 * Legacy 5-segment form:
 *     local.{principal}.dispatch.task.{state}
 *
 * Stack-aware 6-segment form (myelin#113 / closes myelin#154):
 *     local.{principal}.{stack}.dispatch.task.{state}
 *
 * When `stack` is omitted, the legacy form is returned bit-identical to
 * the pre-#154 output. When supplied, it is validated through the same
 * `STACK_SEGMENT_REGEX` the rest of the subject grammar enforces.
 */
export function deriveLifecycleSubject(
  principal: string,
  state: LifecycleState,
  stack?: string,
): string {
  // myelin#154 cycle 2 — `principal` was previously interpolated without
  // validation, leaving a wildcard-injection hole: a principal of `*` or
  // `>` would broaden the resulting subject beyond the principal's
  // intent. Sage Security lens flagged this; same defensive shape as
  // the rest of the namespace helpers (subjects.ts agent-task family).
  // NB: the `assertSegment` label stays `"org"` — it is an error-message
  // string consumed by tests, not the renamed code identifier (R7 renames
  // the variable; the user-facing label is R12a prose, out of PR-7 scope).
  return dispatchTaskLifecycleSubject(principal, state, stack);
}

/**
 * Wildcard for subscribing to every lifecycle state of a principal.
 * Matches the legacy 5-segment form when `stack` is omitted, the
 * stack-aware 6-segment form when supplied.
 */
export function deriveLifecycleWildcard(principal: string, stack?: string): string {
  // myelin#154 cycle 2 — see `deriveLifecycleSubject` for the
  // wildcard-injection rationale on `principal`. The `assertSegment`
  // label stays `"org"` — see the note in `deriveLifecycleSubject`.
  return dispatchTaskLifecycleWildcard(principal, stack);
}

/**
 * Bundle the lifecycle subject and matching envelope `type` string
 * (myelin#143).
 *
 * The envelope `type` for a lifecycle event is `dispatch.task.{state}` —
 * mirroring the trailing segment of {@link deriveLifecycleSubject}. Pure
 * lookup over {@link STATE_TO_TYPE}; no behavior change.
 *
 * @param stack Optional operator stack segment (myelin#154). Forwarded to
 *   {@link deriveLifecycleSubject}; the bundled `subject` is 6-segment
 *   when supplied, legacy 5-segment when omitted.
 *
 * @example
 *   lifecycleSubjectAndType('metafactory', 'completed')
 *   // → { subject: 'local.metafactory.dispatch.task.completed',
 *   //     type:    'dispatch.task.completed' }
 *   lifecycleSubjectAndType('metafactory', 'completed', 'default')
 *   // → { subject: 'local.metafactory.default.dispatch.task.completed',
 *   //     type:    'dispatch.task.completed' }
 */
export function lifecycleSubjectAndType(
  principal: string,
  state: LifecycleState,
  stack?: string,
): { subject: string; type: string } {
  return {
    subject: deriveLifecycleSubject(principal, state, stack),
    type: STATE_TO_TYPE[state],
  };
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
  received(input: LifecycleEventPayloadInput<"received">): Promise<void>;
  assigned(input: LifecycleEventPayloadInput<"assigned">): Promise<void>;
  started(input: LifecycleEventPayloadInput<"started">): Promise<void>;
  progress(input: LifecycleEventPayloadInput<"progress">): Promise<void>;
  completed(input: LifecycleEventPayloadInput<"completed">): Promise<void>;
  failed(input: LifecycleEventPayloadInput<"failed">): Promise<void>;
  aborted(input: LifecycleEventPayloadInput<"aborted">): Promise<void>;
  rejected(input: LifecycleEventPayloadInput<"rejected">): Promise<void>;
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
    payload: LifecycleEventPayloadInput<S>,
  ): Promise<void> {
    const event = createLifecycleEvent({ principal: org, source, sovereignty, state, payload });
    await publisher.publish(event.input, event.subject);
  }

  return {
    received: (input) => emit("received", input),
    assigned: (input) => emit("assigned", input),
    started: (input) => emit("started", input),
    progress: (input) => emit("progress", input),
    completed: (input) => emit("completed", input),
    failed: (input) => emit("failed", input),
    aborted: (input) => emit("aborted", input),
    rejected: (input) => emit("rejected", input),
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
