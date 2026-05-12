import type { MyelinEnvelope } from "../types";

export interface RequestReplyPrimitives {
  subscribe(
    inboxSubject: string,
    onMessage: (envelope: MyelinEnvelope) => void,
  ): Promise<{ unsubscribe(): void }>;
  publish(subject: string, requestEnvelope: MyelinEnvelope): void;
}

export function executeRequestReply(
  subject: string,
  envelope: MyelinEnvelope,
  timeoutMs: number,
  primitives: RequestReplyPrimitives,
): Promise<MyelinEnvelope> {
  const correlationId = envelope.correlation_id ?? crypto.randomUUID();
  const rawReplyTo = (envelope.extensions as Record<string, unknown> | undefined)?.reply_to;
  const callerReplyTo = typeof rawReplyTo === "string" ? rawReplyTo : undefined;
  if (callerReplyTo !== undefined) {
    if (
      !callerReplyTo.startsWith("_INBOX.") ||
      callerReplyTo.includes("*") ||
      callerReplyTo.includes(">") ||
      callerReplyTo === "_INBOX."
    ) {
      throw new Error(
        `Invalid reply_to subject '${callerReplyTo}' — must be a concrete _INBOX.{id} subject (no wildcards)`,
      );
    }
  }
  const inboxSubject = callerReplyTo ?? `_INBOX.${crypto.randomUUID()}`;

  const requestEnvelope: MyelinEnvelope = {
    ...envelope,
    correlation_id: correlationId,
    extensions: { ...envelope.extensions, reply_to: inboxSubject },
  };

  return new Promise<MyelinEnvelope>((resolve, reject) => {
    let settled = false;
    let unsub: (() => void) | null = null;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub?.();
      reject(new Error(`Request timed out after ${timeoutMs}ms on ${subject}`));
    }, timeoutMs);

    const settle = (result: MyelinEnvelope | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub?.();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    primitives
      .subscribe(inboxSubject, (response) => {
        if (settled) return;
        if (response.correlation_id !== correlationId) return;
        settle(response);
      })
      .then((sub) => {
        unsub = () => sub.unsubscribe();
        if (settled) {
          sub.unsubscribe();
          return;
        }
        try {
          primitives.publish(subject, requestEnvelope);
        } catch (err) {
          settle(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .catch((err) => {
        settle(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
