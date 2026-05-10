/**
 * F-13: shared helpers for integration tests against a live NATS server.
 *
 * Tests skip themselves when NATS_URL env var is unset, so the suite
 * is safe to run via `bun test` on machines without a broker. CI sets
 * NATS_URL to nats://localhost:4222 and brings up the broker via
 * docker-compose.test.yml beforehand.
 */
import { NATSTransport } from "../../src/transport/nats";

export const NATS_URL = process.env.NATS_URL ?? "";

export const hasNats = NATS_URL.length > 0;

/**
 * Per-suite isolation prefix. Combined with the test name, this gives
 * stream/consumer/subject names that don't collide across parallel
 * test runs. Includes a UUID so reruns of the same suite don't clash.
 */
export function testPrefix(suite: string): string {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomUUID().slice(0, 8);
  return `${suite}_${stamp}_${rand}`.toUpperCase();
}

export interface TestEnvOptions {
  streamName: string;
  subjects: string[];
}

/**
 * Construct a NATSTransport pointed at the env-provided server, and
 * provision a JetStream stream scoped to this test. Returns the
 * transport plus a `cleanup` function the test calls in afterAll
 * (stream delete, transport close).
 */
export async function provisionNatsStream(options: TestEnvOptions): Promise<{
  transport: NATSTransport;
  cleanup: () => Promise<void>;
}> {
  const transport = new NATSTransport({
    servers: NATS_URL,
    name: `myelin-test-${options.streamName}`,
    streamName: options.streamName,
    reconnect: true,
    maxReconnectAttempts: 5,
  });

  // Provision a JetStream stream scoped to this test. Idempotent —
  // existing streams are reused.
  await transport.ensureStream(options.streamName, options.subjects);

  return {
    transport,
    cleanup: async () => {
      // Best-effort stream cleanup so we don't litter test data across
      // runs. Reach through the jetstream manager via internal API
      // since NATSTransport doesn't expose a deleteStream helper yet.
      try {
        const internal = transport as unknown as { jsm: { streams: { delete(name: string): Promise<unknown> } } | null };
        if (internal.jsm) {
          await internal.jsm.streams.delete(options.streamName);
        }
      } catch {
        // Stream might already be gone or jsm unavailable on a torn-down
        // connection — cleanup is best-effort.
      }
      await transport.close();
    },
  };
}

/** Wait until predicate is true or timeout elapses. */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const start = Date.now();
  while (true) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timeout (${timeoutMs}ms): ${options.message ?? "predicate did not become true"}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
