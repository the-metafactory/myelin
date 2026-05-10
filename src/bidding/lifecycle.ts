import type { MyelinEnvelope, Sovereignty } from "../types";
import { createEnvelope } from "../envelope";
import type { BidLifecycleEventInput, BidLifecycleEventType } from "./types";
import { deriveBidLifecycleSubject } from "./subjects";

export interface CreateBidLifecycleEventOptions {
  org: string;
  source: string;
  sovereignty: Sovereignty;
  type: BidLifecycleEventType;
  input: BidLifecycleEventInput;
  correlation_id?: string;
}

/**
 * Construct an unsigned bidding lifecycle envelope. Returned envelope is
 * unsigned because signing is owned by the publishing transport (per
 * dispatch/lifecycle.ts pattern). Signing here would either duplicate
 * effort or trigger "already signed" failures when the envelope hits a
 * signing transport.
 */
export function createBidLifecycleEvent(
  options: CreateBidLifecycleEventOptions,
): { subject: string; envelope: MyelinEnvelope } {
  const subject = deriveBidLifecycleSubject(options.org, options.type);
  const envelope = createEnvelope({
    source: options.source,
    type: `dispatch.bid.${options.type}`,
    sovereignty: options.sovereignty,
    payload: { ...options.input },
    ...(options.correlation_id ? { correlation_id: options.correlation_id } : {}),
  });
  return { subject, envelope };
}
