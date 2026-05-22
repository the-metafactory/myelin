import { isValidUUID } from "./uuid";

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function isValidCorrelationId(id: string): boolean {
  return isValidUUID(id);
}
