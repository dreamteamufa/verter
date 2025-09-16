// scripts/smoke-run.js
// Жёсткий смоук для PCS: защищённый запуск, подробный лог в build/smoke-error.log, заглушки GM/DOM.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = path.join(__dirname, "..", "src", "Verter.user.js");
const OUT_DIR = path.join(__dirname, "..", "build");
const OUT_LOG = path.join(OUT_DIR, "smoke-error.log");

function ensureOutDir() {
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch {}
}

function writeLog(txt) {
  ensureOutDir();
  fs.writeFileSync(OUT_LOG, String(txt), "utf8");
}

function readSource() {
  try { return fs.readFileSync(SRC, "utf8"); }
  catch (e) { writeLog(`Cannot read ${SRC}\n${e.stack||e}`); throw e; }
}

function makeContext() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="app"></div>
      <div class="scrollbar-container deals-list ps"></div>
    </body></html>`,
    { url: "https://pocketoption.com/en/trading/" } // имитируем нужный домен
  );

  // Заглушки Tampermonkey/unsafeWindow/GM_*
  const GM_noop = () => undefined;
  const GM_Storage = new Map();
  const GM_get = (k,d)=> GM_Storage.has(k)?GM_Storage.get(k):d;
  const GM_set = (k,v)=> GM_Storage.set(k,v);

  const ctx = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    location: dom.window.location,
    console: console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: fn => setTimeout(fn, 16),
    cancelAnimationFrame: id => clearTimeout(id),

    // распространённые классы/события
    MutationObserver: dom.window.MutationObserver || class { observe(){} disconnect(){} },
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,

    // Tampermonkey API (no-op)
    unsafeWindow: dom.window,
    GM_setValue: GM_set,
    GM_getValue: GM_get,
    GM_deleteValue: (k)=>GM_Storage.delete(k),
    GM_listValues: ()=>Array.from(GM_Storage.keys()),
    GM_addStyle: GM_noop,
    GM_addValueChangeListener: GM_noop,
    GM_removeValueChangeListener: GM_noop
  };

  // Небольшие страховки на DOM-вызовы
  ctx.document.contains = ctx.document.contains || function(node){
    try { return !!node && this.documentElement.contains(node); } catch { return false; }
  };

  return vm.createContext(ctx, { name: "verter-smoke" });
}

function wrapCode(code) {
  // IIFE с "use strict" и понятным именем файла — чтобы стек был читабельный
  return `(function(){ "use strict";\ntry {\n${code}\n} catch(e) { throw e; }\n})();\n//# sourceURL=src/Verter.user.js`;
}

(function run() {
  console.log("Smoke: start…");
  const context = makeContext();
  const code = readSource();
  const wrapped = wrapCode(code);

  try {
    const script = new vm.Script(wrapped, { filename: "src/Verter.user.js", displayErrors: true });
    script.runInContext(context, { timeout: 15000, displayErrors: true });
    console.log("Smoke: OK (script executed, no immediate crash).");
    process.exit(0);
  } catch (err) {
    const lines = [
      "=== SMOKE RUN ERROR ===",
      new Date().toISOString(),
      "",
      "Message:",
      String(err && err.message || err),
      "",
      "Stack:",
      String(err && err.stack || err),
      "",
      "Hints:",
      "- Если видите ReferenceError X is not defined — добавьте заглушку/проверку на существование.",
      "- Если проблема в селекторе/DOM — после смены актива может понадобиться перепривязка узла.",
      ""
    ];
    writeLog(lines.join("\n"));
    console.error(lines.slice(0,12).join("\n"));
    process.exit(2);
  }
})();
