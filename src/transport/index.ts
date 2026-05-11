export type {
  TransportPublisher,
  TransportSubscriber,
  EnvelopePublisher,
  EnvelopeSubscriber,
  EnvelopePublishInput,
  SubscribeOptions,
  Subscription,
} from "./types";

export { NATSTransport, type NATSTransportOptions, type ConsumerHealth } from "./nats";
export { EnvelopeTransport, type EnvelopeTransportOptions } from "./envelope";
export { InMemoryTransport, type InMemoryTransportOptions } from "./in-memory";
export { subjectMatchesPattern } from "../subject-matching";
export { TestEnvelopeTransport } from "./test-envelope-transport";
export { createTransport, type TransportConfig } from "./factory";
export {
  nakWithReason,
  nakWithReasonSync,
  NAK_REASON_HEADER,
  NAK_DESCRIPTION_HEADER,
  NAK_BACKOFF,
} from "./nak";
export type { NakReason, NakOptions, NakContext, TaskRejectedEvent, NakableMessage } from "./nak";

export {
  DeadLetterHandler,
  NakChainTracker,
  createDeadLetterEnvelope,
  deriveDeadLetterSubject,
  republishDeadLetter,
  isDeadLetterEnvelope,
} from "./dead-letter";
export type {
  DeadLetterEnvelope,
  DeadLetterExtension,
  DeadLetterHandlerOptions,
} from "./dead-letter";

export {
  MiddlewareTransport,
  createMiddlewareTransport,
  loggingMiddleware,
  metricsMiddleware,
} from "./middleware";
export type {
  MiddlewareDirection,
  MiddlewareContext,
  PublishMiddleware,
  SubscribeMiddleware,
  MiddlewareTransportOptions,
  MiddlewareLogger,
  MiddlewareCounter,
  MiddlewareMetrics,
} from "./middleware";
