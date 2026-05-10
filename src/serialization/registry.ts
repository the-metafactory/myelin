import type { Codec, CodecId, CodecRegistry } from "./types";
import { jsonCodec } from "./json";

/**
 * F-3: codec registry. The default registry has JSON registered. The
 * MsgpackCodec is intentionally NOT bundled — register it explicitly
 * via createCodecRegistry({ codecs: [...] }) when @msgpack/msgpack is
 * available, so the runtime cost is opt-in.
 */
export interface CodecRegistryOptions {
  codecs?: Codec[];
  includeDefaults?: boolean;
}

class DefaultCodecRegistry implements CodecRegistry {
  private readonly codecs = new Map<CodecId, Codec>();

  constructor(initial: Codec[] = []) {
    for (const c of initial) this.codecs.set(c.id, c);
  }

  get(id: CodecId): Codec {
    const codec = this.codecs.get(id);
    if (!codec) {
      throw new Error(`CodecRegistry: no codec registered for '${id}' (registered: ${this.list().join(", ") || "<none>"})`);
    }
    return codec;
  }

  list(): CodecId[] {
    return Array.from(this.codecs.keys());
  }

  register(codec: Codec): void {
    this.codecs.set(codec.id, codec);
  }
}

export function createCodecRegistry(options: CodecRegistryOptions = {}): CodecRegistry {
  const includeDefaults = options.includeDefaults ?? true;
  const initial: Codec[] = [];
  if (includeDefaults) initial.push(jsonCodec);
  if (options.codecs) initial.push(...options.codecs);
  return new DefaultCodecRegistry(initial);
}

/**
 * Build the default inbound registry for a transport configured with
 * `codec`. The registry always includes `jsonCodec` (the historical
 * wire format — keeps subscribers compatible with legacy publishers
 * during a rolling migration). When `codec` is also `jsonCodec`, no
 * extra entry is added.
 *
 * Centralizing this rule means a future change (e.g., default-include
 * CBOR alongside JSON) only updates one place — every transport that
 * defers to `buildDefaultRegistry` picks it up automatically.
 */
export function buildDefaultRegistry(codec: Codec): CodecRegistry {
  return createCodecRegistry({
    codecs: codec.id === "json" ? [] : [codec],
  });
}
