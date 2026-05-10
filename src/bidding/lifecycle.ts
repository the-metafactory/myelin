import type { MyelinEnvelope, Sovereignty } from "../types";
import type { SigningIdentity } from "../identity/types";
import { createSignedEnvelope } from "../envelope";
import type { BidLifecycleEventInput, BidLifecycleEventType } from "./types";
import { deriveBidLifecycleSubject } from "./subjects";

export interface CreateBidLifecycleEventOptions {
  org: string;
  source: string;
  sovereignty: Sovereignty;
  identity: SigningIdentity;
  type: BidLifecycleEventType;
  input: BidLifecycleEventInput;
}

export async function createBidLifecycleEvent(
  options: CreateBidLifecycleEventOptions,
): Promise<{ subject: string; envelope: MyelinEnvelope }> {
  const subject = deriveBidLifecycleSubject(options.org, options.type);
  const envelope = await createSignedEnvelope(
    {
      source: options.source,
      type: `dispatch.task.${options.type}`,
      sovereignty: options.sovereignty,
      payload: { ...options.input },
    },
    options.identity,
  );
  return { subject, envelope };
}
