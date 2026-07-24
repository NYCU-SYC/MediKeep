import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // macOS AppleDouble / metadata junk that gets synced into the repo — these
    // are not real source files and cause "Parsing error: Invalid character".
    "**/._*",
    "**/.DS_Store",
    "**/*.bak",
  ]),
]);

export default eslintConfig;
