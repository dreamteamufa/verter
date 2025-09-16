const { JSDOM } = require("jsdom");
const fs = require("fs");
const vm = require("vm");

const dom = new JSDOM(`<!doctype html><div id="app"></div>`, { url: "https://example.com" });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;

global.MutationObserver = class { observe(){} disconnect(){} };
global.KeyboardEvent = dom.window.KeyboardEvent;

const code = fs.readFileSync("src/Verter.user.js", "utf8");
try {
  vm.runInNewContext(code, { window, document, localStorage, MutationObserver, KeyboardEvent, console }, { timeout: 2000 });
  console.log("✅ Smoke OK: script executed without runtime crashes.");
} catch (e) {
  console.error("❌ Smoke FAIL:", e && e.stack ? e.stack.split("\n")[0] : e);
  process.exit(1);
}
