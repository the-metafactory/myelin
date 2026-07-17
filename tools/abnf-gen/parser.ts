/**
 * ABNF lexer + recursive-descent parser (#237). Parses one `.abnf` file into a
 * {@link Grammar}: rules, declared imports (`;; imports <rule> FROM <file>`),
 * and side-condition annotations (`;@bound <rule> <min>..<max>`).
 *
 * Comments (`;`) are stripped AFTER the `;;`/`;@` directives are harvested.
 * Continuation lines (a logical rule spans until the next line that begins a
 * new `name =` at column 0) are joined. Anything the modelled subset does not
 * cover throws with file+line — the generator never guesses at syntax.
 */

import type { Grammar, ImportDecl, BoundAnnotation, Node, Rule } from "./ast";

const RULENAME_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

interface RawRule {
  name: string;
  rhs: string;
  line: number;
}

/** Split source into directives + logical rule lines (continuations joined). */
function preprocess(src: string, file: string): {
  imports: ImportDecl[];
  bounds: BoundAnnotation[];
  rawRules: RawRule[];
} {
  const imports: ImportDecl[] = [];
  const bounds: BoundAnnotation[] = [];
  const rawRules: RawRule[] = [];

  const lines = src.split("\n");
  let current: RawRule | null = null;

  const flush = (): void => {
    if (current) {
      current.rhs = current.rhs.trim();
      rawRules.push(current);
      current = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;

    // Directives ride on comment lines and are harvested before stripping.
    const importMatch = /^\s*;;\s*imports\s+(\S+)\s+FROM\s+(\S+)\s*$/.exec(raw);
    if (importMatch) {
      imports.push({ rule: importMatch[1]!, fromFile: importMatch[2]! });
      continue;
    }
    const boundMatch = /^\s*;@bound\s+(\S+)\s+(\d+)\.\.(\d+)\s*(?:;.*)?$/.exec(raw);
    if (boundMatch) {
      bounds.push({ rule: boundMatch[1]!, min: Number(boundMatch[2]), max: Number(boundMatch[3]) });
      continue;
    }
    if (/^\s*;@/.test(raw)) {
      // Other structured annotations (e.g. ;@cond) are recorded by shape but
      // not yet consumed by an emitter — tolerate, never choke.
      continue;
    }

    // Strip a trailing/whole-line `;` comment (no `;` appears inside the
    // corpus's string literals, so a naive strip is safe here).
    const code = stripComment(raw);
    if (code.trim() === "") {
      // A blank/comment-only line does NOT terminate a rule's continuation in
      // ABNF, but the corpus never interleaves them mid-rule; keep accumulating.
      continue;
    }

    const startsRule = /^\S/.test(code) && /^[A-Za-z][A-Za-z0-9-]*\s*=/.test(code.trimEnd());
    if (startsRule) {
      flush();
      const eq = code.indexOf("=");
      const name = code.slice(0, eq).trim();
      if (code[eq + 1] === "/") {
        throw new Error(`${file}:${lineNo}: incremental alternatives (=/) are not modelled`);
      }
      current = { name, rhs: code.slice(eq + 1), line: lineNo };
    } else {
      if (!current) throw new Error(`${file}:${lineNo}: continuation with no open rule: ${code.trim()}`);
      current.rhs += " " + code.trim();
    }
  }
  flush();
  return { imports, bounds, rawRules };
}

function stripComment(line: string): string {
  const idx = line.indexOf(";");
  return idx === -1 ? line : line.slice(0, idx);
}

// ── RHS tokenizer ──────────────────────────────────────────────────────────

type Tok =
  | { k: "slash" }
  | { k: "lparen" }
  | { k: "rparen" }
  | { k: "lbrack" }
  | { k: "rbrack" }
  | { k: "repeat"; min: number; max: number | null }
  | { k: "ref"; name: string }
  | { k: "lit"; value: string; cs: boolean }
  | { k: "range"; lo: number; hi: number };

function tokenizeRhs(rhs: string, file: string, line: number): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = rhs.length;
  const err = (m: string): never => {
    throw new Error(`${file}:${line}: ${m} (in: ${rhs.trim()})`);
  };
  while (i < n) {
    const c = rhs[i]!;
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "/") { toks.push({ k: "slash" }); i++; continue; }
    if (c === "(") { toks.push({ k: "lparen" }); i++; continue; }
    if (c === ")") { toks.push({ k: "rparen" }); i++; continue; }
    if (c === "[") { toks.push({ k: "lbrack" }); i++; continue; }
    if (c === "]") { toks.push({ k: "rbrack" }); i++; continue; }

    // Repetition prefix: digits and/or '*'.
    if (/[0-9*]/.test(c)) {
      let j = i;
      let a = "";
      while (j < n && /[0-9]/.test(rhs[j]!)) a += rhs[j++]!;
      if (rhs[j] === "*") {
        j++;
        let b = "";
        while (j < n && /[0-9]/.test(rhs[j]!)) b += rhs[j++]!;
        toks.push({ k: "repeat", min: a === "" ? 0 : Number(a), max: b === "" ? null : Number(b) });
      } else {
        if (a === "") err(`stray '*' or malformed repeat`);
        toks.push({ k: "repeat", min: Number(a), max: Number(a) });
      }
      i = j;
      continue;
    }

    // String literal: "...", %s"...", %i"..."
    if (c === '"' || (c === "%" && (rhs[i + 1] === "s" || rhs[i + 1] === "i") && rhs[i + 2] === '"')) {
      let cs: boolean;
      if (c === "%") { cs = rhs[i + 1] === "s"; i += 2; } else { cs = false; }
      // now at opening quote
      i++; // consume "
      let val = "";
      while (i < n && rhs[i] !== '"') val += rhs[i++]!;
      if (rhs[i] !== '"') err(`unterminated string literal`);
      i++; // consume closing "
      toks.push({ k: "lit", value: val, cs });
      continue;
    }

    // Numeric terminal: %xHH , %xHH-HH , %xHH.HH.HH...
    if (c === "%" && rhs[i + 1] === "x") {
      i += 2;
      const readHex = (): number => {
        let h = "";
        while (i < n && /[0-9A-Fa-f]/.test(rhs[i]!)) h += rhs[i++]!;
        if (h === "") err(`expected hex digits after %x`);
        return parseInt(h, 16);
      };
      const first = readHex();
      if (rhs[i] === "-") {
        i++;
        const hi = readHex();
        toks.push({ k: "range", lo: first, hi });
      } else if (rhs[i] === ".") {
        // dot-concatenated byte string → one case-sensitive literal
        let s = String.fromCodePoint(first);
        while (rhs[i] === ".") {
          i++;
          s += String.fromCodePoint(readHex());
        }
        toks.push({ k: "lit", value: s, cs: true });
      } else {
        toks.push({ k: "lit", value: String.fromCodePoint(first), cs: true });
      }
      continue;
    }

    // Rulename
    if (/[A-Za-z]/.test(c)) {
      let name = "";
      while (i < n && /[A-Za-z0-9-]/.test(rhs[i]!)) name += rhs[i++]!;
      toks.push({ k: "ref", name });
      continue;
    }

    err(`unexpected character '${c}'`);
  }
  return toks;
}

