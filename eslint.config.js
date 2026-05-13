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
    },
  },
);
