module.exports = {
  env: { browser: true, es2021: false },
  parserOptions: { ecmaVersion: 5, sourceType: "script" },
  rules: {
    "no-undef": "error",
    "no-redeclare": "error",
    "no-unused-vars": ["error", { "vars": "all", "args": "none" }],
    "no-extra-semi": "error",
    "no-unexpected-multiline": "error",
    "es/no-es2015": "error"
  },
  plugins: ["es"]
};