// ── RHS parser (alternation / concatenation / repetition / element) ──────────

function parseRhs(rhs: string, file: string, line: number): Node {
  const toks = tokenizeRhs(rhs, file, line);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const err = (m: string): never => {
    throw new Error(`${file}:${line}: ${m} (in: ${rhs.trim()})`);
  };

  function alternation(): Node {
    const opts: Node[] = [concatenation()];
    while (peek()?.k === "slash") { p++; opts.push(concatenation()); }
    return opts.length === 1 ? opts[0]! : { t: "alt", opts };
  }

  function concatenation(): Node {
    const items: Node[] = [repetition()];
    for (;;) {
      const t = peek();
      if (!t || t.k === "slash" || t.k === "rparen" || t.k === "rbrack") break;
      items.push(repetition());
    }
    return items.length === 1 ? items[0]! : { t: "cat", items };
  }

  function repetition(): Node {
    const t = peek();
    if (t?.k === "repeat") {
      p++;
      const node = element();
      return { t: "rep", min: t.min, max: t.max, node };
    }
    return element();
  }

  function element(): Node {
    const t = peek();
    if (!t) return err("unexpected end of rule");
    switch (t.k) {
      case "ref": p++; return { t: "ref", name: t.name };
      case "lit": p++; return { t: "lit", value: t.value, cs: t.cs };
      case "range": p++; return { t: "range", lo: t.lo, hi: t.hi };
      case "lparen": {
        p++;
        const inner = alternation();
        if (peek()?.k !== "rparen") return err("expected ')'");
        p++;
        return inner;
      }
      case "lbrack": {
        p++;
        const inner = alternation();
        if (peek()?.k !== "rbrack") return err("expected ']'");
        p++;
        return { t: "rep", min: 0, max: 1, node: inner };
      }
      default:
        return err(`unexpected token '${t.k}'`);
    }
  }

  const node = alternation();
  if (p !== toks.length) err(`trailing tokens after rule body`);
  return node;
}

/** Parse one `.abnf` file's text into a {@link Grammar}. */
export function parseGrammar(src: string, file: string): Grammar {
  const { imports, bounds, rawRules } = preprocess(src, file);
  const rules = new Map<string, Rule>();
  const order: string[] = [];
  for (const rr of rawRules) {
    if (!RULENAME_RE.test(rr.name)) throw new Error(`${file}:${rr.line}: invalid rule name '${rr.name}'`);
    if (rules.has(rr.name)) throw new Error(`${file}:${rr.line}: duplicate rule '${rr.name}'`);
    const node = parseRhs(rr.rhs, file, rr.line);
    rules.set(rr.name, { name: rr.name, node, line: rr.line });
    order.push(rr.name);
  }
  return { file, rules, imports, bounds, order };
}

export type { Node };
