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
  Economics,
  EconomicsBudget,
  EconomicsActual,
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
  ConsumerHealth,
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
  ensureCorrelationId,
  deriveChildEnvelope,
  createReplyEnvelope,
  reconstructTrace,
  isRootOfTrace,
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
  TraceNode,
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

export {
  validatePolicy,
  assertPolicy,
  createInMemoryPolicyStore,
  createSovereigntyEngine,
} from './sovereignty';

export type {
  SovereigntyPolicy,
  EgressRule,
  ScopeMapping,
  AuditEntry,
  AuditDecision,
  AuditDirection,
  NakReasonCode,
  SovereigntyValidationResult,
  PolicyStore,
  PolicyStoreOptions,
  SovereigntyEngine,
  SovereigntyEngineOptions,
} from './sovereignty';

export {
  DEFAULT_BID_TIMEOUT_MS,
  MAX_WINNER_RETRIES,
  deriveBidRequestSubject,
  deriveAssignmentSubject,
  deriveBidLifecycleSubject,
  createBidRequest,
  signBidResponse,
  verifyBidResponse,
  selectWinner,
  RetryContext,
  createBidLifecycleEvent,
} from './bidding';

export type {
  SelectionStrategy,
  BidRequest,
  BidResponse,
  TaskAssignment,
  BidLifecycleEventType,
  BidLifecycleEventInput,
  CreateBidRequestInput,
  CreateBidResponseInput,
  BidVerificationResult,
  SelectionOutcome,
  RetryContextOptions,
  CreateBidLifecycleEventOptions,
} from './bidding';

export {
  JsonCodec,
  jsonCodec,
  MsgpackCodec,
  msgpackCodec,
  detectCodec,
  createCodecRegistry,
  buildDefaultRegistry,
} from './serialization';
export type {
  Codec,
  CodecId,
  CodecRegistry,
  CodecRegistryOptions,
} from './serialization';

export {
  MiddlewareTransport,
  createMiddlewareTransport,
  loggingMiddleware,
  metricsMiddleware,
} from './transport';
export type {
  MiddlewareDirection,
  MiddlewareContext,
  PublishMiddleware,
  SubscribeMiddleware,
  MiddlewareTransportOptions,
  MiddlewareLogger,
  MiddlewareCounter,
  MiddlewareMetrics,
} from './transport';

export {
  ObservableTransport,
  createObservableTransport,
  SampleHistogram,
} from './observability';

export { bytesToBase64, bytesFromBase64 } from './base64';
export type {
  LatencyHistogram,
  TransportPublishMetrics,
  TransportSubscribeMetrics,
  TransportSovereigntyMetrics,
  TransportMetricsEvent,
  SovereigntyViolationEvent,
  TransportObservabilityListener,
  SovereigntyViolationListener,
  ObservableTransportOptions,
  ConsumerHealthSnapshot,
  ConsumerHealthProvider,
} from './observability';

export {
  generateAgentIdentity,
  rotateAgentIdentity,
  saveAgentIdentity,
  loadAgentIdentity,
  encryptPrivateKey,
  decryptPrivateKey,
  isEncryptedPrivateKey,
  toSigningIdentity,
  toPrincipal,
  registerSelf,
} from './agent-identity';
export type {
  AgentIdentity,
  AgentIdentityFile,
  AgentIdentityFileV1,
  AgentIdentityFileV2,
  AgentIdentityWithoutPrivateKey,
  EncryptedPrivateKey,
  SaveAgentIdentityOptions,
  LoadAgentIdentityOptions,
  GenerateAgentIdentityInput,
  RotateAgentIdentityInput,
  RotateAgentIdentityResult,
  RegisterSelfOptions,
} from './agent-identity';

export {
  validateWorkflow,
  assertWorkflow,
  deriveWorkflowLifecycleSubject,
  createWorkflowLifecycleEvent,
} from './composition';
export type {
  FailureStrategy,
  InterfaceSchema,
  StepKind,
  WorkflowStep,
  WorkflowDefinition,
  WorkflowLifecycleEventType,
  WorkflowLifecyclePayload,
  CreateWorkflowLifecycleEventOptions,
} from './composition';
