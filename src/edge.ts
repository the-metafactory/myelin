/**
 * Edge-portable myelin surface (myelin#190) — import as
 * `@the-metafactory/myelin/edge` from Cloudflare Workers, Durable
 * Objects, browsers, or any runtime without raw TCP / a filesystem.
 *
 * Why this exists: the package ROOT barrel re-exports `NATSTransport`,
 * whose `@nats-io/transport-node` dependency is CommonJS. CJS defeats
 * esbuild-style tree-shaking, and wrangler bundles with esbuild — the
 * reflex#16 dry-run build measured dormant transport-node plus
 * node:net/node:fs code in its Worker bundle as a result (observed for
 * that toolchain; other bundlers may differ). This entrypoint
 * re-exports ONLY modules
 * whose transitive import graph is free of Node built-ins and
 * transport-node — guarded by the bundle probe in
 * `src/edge-surface.test.ts`: a Bun browser-target bundle of this file
 * must contain zero `@nats-io/transport-node`, `node:fs`, `node:net`,
 * or `node:os` references (evidence for that build path; not a formal
 * guarantee across every bundler).
 *
 * Rules for adding exports here:
 * 1. The module's TRANSITIVE graph must be Node-free (the probe is the
 *    gate — it bundles, so it sees through every hop).
 * 2. `process.*` may not appear outside comments (Workers have no
 *    `process` global) — use `console.error` for operator-visible
 *    warnings.
 * 3. Never re-export the root barrel or anything reaching `nats.ts`,
 *    `identity/registry.ts` (module-scope node:fs), or
 *    `observability/transport.ts`.
 */

// ── envelope: create / validate / wire types ─────────────────────────
export { createEnvelope, validateEnvelope } from "./envelope";
export type {
  MyelinEnvelope,
  CreateEnvelopeInput,
  ValidationResult,
  ValidationError,
  Classification,
  DistributionMode,
  Sovereignty,
} from "./types";

// ── transports: WebSocket (edge network) + InMemory (tests) ──────────
export { WebSocketTransport, type WebSocketTransportOptions } from "./transport/websocket";
export { InMemoryTransport, type InMemoryTransportOptions } from "./transport/in-memory";
export type {
  JetStreamTransportOptions,
  ConsumerHealth,
  EnsureStreamConfig,
  StreamStorage,
  StreamRetention,
  StreamDiscard,
} from "./transport/jetstream-base";

// ── envelope layer over a transport ──────────────────────────────────
export { EnvelopeTransport, type EnvelopeTransportOptions } from "./transport/envelope";
export type {
  TransportPublisher,
  TransportSubscriber,
  EnvelopePublisher,
  EnvelopeSubscriber,
  EnvelopePublishInput,
  EnvelopeRequestInput,
  RequestOptions,
  SubscribeOptions,
  Subscription,
} from "./transport/types";

// ── middleware (metrics / logging) ───────────────────────────────────
export {
  MiddlewareTransport,
  createMiddlewareTransport,
  loggingMiddleware,
  metricsMiddleware,
} from "./transport/middleware";
export type {
  MiddlewareDirection,
  MiddlewareContext,
  PublishMiddleware,
  SubscribeMiddleware,
  MiddlewareTransportOptions,
  MiddlewareLogger,
  MiddlewareCounter,
  MiddlewareMetrics,
} from "./transport/middleware";

// ── subjects + request/reply + NAK ───────────────────────────────────
export { subjectMatchesPattern } from "./subject-matching";
export {
  executeRequestReply,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type RequestReplyPrimitives,
} from "./transport/request-reply";
export {
  nakWithReason,
  nakWithReasonSync,
  NAK_REASON_HEADER,
  NAK_DESCRIPTION_HEADER,
  NAK_BACKOFF,
} from "./transport/nak";
export type { NakReason, NakOptions, NakContext, TaskRejectedEvent, NakableMessage } from "./transport/nak";

// ── serialization codecs ─────────────────────────────────────────────
export {
  jsonCodec,
  buildDefaultRegistry,
  detectCodec,
} from "./serialization";
export type { Codec, CodecRegistry, CodecId, CodecRegistryOptions } from "./serialization";
