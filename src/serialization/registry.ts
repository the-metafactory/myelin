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
