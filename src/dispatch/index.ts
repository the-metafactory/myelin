export type {
  LifecycleState,
  ProgressSeverity,
  AbortReason,
  DistributionMode,
  NakReason,
  BaseLifecyclePayload,
  ReceivedPayload,
  AssignedPayload,
  StartedPayload,
  ProgressPayload,
  CompletedPayload,
  FailedPayload,
  DeadLetterFailedPayload,
  AbortedPayload,
  RejectedPayload,
  LifecyclePayloadByState,
  LifecyclePayload,
  DispatchLifecycleEnvelope,
} from "./types";

export { STATE_TO_TYPE } from "./types";

export {
  generateCorrelationId,
  isValidCorrelationId,
  ensureCorrelationId,
  deriveChildEnvelope,
  createReplyEnvelope,
  reconstructTrace,
  isRootOfTrace,
} from "./correlation";
export type { TraceNode } from "./correlation";

export {
  deriveLifecycleSubject,
  deriveLifecycleWildcard,
  lifecycleSubjectAndType,
  validateEmissionRules,
  createLifecycleEvent,
  createDispatchLifecycleEvent,
  createLifecycleEmitter,
  subscribeLifecycle,
  type LifecycleEventPayloadInput,
  type CreateLifecycleEventOptions,
  type LifecyclePublishEvent,
  type LifecycleEmitter,
  type LifecycleEmitterOptions,
  type SubscribeLifecycleOptions,
} from "./lifecycle";

export { getEventsStreamConfig, type EventsStreamConfig } from "./stream";

// R2 transition reader (vocabulary migration 2026-05, PR-7) — dual-read
// helper for the dispatch-payload `principal` → `identity` rename.
// Consumers replaying a pre-migration EVENTS stream MUST use this.
export { readPayloadIdentity } from "./payload-identity";
