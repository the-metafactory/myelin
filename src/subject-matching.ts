/**
 * Canonical NATS-style subject pattern matcher.
 *
 * Two wildcards:
 *   - `*` matches a single token (between dots)
 *   - `>` matches one or more tokens, must be the final token
 *
 * Literal tokens are escaped so dots and other regex metacharacters in
 * subjects don't accidentally match. Promoted from sovereignty/egress —
 * the in-memory transport now imports from here so a fix to subject
 * grammar lands in one place.
 *
 * ## Compiled-pattern cache (F-5 T-7.2)
 *
 * `compileSubjectPattern` is pure: the same pattern string always
 * produces a behaviourally equivalent `RegExp`. The hot path
 * (sovereignty egress + ingress validators) calls
 * `subjectMatchesPattern(subject, pattern)` once per allowed pattern
 * per envelope, which previously meant a fresh `RegExp` allocation +
 * parse on every validation. The module-level cache below memoizes
 * compiled patterns keyed on the pattern string, eliminating that
 * hot-path allocation.
 *
 * The cache is correctness-safe regardless of policy swaps because
 * the function is referentially transparent. {@link clearSubjectPatternCache}
 * is provided so the {@link PolicyStore} can drop entries on swap and
 * keep the cache from accumulating patterns that no longer appear in
 * the live policy.
 */
const patternCache = new Map<string, RegExp>();

function compileFresh(pattern: string): RegExp {
  const tokens = pattern.split(".");
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === ">") {
      if (i !== tokens.length - 1) {
        throw new Error(`pattern '${pattern}': '>' must be the final token`);
      }
      parts.push("(?:[^.]+(?:\\.[^.]+)*)");
    } else if (tok === "*") {
      parts.push("[^.]+");
    } else {
      parts.push(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
  }
  return new RegExp(`^${parts.join("\\.")}$`);
}

export function compileSubjectPattern(pattern: string): RegExp {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) return cached;
  // Invalid patterns throw before reaching the cache write, so the
  // cache only ever holds successfully compiled patterns.
  const compiled = compileFresh(pattern);
  patternCache.set(pattern, compiled);
  return compiled;
}

export function subjectMatchesPattern(subject: string, pattern: string): boolean {
  return compileSubjectPattern(pattern).test(subject);
}

/**
 * Drop every cached compiled pattern. Called by the policy store on
 * swap so the cache does not retain compiled forms for patterns that
 * are no longer referenced. Safe to call at any time — the next
 * lookup re-compiles on demand.
 */
export function clearSubjectPatternCache(): void {
  patternCache.clear();
}

/**
 * Internal helper for tests. Not exported from the package barrel.
 * Returns the current cache entry count.
 */
export function __subjectPatternCacheSize(): number {
  return patternCache.size;
}
