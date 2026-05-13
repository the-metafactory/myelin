// @ts-check
/**
 * ESLint 9 flat config for myelin.
 *
 * Strict TypeScript baseline:
 *   - @eslint/js recommended
 *   - typescript-eslint strictTypeChecked + stylisticTypeChecked
 *
 * Lint targets: src/**, tests/**, bench/**. Type-aware rules use the
 * repo's tsconfig.json so callsite types resolve identically to
 * `bunx tsc --noEmit`.
 *
 * Run:
 *   bun run lint       # report only
 *   bun run lint:fix   # auto-fix where possible
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Repo-wide ignores. Worktree shadow dirs carry stale code that
    // would otherwise produce phantom lint failures.
    ignores: [
      "node_modules/**",
      ".claude/**",
      "dist/**",
      "coverage/**",
      "bench/**/*.js",
      "examples/**/*.js",
      // The flat-config file itself runs outside the typed-project
      // scope (imports `@eslint/js` / `typescript-eslint`, uses
      // `import.meta.dirname`). Linting it surfaces phantom
      // module-resolution + ImportMeta diagnostics. Mirrors
      // arc-eslint's pattern.
      "eslint.config.js",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Use a dedicated lint tsconfig that broadens `include` to
        // `src`, `tests`, `bench` — the production tsc invocation
        // stays scoped to `src` only via tsconfig.json.
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Number interpolation in template literals is universally
      // understood. Booleans likewise — `${someFlag}` reads cleanly.
      // The rest of the rule still fires on `unknown`, `never`, `any`,
      // and exotic objects — those carry real correctness signal.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // Real correctness rules backported from arc-eslint's config
      // (which itself drew on myelin#121-#123 patterns). These catch
      // bug classes that the strictTypeChecked preset doesn't cover
      // by default: unhandled promises, async-where-sync expected,
      // deprecated API usage, redundant type unions.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",

      // Allow `_`-prefixed params/vars/caught-errors as intentional
      // "unused on purpose" markers (e.g., interface-method stubs
      // that ignore some args). Mirrors arc-eslint's convention.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    files: ["**/*.test.ts", "tests/**/*.ts"],
    rules: {
      // Test files frequently reach into private internals and use
      // structurally-typed mocks. Loosen the strictest type rules
      // there so production code stays the strict baseline.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
      // Mocks of async-shaped interfaces (subscribe, publish, unsubscribe,
      // source, …) implement `() => Promise<void>` without I/O to await.
      // The `async` keyword satisfies the type signature; flagging it as
      // unnecessary in test code is pure noise.
      "@typescript-eslint/require-await": "off",
      // Bun-test's `await expect(promise).rejects.toThrow(...)` idiom
      // returns void from the matcher chain. Both rules fire as
      // false positives on every assert of that shape across the suite.
      // Off in tests; production code still gets the strict check.
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/await-thenable": "off",
      // Tests routinely defensive-check values that the production
      // types claim are non-nullable, because mocks structurally
      // typed against an interface may not honor the type's promise.
      // `expect(maybeX).toBeDefined()` and similar guards are
      // intentional in test code.
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Empty mock methods that satisfy an interface contract without
      // behavior (e.g., `close() {}` on a test transport) are routine
      // in tests. Production stubs are handled with per-file banners.
      "@typescript-eslint/no-empty-function": "off",
    },
  },
);
