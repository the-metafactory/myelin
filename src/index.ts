export {
  createEnvelope,
  createSignedEnvelope,
  validateEnvelope,
  safeDecodeEnvelope,
  parseSovereignty,
  parseSovereigntyBlock,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
  getActorIdentity,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- back-compat alias for the getActorIdentity rename (R2). Removed in the next major.
  getActorPrincipal,
} from './envelope';

export type {
  SubjectAlignment,
  SafeDecodeOptions,
  SovereigntyBlockReason,
  SovereigntyBlockResult,
} from './envelope';

export {
  STACK_SEGMENT_REGEX,
  deriveLegacySubjectPattern,
  detectSubjectForm,
  deriveSubject,
  subjectPrefixAligns,
  isSubjectClassification,
  encodeDidSegment,
  offerTaskSubject,
  directTaskSubject,
  taskSubject,
  taskSubjectAndType,
  dispatchTaskLifecycleSubject,
  dispatchTaskLifecycleWildcard,
  biddingLifecycleSubject,
  workflowLifecycleSubject,
  bidRequestSubject,
  bidAssignmentSubject,
  taskDeadLetterSubject,
  transportMetricsSubject,
  verdictSubject,
  prVerdictSubjectAndType,
  verdictWildcard,
  subjectFor,
} from './subjects';

export type {
  SubjectForm,
  SubjectFormDetection,
  SubjectClassification,
  SubjectSpec,
} from './subjects';

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
  Originator,
  AttributionMode,
} from './types';

export {
  NATSTransport,
  WebSocketTransport,
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
  WebSocketTransportOptions,
  JetStreamTransportOptions,
  EnvelopeTransportOptions,
  TransportPublisher,
  TransportSubscriber,
  EnvelopePublisher,
  EnvelopeSubscriber,
  EnvelopePublishInput,
  EnvelopeRequestInput,
  RequestOptions,
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
  EnsureStreamConfig,
  StreamStorage,
  StreamRetention,
  StreamDiscard,
} from './transport';

// Vocabulary migration (2026-05): Identity / IdentityType are canonical;
// Principal / PrincipalType stay as deprecated re-export aliases
// through the next major. Re-exporting an alias IS the back-compat
// hook this PR delivers — silence the no-deprecated rule on the block.
/* eslint-disable @typescript-eslint/no-deprecated */
export type {
  Identity,
  IdentityType,
  Principal,
  PrincipalType,
  SignedBy,
  SignedByEd25519,
  SignedByHubStamp,
  SigningIdentity,
  SigningMethod,
  StampRole,
  StampVerdict,
  VerificationResult,
} from './identity';
/* eslint-enable @typescript-eslint/no-deprecated */

