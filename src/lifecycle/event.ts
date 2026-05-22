import type {
  DistributionMode,
  Sovereignty,
} from "../types";
import {
  DISPATCH_TASK_STATE_TO_TYPE,
  type DispatchLifecycleEventType,
  type LifecycleState,
} from "../subject-vocabulary";
import { dispatchTaskLifecycleSubject } from "../subjects";
import { generateCorrelationId } from "../correlation";
import type {
  LifecyclePayloadByState,
  TimestampOptional,
} from "./types";

export type LifecycleEventPayloadInput<S extends LifecycleState = LifecycleState> =
  TimestampOptional<LifecyclePayloadByState[S]>;

export type CreateLifecycleEventOptions<S extends LifecycleState = LifecycleState> = {
  source: string;
  sovereignty: Partial<Sovereignty>;
  state: S;
  payload: LifecycleEventPayloadInput<S>;
  stack?: string;
  now?: () => Date;
} & (
  | {
      principal: string;
      /** @deprecated Use `principal`; accepted for transition-window callers. */
      org?: string;
    }
  | {
      principal?: string;
      /** @deprecated Use `principal`; accepted for transition-window callers. */
      org: string;
    }
);

export interface LifecycleEnvelopePublishInput {
  source: string;
  type: DispatchLifecycleEventType;
  payload: Record<string, unknown>;
  correlation_id: string;
  sovereignty?: Partial<Sovereignty>;
}

export interface LifecyclePublishEvent {
  subject: string;
  input: LifecycleEnvelopePublishInput;
}

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

/**
 * Construct the canonical publish input for one dispatch.task lifecycle event.
 *
 * This is the vocabulary seam: callers supply a lifecycle state and its
 * payload, and this helper owns the matching Subject, envelope type,
 * correlation id, timestamp, and emission-mode legality.
 */
export function createLifecycleEvent<S extends LifecycleState>(
  options: CreateLifecycleEventOptions<S>,
): LifecyclePublishEvent {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- `org` is accepted for transition-window callers.
  const principal = options.principal ?? options.org;
  if (!principal) {
    throw new Error("dispatch lifecycle: principal required");
  }
  const {
    correlation_id: inputCorrelationId,
  } = options.payload;
  const mode = (options.payload as { distribution_mode?: DistributionMode }).distribution_mode;
  if (!mode) {
    throw new Error(`dispatch lifecycle: payload.distribution_mode required for state '${options.state}'`);
  }
  validateEmissionRules(options.state, mode);

  const correlation_id =
    typeof inputCorrelationId === "string" ? inputCorrelationId : generateCorrelationId();
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  const enriched: Record<string, unknown> = { ...options.payload, correlation_id, timestamp };

  return {
    subject: dispatchTaskLifecycleSubject(principal, options.state, options.stack),
    input: {
      source: options.source,
      type: DISPATCH_TASK_STATE_TO_TYPE[options.state],
      correlation_id,
      sovereignty: options.sovereignty,
      payload: enriched,
    },
  };
}
