import type { TransportPublisher, TransportSubscriber } from "./types";
import { NATSTransport, type NATSTransportOptions } from "./nats";
import { InMemoryTransport } from "./in-memory";

export type TransportConfig =
  | ({ type: "nats" } & NATSTransportOptions)
  | { type: "memory" };

export function createTransport(
  config: TransportConfig,
): TransportPublisher & TransportSubscriber {
  switch (config.type) {
    case "nats":
      return new NATSTransport(config);
    case "memory":
      return new InMemoryTransport();
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown transport type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}
