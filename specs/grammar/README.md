# Grammar

Each syntactic RFC has exactly one `.abnf` file here. It is the **normative** definition of that
document's syntax, in Augmented BNF [RFC5234].

## Why a file and not a fenced block

A grammar nobody machine-reads is prose with extra punctuation. CI parses these files. An RFC's
Appendix A reproduces the grammar for the reader; **this directory holds the source.**

## Rules

1. **One file per RFC**, named for the RFC's short name, and referenced from that RFC's `grammar`
   front-matter field.
2. **CI MUST validate that each file parses as ABNF.** A grammar that does not parse is not a
   grammar.
3. **Downstream artifacts are generated, never authored.** Regexes, JSON Schema `pattern`s and
   parsers derive from these files and are listed in the RFC's `generated` field. CI regenerates
   and fails on drift.
4. **Use the core rules** from [RFC5234] Appendix B (`ALPHA`, `DIGIT`, `HEXDIG`, …) rather than
   redefining them.
5. **Terminal alphabets are defined once**, in the RFC that owns the identifier, and referenced by
   the others. An alphabet defined twice is an alphabet that will drift.

## Worked example

```abnf
; specs/grammar/identifiers.abnf  (illustrative — RFC-0001 is not yet drafted)

principal-id  = ALPHA *( ALPHA / DIGIT / "-" )
stack-slug    = ALPHA *( ALPHA / DIGIT / "-" )
stack-id      = principal-id "/" stack-slug
```

Written this way, the grammar answers questions prose lets you skip. "May a stack slug contain a
hyphen?" — yes. And the next question then becomes unavoidable: if `-` is legal *inside* both
`principal-id` and `stack-slug`, what grammar can parse `did:mf:andreas-meta-factory` back into a
principal and a stack?

None can. **The grammar will not let you write down an ambiguity you could hide in prose.** That
discovery is the whole reason this directory exists.

## Conventions

- Lowercase, hyphenated rule names (`stack-id`, not `StackId`).
- A comment line above each rule stating what it denotes in the domain.
- Where a rule mirrors a live regular expression in source, cite the source in a comment — and
  remember that after generation the arrow points the other way: **the source will be generated
  from here.**
