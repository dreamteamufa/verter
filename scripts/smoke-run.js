// scripts/smoke-run.js
// Robust smoke runner for Codex PCS: runs src/Verter.user.js in vm, logs full stack to build/smoke-error.log.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src', 'Verter.user.js');
const OUT_DIR = path.join(__dirname, '..', 'build');
const OUT_LOG = path.join(OUT_DIR, 'smoke-error.log');

function ensureOutDir(){
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch(e){/* ignore */ }
}

function writeLog(msg){
  ensureOutDir();
  fs.appendFileSync(OUT_LOG, msg + '\n\n', 'utf8');
}

function makeContext(){
  const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, { url: "https://example.com" });
  const context = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    MutationObserver: class { observe(){ } disconnect(){ } },
    KeyboardEvent: dom.window.KeyboardEvent,
    // provide small stubs used by your bot if any (add more if necessary)
    MutationObserver: dom.window.MutationObserver || class { observe(){} disconnect(){} },
  };
  return vm.createContext(context, { name: 'verter-smoke-context' });
}

function loadSource(){
  try {
    return fs.readFileSync(SRC, 'utf8');
  } catch(e){
    const msg = `ERROR: cannot read source ${SRC}\n${e.stack||e}`;
    writeLog(msg);
    throw e;
  }
}

async function run(){
  console.log('Smoke: preparing context...');
  const context = makeContext();
  const code = loadSource();

  // Wrap code in IIFE to avoid leaking top-level return/etc and give a filename for stack traces.
  const wrapped = `(function(){\n"use strict";\ntry{\n${code}\n}catch(e){ throw e }\n})();`;

  try {
    console.log('Smoke: executing script in vm (timeout 10000 ms)...');
    // Use Script + runInContext with timeout for better stack traces
    const script = new vm.Script(wrapped, { filename: 'src/Verter.user.js', displayErrors: true });
    script.runInContext(context, { timeout: 10000, displayErrors: true });
    console.log('Smoke: OK — script executed without immediate runtime crash.');
    process.exit(0);
  } catch (err) {
    const header = `=== SMOKE RUN ERROR (${new Date().toISOString()}) ===`;
    const stack = err && (err.stack || String(err));
    const dump = [
      header,
      'Error message:',
      String(err && err.message ? err.message : err),
      '',
      'Stack:',
      stack,
      '',
      'Context snapshot (selected globals):',
      `window && typeof window.document !== 'undefined' ? true : false => ${(typeof context.window !== 'undefined')}`,
      `document && typeof document.querySelector === 'function' ? true : false => ${(typeof context.document !== 'undefined')}`,
      ''
    ].join('\n');

    console.error('Smoke-run failed — writing full dump to', OUT_LOG);
    writeLog(dump);
    // also output first lines to console so Codex UI shows something useful
    const preview = stack ? stack.split('\n').slice(0,10).join('\n') : String(err).slice(0,500);
    console.error('SMOKE ERROR (preview):\n', preview);
    process.exit(2);
  }
}

run();
