import pluginEs from "eslint-plugin-es";

export default [
  {
    files: ["src/**/*.js", "src/Verter.user.js"],
    ignores: [],
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
    plugins: { es: pluginEs },
    rules: {
      "no-undef": "error",
      "no-redeclare": "error",
      "no-unused-vars": ["error", { "vars": "all", "args": "none" }],
      "no-extra-semi": "error",
      "no-unexpected-multiline": "error",

      // Жёстко запрещаем всё новее ES5 (чтобы ЧС/PCS ловил "детские" ошибки)
      "es/no-es2015": "error",
      "es/no-es2016": "error",
      "es/no-es2017": "error",
      "es/no-es2018": "error",
      "es/no-es2019": "error",
      "es/no-es2020": "error",
      "es/no-es2021": "error",
      "es/no-es2022": "error",
      "es/no-es2023": "error"
    }
  }
];
