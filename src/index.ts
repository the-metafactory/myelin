export {
  createEnvelope,
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
} from './transport';

export type {
  Principal,
  PrincipalType,
  SignedBy,
  SignedByEd25519,
  SignedByHubStamp,
  SigningMethod,
  VerificationResult,
} from './identity';

export { canonicalizeForSigning, signEnvelope, verifyEnvelopeIdentity, requireVerifiedIdentity, createInMemoryRegistry, loadRegistry, DID_RE, BASE64_RE } from './identity';
export type { PrincipalRegistry, PrincipalRegistryFile, VerifyOptions } from './identity';