export {
  canonicalizeForSigning,
  canonicalizeForChainStamp,
  signEnvelope,
  verifyEnvelopeIdentity,
  requireVerifiedIdentity,
  createInMemoryRegistry,
  loadRegistry,
  DID_RE,
  BASE64_RE,
  toSignedByChain,
  getSignedByChain,
  normalizeSignedBy,
  getLastStampPrincipal,
  MAX_CHAIN_LENGTH,
} from './identity';
export type {
  IdentityRegistry,
  IdentityRegistryFile,
  VerifyOptions,
  RequireVerifiedIdentityOptions,
  SignEnvelopeOptions,
} from './identity';
// R1 (vocabulary migration 2026-05) — `PrincipalRegistry` /
// `PrincipalRegistryFile` renamed to `IdentityRegistry` /
// `IdentityRegistryFile`. The deprecated aliases are re-exported from the
// package entrypoint so external importers compile unchanged through the
// transition; re-exporting the alias IS the back-compat hook.
/* eslint-disable @typescript-eslint/no-deprecated */
export type { PrincipalRegistry, PrincipalRegistryFile } from './identity';
/* eslint-enable @typescript-eslint/no-deprecated */

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
  lifecycleSubjectAndType,
  validateEmissionRules,
  createDispatchLifecycleEvent,
  createLifecycleEmitter,
  subscribeLifecycle,
  getEventsStreamConfig,
  STATE_TO_TYPE,
  // R2 transition reader (vocabulary migration 2026-05, PR-7) — dual-read
  // for the dispatch-payload `principal` → `identity` rename.
  readPayloadIdentity,
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
  DeadLetterFailedPayload,
  AbortedPayload,
  RejectedPayload,
  LifecyclePayloadByState,
  LifecyclePayload,
  DispatchLifecycleEnvelope,
  LifecycleEventPayloadInput,
  CreateLifecycleEventOptions,
  LifecyclePublishEvent,
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
  // R2 (vocabulary migration 2026-05, PR-9) — discovery dual-field reader.
  readAdvertisementIdentity,
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
  createKVPolicyStore,
  createSovereigntyEngine,
  createAuditLog,
  auditSubject,
  AUDIT_STREAM_DEFAULT,
  AUDIT_SUBJECT_PREFIX_DEFAULT,
  AUDIT_RETENTION_NS_DEFAULT,
  createSovereignTransport,
  SovereigntyBlockedError,
  SOVEREIGNTY_NAK_PREFIX_DEFAULT,
  SOVEREIGNTY_NAK_SOURCE_DEFAULT,
  SOVEREIGNTY_NAK_TYPE,
  generateExportCommands,
  generateImportCommands,
  generateFederationScript,
  verifyChainSovereignty,
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
  InMemoryPolicyStore,
  InMemoryPolicyStoreOptions,
  KVPolicyStoreOptions,
  SovereigntyEngine,
  SovereigntyEngineOptions,
  AuditLog,
  AuditLogOptions,
  SovereignTransport,
  SovereignTransportOptions,
  SovereigntyNakDetail,
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
  collectBids,
  createBiddingPublisher,
  createBiddingAgent,
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
  BidSource,
  BidDrop,
  CollectBidsInput,
  BidCollectionResult,
  PublishFn,
  BiddingPublisher,
  BiddingPublisherOptions,
  RunBiddingRoundInput,
  RunBiddingRoundResult,
  PublishedEvent,
  PublishedEventKind,
  WinnerAck,
  WinnerAckResult,
  BidEvaluator,
  BiddingAgent,
  BiddingAgentOptions,
  AgentObservation,
  AgentObservationKind,
  AgentTransportSubscribe,
  AgentTransportPublish,
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
  TransportRequestMetrics,
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
  toIdentity,
  registerSelf,
} from './agent-identity';
// `toPrincipal` is a deprecated alias of `toIdentity` (R1, vocabulary
// migration 2026-05) — re-exported on the package surface so external
// importers keep compiling through the deprecation window. The
// eslint-disable silences no-deprecated on the alias re-export — that
// re-export IS the back-compat hook.
/* eslint-disable @typescript-eslint/no-deprecated */
export { toPrincipal } from './agent-identity';
/* eslint-enable @typescript-eslint/no-deprecated */
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
  buildStepGraph,
  detectCycle,
  findEntrySteps,
  findTerminalSteps,
  reachableFrom,
  topologicalSort,
  findUnreachableSteps,
  createInMemoryWorkflowExecutionStore,
  validateData,
  compileSchema,
  validateSchemaCompatibility,
  createOrchestrator,
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
  StepGraph,
  ExecutionStatus,
  StepStatus,
  StepErrorCode,
  StepError,
  StepResult,
  WorkflowExecution,
  WorkflowExecutionStore,
  WorkflowExecutionEvent,
  WorkflowExecutionEventKind,
  WorkflowExecutionWatchOptions,
  InMemoryWorkflowExecutionStore,
  InMemoryWorkflowExecutionStoreOptions,
  JSONSchema,
  SchemaValidationError,
  SchemaValidationResult,
  CompiledValidator,
  WorkflowOrchestrator,
  OrchestratorOptions,
  ExecuteWorkflowInput,
  ExecuteWorkflowResult,
  DispatchTaskCompletedPayload,
  DispatchTaskFailedPayload,
} from './composition';
