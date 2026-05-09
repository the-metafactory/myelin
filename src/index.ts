export {
  createEnvelope,
  createSignedEnvelope,
  validateEnvelope,
  parseSovereignty,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
} from './envelope';

export type {
  MyelinEnvelope,
  CreateEnvelopeInput,
  Sovereignty,
  Classification,
  ModelClass,
  SovereigntyRequirement,
  DistributionMode,
  ValidationResult,
  ValidationError,
} from './types';

export {
  NATSTransport,
  EnvelopeTransport,
  InMemoryTransport,
  TestEnvelopeTransport,
  createTransport,
  subjectMatchesPattern,
  nakWithReason,
  nakWithReasonSync,
  NAK_REASON_HEADER,
  NAK_DESCRIPTION_HEADER,
  NAK_BACKOFF,
  DeadLetterHandler,
  NakChainTracker,
  createDeadLetterEnvelope,
  deriveDeadLetterSubject,
  republishDeadLetter,
  isDeadLetterEnvelope,
} from './transport';

export type {
  NATSTransportOptions,
  EnvelopeTransportOptions,
  TransportPublisher,
  TransportSubscriber,
  EnvelopePublisher,
  EnvelopeSubscriber,
  EnvelopePublishInput,
  SubscribeOptions,
  Subscription,
  TransportConfig,
  NakReason,
  NakOptions,
  NakContext,
  TaskRejectedEvent,
  NakableMessage,
  DeadLetterEnvelope,
  DeadLetterExtension,
  DeadLetterHandlerOptions,
} from './transport';

export type {
  Principal,
  PrincipalType,
  SignedBy,
  SignedByEd25519,
  SignedByHubStamp,
  SigningIdentity,
  SigningMethod,
  VerificationResult,
} from './identity';

export { canonicalizeForSigning, signEnvelope, verifyEnvelopeIdentity, requireVerifiedIdentity, createInMemoryRegistry, loadRegistry, DID_RE, BASE64_RE } from './identity';
export type { PrincipalRegistry, PrincipalRegistryFile, VerifyOptions } from './identity';

export {
  generateCorrelationId,
  isValidCorrelationId,
  deriveLifecycleSubject,
  deriveLifecycleWildcard,
  validateEmissionRules,
  createLifecycleEmitter,
  subscribeLifecycle,
  getEventsStreamConfig,
  STATE_TO_TYPE,
} from './dispatch';
export type {
  LifecycleState,
  ProgressSeverity,
  AbortReason,
  BaseLifecyclePayload,
  ReceivedPayload,
  AssignedPayload,
  StartedPayload,
  ProgressPayload,
  CompletedPayload,
  FailedPayload,
  AbortedPayload,
  LifecyclePayload,
  DispatchLifecycleEnvelope,
  LifecycleEmitter,
  LifecycleEmitterOptions,
  SubscribeLifecycleOptions,
  EventsStreamConfig,
} from './dispatch';

export {
  canonicalizeAdvertisement,
  signCapabilityRegistration,
  registerCapabilities,
  updateLoad,
  verifyCapabilityRegistration,
  InMemoryCapabilityStore,
} from './discovery';
export type {
  SovereigntyMode,
  CapabilityAdvertisement,
  SignedCapabilityRegistration,
  CapabilityWatchOperation,
  CapabilityWatchEntry,
  CapabilityWatcher,
  CapabilityVerificationResult,
  CapabilityStore,
} from './discovery';
