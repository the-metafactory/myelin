import type { TransportPublisher, TransportSubscriber } from "./types";
import { NATSTransport, type NATSTransportOptions } from "./nats";
import { InMemoryTransport, type InMemoryTransportOptions } from "./in-memory";

export type TransportConfig =
  | ({ type: "nats" } & NATSTransportOptions)
  | ({ type: "memory" } & InMemoryTransportOptions);

export function createTransport(
  config: TransportConfig,
): TransportPublisher & TransportSubscriber {
  switch (config.type) {
    case "nats":
      return new NATSTransport(config);
    case "memory":
      return new InMemoryTransport(config);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown transport type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}
