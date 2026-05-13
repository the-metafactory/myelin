import { describe, it, expect } from "bun:test";
import { InMemoryTransport } from "./in-memory";
import { MiddlewareTransport } from "./middleware/transport";
import type { MyelinEnvelope } from "../types";
import type { TransportSubscriber } from "./types";

const makeEnvelope = (overrides?: Partial<MyelinEnvelope>): MyelinEnvelope => ({
  id: crypto.randomUUID(),
  source: "metafactory.test.requester",
  type: "test.request",
  timestamp: new Date().toISOString(),
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: true,
    model_class: "any",
  },
  payload: { question: "ping" },
  ...overrides,
});

const makeResponse = (
  correlationId: string,
  overrides?: Partial<MyelinEnvelope>,
): MyelinEnvelope => ({
  id: crypto.randomUUID(),
  source: "metafactory.test.responder",
  type: "test.response",
  timestamp: new Date().toISOString(),
  correlation_id: correlationId,
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: true,
    model_class: "any",
  },
  payload: { answer: "pong" },
  ...overrides,
});

describe("InMemoryTransport.request — happy path", () => {
  it("sends request and receives response via reply_to", async () => {
    const t = new InMemoryTransport();

    await t.subscribe("local.metafactory.test.request", async (env) => {
      const replyTo = (env.extensions)?.reply_to as string;
      expect(replyTo).toBeDefined();
      expect(env.correlation_id).toBeDefined();
      const response = makeResponse(env.correlation_id!);
      await t.publish(replyTo, response);
    });

    const request = makeEnvelope();
    const response = await t.request(
      "local.metafactory.test.request",
      request,
    );

    expect(response.type).toBe("test.response");
    expect(response.payload).toEqual({ answer: "pong" });
    expect(response.correlation_id).toBe(request.correlation_id ?? response.correlation_id);
  });

  it("auto-generates correlation_id when not provided", async () => {
    const t = new InMemoryTransport();
    let receivedCorrelationId: string | undefined;

    await t.subscribe("local.metafactory.test.>", async (env) => {
      receivedCorrelationId = env.correlation_id;
      const replyTo = (env.extensions)?.reply_to as string;
      await t.publish(replyTo, makeResponse(env.correlation_id!));
    });

    const request = makeEnvelope();
    expect(request.correlation_id).toBeUndefined();

    const response = await t.request("local.metafactory.test.request", request);

    expect(receivedCorrelationId).toBeDefined();
    expect(receivedCorrelationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.correlation_id).toBe(receivedCorrelationId);
  });

  it("preserves existing correlation_id when provided", async () => {
    const t = new InMemoryTransport();
    const explicitId = "550e8400-e29b-41d4-a716-446655440000";

    await t.subscribe("local.metafactory.test.>", async (env) => {
      const replyTo = (env.extensions)?.reply_to as string;
      await t.publish(replyTo, makeResponse(env.correlation_id!));
    });

    const request = makeEnvelope({ correlation_id: explicitId });
    const response = await t.request("local.metafactory.test.request", request);

    expect(response.correlation_id).toBe(explicitId);
  });
});

describe("InMemoryTransport.request — timeout", () => {
  it("rejects with timeout error when no response arrives", async () => {
    const t = new InMemoryTransport();

    await t.subscribe("local.metafactory.test.>", async () => {
      // intentionally no reply
    });

    const request = makeEnvelope();
    await expect(
      t.request("local.metafactory.test.request", request, { timeoutMs: 50 }),
    ).rejects.toThrow("timed out");
  });

  it("timeout error includes subject name", async () => {
    const t = new InMemoryTransport();

    const request = makeEnvelope();
    try {
      await t.request("local.metafactory.test.timeout", request, { timeoutMs: 50 });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("local.metafactory.test.timeout");
    }
  });
});

