import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**"] },
  {
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    files: ["eslint.config.js", "vite.config.js", "postcss.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
