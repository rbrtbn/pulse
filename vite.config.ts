import { defineConfig } from "vite-plus";

export default defineConfig({
  // Vitest: tests live next to source files as *.test.ts(x)
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.tanstack/**"],
  },

  // Oxlint with type-aware checks. tsgolint does not support compilerOptions.baseUrl
  // (tsconfig.base.json deliberately omits it).
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ["dist/**", "node_modules/**", ".tanstack/**", "data/**"],
  },

  // Oxfmt. Double quotes + semicolons; sortPackageJson for noise-free package.json diffs.
  // Markdown is excluded — prose formatting is not load-bearing and reformatting vendored
  // skills / ADRs / CLAUDE.md would be cross-cutting noise. Add markdown back when prose
  // tooling is decided.
  fmt: {
    semi: true,
    singleQuote: false,
    sortPackageJson: true,
    ignorePatterns: [
      "dist/**",
      "node_modules/**",
      ".tanstack/**",
      "data/**",
      "coverage/**",
      "**/*.md",
      ".agents/**",
      ".claude/**",
    ],
  },

  // vp staged: pre-commit hook target
  staged: {
    "*.{ts,tsx,json,md}": "vp check --fix",
  },
});
