/**
 * AST → anchored regex, and closed-literal-set detection for enums (#237).
 *
 * Rule references are INLINED (resolved local → imported → core), so a
 * generated terminal regex is self-contained. Recursion is detected and
 * rejected loudly: the identifier/subject terminals are all finite, and a
 * cyclic terminal cannot become a regex — better a named error than a hang.
 *
 * Length side-conditions (`;@bound`) are NOT baked into the pattern — ABNF
 * (and the grammar comments, e.g. identifiers.abnf §1) treat the octet bound
 * as a SEPARATE normative constraint. The bound is emitted as a JSON-Schema
 * `maxLength`/`minLength` facet and a TS length const; a validator composes
 * pattern + bound (as `parseDid` does, and as the DID acceptance proof does).
 */

import type { Grammar, Node } from "./ast";
import { resolveRefCtx, type Corpus } from "./resolver";

const REGEX_SPECIAL = new Set([..."\\^$.|?*+()[]{}/"]);

function escLiteral(ch: string): string {
  if (ch === "\n") return "\\n";
  if (ch === "\t") return "\\t";
  if (ch === "\r") return "\\r";
  return REGEX_SPECIAL.has(ch) ? "\\" + ch : ch;
}

function escClass(ch: string): string {
  // Inside a character class: escape \ ] ^ - and the delimiter /.
  if ("\\]^-/".includes(ch)) return "\\" + ch;
  if (ch === "\n") return "\\n";
  return ch;
}

/** True if a fragment is a single atom (safe to quantify without grouping). */
function isAtomic(re: string): boolean {
  if (re.length === 1) return true;
  if (/^\\.$/.test(re)) return true; // escaped single char
  if (/^\[[^\]]*\]$/.test(re)) return true; // one char class
  if (/^\(\?:.*\)$/.test(re) && balancedOuter(re)) return true; // one group
  return false;
}

function balancedOuter(re: string): boolean {
  // Verify the leading "(" matches the trailing ")" (not two adjacent groups).
  let depth = 0;
  for (let i = 0; i < re.length; i++) {
    if (re[i] === "\\") { i++; continue; }
    if (re[i] === "(") depth++;
    else if (re[i] === ")") { depth--; if (depth === 0) return i === re.length - 1; }
  }
  return false;
}

function group(re: string): string {
  return isAtomic(re) ? re : `(?:${re})`;
}

/**
 * If `re` is a single-character atom (one literal/escaped char or one char
 * class), return its char-class-content form; else null. Used to merge an
 * alternation of single chars into one class.
 */
function asClassContent(re: string): string | null {
  if (/^\[[^\]]*\]$/.test(re)) return re.slice(1, -1); // existing class → inner
  if (re.length === 1) return escClass(re);
  if (/^\\.$/.test(re)) {
    // an escaped single char, e.g. "\." or "\-"
    const ch = re[1]!;
    return escClass(ch);
  }
  return null;
}

function quantifier(min: number, max: number | null): string {
  if (min === 0 && max === null) return "*";
  if (min === 1 && max === null) return "+";
  if (min === 0 && max === 1) return "?";
  if (max === null) return `{${min},}`;
  if (min === max) return `{${min}}`;
  return `{${min},${max}}`;
}

/** Build an anchor-free regex fragment for `node`, inlining references. */
export function nodeToRegex(corpus: Corpus, grammar: Grammar, node: Node, seen: Set<string> = new Set()): string {
  switch (node.t) {
    case "lit": {
      const body = [...node.value].map(escLiteral).join("");
      if (node.cs) return body;
      // Case-insensitive literal: expand letters to [Aa]; wrap multi-char.
      const ci = [...node.value]
        .map((ch) => {
          const lo = ch.toLowerCase();
          const up = ch.toUpperCase();
          return lo !== up ? `[${escClass(up)}${escClass(lo)}]` : escLiteral(ch);
        })
        .join("");
      return ci;
    }
    case "range":
      return `[${escClass(String.fromCodePoint(node.lo))}-${escClass(String.fromCodePoint(node.hi))}]`;
    case "ref": {
      const key = `${grammar.file}#${node.name}`;
      if (seen.has(key)) throw new Error(`${grammar.file}: recursive rule '${node.name}' cannot be a terminal regex`);
      const ctx = resolveRefCtx(corpus, grammar, node.name);
      return nodeToRegex(corpus, ctx.grammar, ctx.node, new Set(seen).add(key));
    }
    case "alt": {
      const parts = node.opts.map((o) => nodeToRegex(corpus, grammar, o, seen));
      // Collapse an alternation of single-char atoms into one char class
      // (`(?:[a-z]|[0-9])` → `[a-z0-9]`), matching the hand-written regexes the
      // grammars cite. Order-preserving, so still deterministic.
      const classAtoms = parts.map(asClassContent);
      if (classAtoms.every((c) => c !== null)) {
        return `[${classAtoms.join("")}]`;
      }
      return `(?:${parts.join("|")})`;
    }
    case "cat":
      return node.items.map((it) => nodeToRegex(corpus, grammar, it, seen)).join("");
    case "rep": {
      const inner = nodeToRegex(corpus, grammar, node.node, seen);
      return group(inner) + quantifier(node.min, node.max);
    }
  }
}

/** The anchored regex body for a rule (top level of `X = ...`). */
export function ruleRegex(corpus: Corpus, grammar: Grammar, node: Node): string {
  const body = nodeToRegex(corpus, grammar, node);
  // Unwrap one redundant outer non-capturing group for readability — but ONLY
  // when the inner has no top-level alternation, or `^…$` would bind to the
  // first/last branch instead of the whole set (`^a|b$` ≠ `^(?:a|b)$`).
  let inner = body;
  if (/^\(\?:.*\)$/.test(body) && balancedOuter(body)) {
    const candidate = body.slice(3, -1);
    if (!hasTopLevelAlt(candidate)) inner = candidate;
  }
  return `^${inner}$`;
}

/** True if `re` has a `|` at paren/class depth 0. */
function hasTopLevelAlt(re: string): boolean {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < re.length; i++) {
    const c = re[i]!;
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "|" && depth === 0) return true;
  }
  return false;
}

/**
 * If `node` denotes a CLOSED set of literal strings (an alternation whose every
 * branch resolves to a single case-sensitive literal, possibly through refs),
 * return that set in source order; else null. Powers the TS `const` enums.
 */
export function literalSet(corpus: Corpus, grammar: Grammar, node: Node, seen: Set<string> = new Set()): string[] | null {
  switch (node.t) {
    case "lit":
      return node.cs ? [node.value] : null;
    case "ref": {
      const key = `${grammar.file}#${node.name}`;
      if (seen.has(key)) return null;
      const ctx = resolveRefCtx(corpus, grammar, node.name);
      return literalSet(corpus, ctx.grammar, ctx.node, new Set(seen).add(key));
    }
    case "alt": {
      const out: string[] = [];
      for (const o of node.opts) {
        const s = literalSet(corpus, grammar, o, seen);
        if (!s) return null;
        out.push(...s);
      }
      return out;
    }
    default:
      return null;
  }
}
