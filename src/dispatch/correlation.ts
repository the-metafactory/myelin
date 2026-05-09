// F-020: correlation-id utilities. UUIDv4 by construction.

import { isValidUUID } from "../uuid";

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function isValidCorrelationId(id: string): boolean {
  return isValidUUID(id);
}
