export default [
  {
    files: ["src/**/*.js", "src/Verter.user.js"],
    languageOptions: {
      ecmaVersion: 2020,     // разрешаем const/let/совр. синтаксис для ПАРСИНГА
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
    // ВРЕМЕННО отключаем "строгие" правила — включим позже поэтапно
    rules: {
      "no-undef": "off",
      "no-redeclare": "off",
      "no-unused-vars": "off",
      "no-extra-semi": "error",
      "no-unexpected-multiline": "error"
    }
  }
];
