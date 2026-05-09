// F-020: correlation-id utilities. UUIDv4 by construction.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function isValidCorrelationId(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}
