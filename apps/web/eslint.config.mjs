import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat-config arrays (no more legacy
// eslintrc `{ extends: [...] }` shape), so they're imported and spread
// directly — no FlatCompat shim needed anymore.
const eslintConfig = defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  // Downgrade the noisier `next/typescript` rules from error -> warn.
  // The codebase has ~3 k legitimate uses of `any` / require() that
  // would all need rewrites, and turning the lint job into a wall of
  // errors blocks every PR for a v1 launch concern that's lower
  // priority than functional CI gates. Security-critical rules
  // (no-restricted-syntax block below, next-image) stay at error.
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-wrapper-object-types": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      "react/no-unescaped-entities": "warn",
      // eslint-plugin-react-hooks 7 (bundled with eslint-config-next 16)
      // adds a new "React Compiler" rule set (set-state-in-effect, purity,
      // immutability, refs, preserve-manual-memoization, static-components)
      // that the codebase predates and was never written against — ~40
      // pre-existing violations across 25+ files. Downgraded to warn for
      // the same reason as the block above: not a regression, just a
      // stricter default the app hasn't been audited against yet.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
      "prefer-const": "warn",
    },
  },
  // Files we never want ESLint to look at. Bundled / generated /
  // tool-output files have minified single-line JS that triggers
  // hundreds of false-positive errors and is never user-edited.
  globalIgnores([
    // Default ignores of eslint-config-next
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test runner outputs — bundled HTML viewer + trace assets
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    // Visual-regression baselines are PNGs, not lintable
    "**/*-snapshots/**",
    // Misc
    "node_modules/**",
  ]),
  // ─── Security: ban dangerous sinks that enable stored-XSS → redirect ──
  // These patterns let attacker-controlled strings (from DB, API, user input)
  // become executable DOM. Blocking them at lint-time means a PR that adds
  // them fails CI — no way to ship a porn-redirect vector by accident.
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            "dangerouslySetInnerHTML is banned — it is the single biggest XSS-to-redirect sink. " +
            "Render with JSX (auto-escaped) or use a vetted sanitiser like sanitize-html with a strict allowlist.",
        },
        {
          selector:
            "CallExpression[callee.name='eval']",
          message: "eval() is banned — executes arbitrary strings as code.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "new Function() is banned — same risk as eval().",
        },
        {
          selector:
            "AssignmentExpression[left.property.name='innerHTML']",
          message:
            ".innerHTML = ... is banned — use textContent or React state instead.",
        },
        {
          selector:
            "AssignmentExpression[left.property.name='outerHTML']",
          message: ".outerHTML = ... is banned — same risk as innerHTML.",
        },
        {
          // setTimeout('string', ...) and setInterval('string', ...)
          // execute the string as code — banned.
          selector:
            "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type='Literal']",
          message:
            "setTimeout/setInterval with a string argument is banned — it evaluates the string as code. Pass a function reference instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