describe("InMemoryTransport.request — correlation mismatch", () => {
  it("ignores responses with wrong correlation_id", async () => {
    const t = new InMemoryTransport();

    await t.subscribe("local.metafactory.test.>", async (env) => {
      const replyTo = (env.extensions)?.reply_to as string;
      // Send response with wrong correlation_id first
      await t.publish(replyTo, makeResponse("wrong-correlation-id"));
      // Then send correct one
      await t.publish(replyTo, makeResponse(env.correlation_id!));
    });

    const request = makeEnvelope();
    const response = await t.request(
      "local.metafactory.test.request",
      request,
      { timeoutMs: 1000 },
    );

    expect(response.payload).toEqual({ answer: "pong" });
  });
});

describe("InMemoryTransport.request — edge cases", () => {
  it("throws on request after close", async () => {
    const t = new InMemoryTransport();
    await t.close();
    await expect(
      t.request("test", makeEnvelope()),
    ).rejects.toThrow("closed");
  });

  it("sets extensions.reply_to on the outgoing envelope", async () => {
    const t = new InMemoryTransport();
    let receivedExtensions: Record<string, unknown> | undefined;

    await t.subscribe("local.metafactory.test.>", async (env) => {
      receivedExtensions = env.extensions!;
      const replyTo = receivedExtensions?.reply_to as string;
      await t.publish(replyTo, makeResponse(env.correlation_id!));
    });

    await t.request("local.metafactory.test.request", makeEnvelope());

    expect(receivedExtensions?.reply_to).toBeDefined();
    expect(typeof receivedExtensions?.reply_to).toBe("string");
    expect((receivedExtensions?.reply_to as string).startsWith("_INBOX.")).toBe(true);
  });

  it("preserves existing extensions alongside reply_to", async () => {
    const t = new InMemoryTransport();
    let receivedExtensions: Record<string, unknown> | undefined;

    await t.subscribe("local.metafactory.test.>", async (env) => {
      receivedExtensions = env.extensions!;
      const replyTo = receivedExtensions?.reply_to as string;
      await t.publish(replyTo, makeResponse(env.correlation_id!));
    });

    const request = makeEnvelope({
      extensions: { network_id: "mf", actor: { type: "agent" } },
    });
    await t.request("local.metafactory.test.request", request);

    expect(receivedExtensions?.network_id).toBe("mf");
    expect(receivedExtensions?.reply_to).toBeDefined();
  });

  it("cleans up inbox subscription after successful request", async () => {
    const t = new InMemoryTransport();

    await t.subscribe("local.metafactory.test.>", async (env) => {
      const replyTo = (env.extensions)?.reply_to as string;
      await t.publish(replyTo, makeResponse(env.correlation_id!));
    });

    await t.request("local.metafactory.test.request", makeEnvelope());
    expect((t as any).subscriptions.length).toBe(1);
  });

  it("cleans up inbox subscription after timeout", async () => {
    const t = new InMemoryTransport();

    await t.subscribe("local.metafactory.test.>", async () => {});

    try {
      await t.request("local.metafactory.test.request", makeEnvelope(), { timeoutMs: 50 });
    } catch { /* expected timeout */ }

    await new Promise((r) => setTimeout(r, 10));
    expect((t as any).subscriptions.length).toBe(1);
  });

  it("honors caller-provided extensions.reply_to", async () => {
    const t = new InMemoryTransport();
    const customInbox = "_INBOX.custom-caller-inbox";
    let receivedReplyTo: string | undefined;

    await t.subscribe("local.metafactory.test.>", async (env) => {
      receivedReplyTo = (env.extensions)?.reply_to as string;
      await t.publish(receivedReplyTo, makeResponse(env.correlation_id!));
    });

    const request = makeEnvelope({
      extensions: { reply_to: customInbox },
    });
    const response = await t.request("local.metafactory.test.request", request);

    expect(receivedReplyTo).toBe(customInbox);
    expect(response.payload).toEqual({ answer: "pong" });
  });
});

