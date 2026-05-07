import type { TransportPublisher, TransportSubscriber } from "./types";
import { NATSTransport, type NATSTransportOptions } from "./nats";

export type TransportConfig = {
  type: "nats";
} & NATSTransportOptions;

export function createTransport(
  config: TransportConfig,
): TransportPublisher & TransportSubscriber {
  return new NATSTransport(config);
}
