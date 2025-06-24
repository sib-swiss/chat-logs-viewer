import js from "@eslint/js";
import solid from "eslint-plugin-solid/configs/typescript";
import * as tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    ...solid,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "tsconfig.json",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    // rules: {
    //   "@typescript-eslint/no-explicit-any": "off",
    //   "@typescript-eslint/ban-ts-comment": "off",
    // },
  },
  {
    ignores: ["node_modules", ".output", ".vinxi"],
  },
];
