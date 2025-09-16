export default [
  {
    files: ["src/**/*.js", "src/Verter.user.js"],
    languageOptions: {
      ecmaVersion: 2020,     // ← было 5, из-за этого "const is reserved"
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
