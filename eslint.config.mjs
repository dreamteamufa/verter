export default [
  {
    files: ["src/**/*.js", "src/Verter.user.js"],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        console: "readonly",
        MutationObserver: "readonly",
        KeyboardEvent: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-redeclare": "error",
      "no-unused-vars": ["error", { "vars": "all", "args": "none" }],
      "no-extra-semi": "error",
      "no-unexpected-multiline": "error"
    }
  }
];
