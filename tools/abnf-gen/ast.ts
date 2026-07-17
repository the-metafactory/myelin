/**
 * ABNF AST (RFC 5234 + RFC 7405 %s/%i) for the myelin grammar generator (#237).
 *
 * The subset the `specs/grammar/*.abnf` files exercise: rules, alternation,
 * concatenation, repetition, groups, options, rule references, case-sensitive
 * (%s) / insensitive ("...", %i) string literals, and numeric terminals
 * (%xNN, ranges %xNN-NN, and dot-concatenated byte strings %xNN.NN.NN). No
 * incremental alternatives (`=/`), prose-vals, or %b/%d occur in the corpus —
 * the parser rejects anything it does not model rather than guessing.
 */

export type Node =
  | { t: "alt"; opts: Node[] }
  | { t: "cat"; items: Node[] }
  | { t: "rep"; min: number; max: number | null; node: Node }
  | { t: "ref"; name: string }
  /** A literal string. `cs` = case-sensitive (%s / %xNN.NN byte string). */
  | { t: "lit"; value: string; cs: boolean }
  /** A byte range %xLO-HI as a single-char class. */
  | { t: "range"; lo: number; hi: number };

/** A machine-readable side-condition (`;@bound`) attached during resolve. */
export interface BoundAnnotation {
  rule: string;
  min: number;
  max: number;
}

/** A declared cross-file import (`;; imports <rule> FROM <file>`). */
export interface ImportDecl {
  rule: string;
  fromFile: string; // basename, e.g. "identifiers.abnf"
}

export interface Rule {
  name: string;
  node: Node;
  /** 1-based line of the `name =` in the source file. */
  line: number;
}

export interface Grammar {
  file: string; // basename, e.g. "identifiers.abnf"
  rules: Map<string, Rule>;
  imports: ImportDecl[];
  bounds: BoundAnnotation[];
  /** Rule names, in source order (deterministic emit). */
  order: string[];
}
