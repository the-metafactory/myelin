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
 */
export function compileSubjectPattern(pattern: string): RegExp {
  const tokens = pattern.split(".");
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
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

export function subjectMatchesPattern(subject: string, pattern: string): boolean {
  return compileSubjectPattern(pattern).test(subject);
}