describe("InMemoryTransport.request — reply_to validation", () => {
  it("rejects non-_INBOX reply_to to prevent subject injection", async () => {
    const t = new InMemoryTransport();

    const request = makeEnvelope({
      extensions: { reply_to: "local.metafactory.sensitive.subject" },
    });
    await expect(
      t.request("local.metafactory.test.request", request),
    ).rejects.toThrow("Invalid reply_to");
  });

  it("rejects _INBOX.* wildcard pattern", async () => {
    const t = new InMemoryTransport();
    await expect(
      t.request("test", makeEnvelope({ extensions: { reply_to: "_INBOX.*" } })),
    ).rejects.toThrow("no wildcards");
  });

  it("rejects _INBOX.> multi-wildcard pattern", async () => {
    const t = new InMemoryTransport();
    await expect(
      t.request("test", makeEnvelope({ extensions: { reply_to: "_INBOX.>" } })),
    ).rejects.toThrow("no wildcards");
  });

  it("rejects bare _INBOX. with no suffix", async () => {
    const t = new InMemoryTransport();
    await expect(
      t.request("test", makeEnvelope({ extensions: { reply_to: "_INBOX." } })),
    ).rejects.toThrow("Invalid reply_to");
  });

  it("ignores non-string reply_to values", async () => {
    const t = new InMemoryTransport();

    await t.subscribe("local.metafactory.test.>", async (env) => {
      const replyTo = (env.extensions)?.reply_to as string;
      await t.publish(replyTo, makeResponse(env.correlation_id!));
    });

    const request = makeEnvelope({
      extensions: { reply_to: 42 },
    });
    const response = await t.request("local.metafactory.test.request", request);
    expect(response.payload).toEqual({ answer: "pong" });
  });
});

describe("MiddlewareTransport.request — middleware filtering", () => {
  it("throws when middleware filters request envelope to null", async () => {
    const inner = new InMemoryTransport();
    const sub: TransportSubscriber = {
      async subscribe() { return { async unsubscribe() {} }; },
      async subscribeBestEffort() { return { async unsubscribe() {} }; },
      async close() {},
    };

    const mt = new MiddlewareTransport({
      publisher: inner,
      subscriber: sub,
      publishMiddleware: [async () => null],
    });

    await expect(
      mt.request("test.subject", makeEnvelope()),
    ).rejects.toThrow("filtered by middleware");
  });
});

describe("MiddlewareTransport.request — subscribe chain on response", () => {
  it("runs subscribe middleware on the response envelope", async () => {
    const inner = new InMemoryTransport();

    await inner.subscribe("local.metafactory.test.>", async (env) => {
      const replyTo = (env.extensions)?.reply_to as string;
      await inner.publish(replyTo, makeResponse(env.correlation_id!));
    });

    const seen: string[] = [];
    const mt = new MiddlewareTransport({
      publisher: inner,
      subscriber: inner,
      subscribeMiddleware: [
        async (env, ctx) => {
          seen.push(ctx.direction);
          return env;
        },
      ],
    });

    const response = await mt.request("local.metafactory.test.request", makeEnvelope());
    expect(response.payload).toEqual({ answer: "pong" });
    expect(seen).toContain("subscribe");
  });

  it("throws when subscribe middleware filters response to null", async () => {
    const inner = new InMemoryTransport();

    await inner.subscribe("local.metafactory.test.>", async (env) => {
      const replyTo = (env.extensions)?.reply_to as string;
      await inner.publish(replyTo, makeResponse(env.correlation_id!));
    });

    const mt = new MiddlewareTransport({
      publisher: inner,
      subscriber: inner,
      subscribeMiddleware: [async () => null],
    });

    await expect(
      mt.request("local.metafactory.test.request", makeEnvelope()),
    ).rejects.toThrow("Response envelope filtered by subscribe middleware");
  });
});
