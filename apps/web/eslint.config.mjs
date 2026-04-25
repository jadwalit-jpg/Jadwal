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
