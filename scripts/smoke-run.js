// scripts/smoke-run.js — строгий smoke-тест для PCS в формате ESM

import fs from "fs";
import path from "path";
import vm from "vm";
import JSON5 from "json5";

const SRC = path.join("src", "Verter.user.js");
const OUT_DIR = "build";
const OUT_LOG = path.join(OUT_DIR, "smoke-error.log");

function ensureOutDir() {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  } catch {}
}

function writeLog(txt) {
  ensureOutDir();
  fs.writeFileSync(OUT_LOG, String(txt), "utf8");
}

function readSource() {
  try {
    return fs.readFileSync(SRC, "utf8");
  } catch (e) {
    throw new Error(`Cannot read ${SRC}\n${e.stack || e}`);
  }
}

function makeContext() {
  // имитация окружения браузера
  return {
    window: {},
    document: { body: {}, createElement: () => ({}), querySelector: () => null },
    localStorage: new Map(),
    navigator: { userAgent: "smoke-test" },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
}

function runSmoke() {
  const src = readSource();
  const context = makeContext();
  try {
    vm.createContext(context);
    vm.runInContext(src, context, { timeout: 2000 });
    console.log("✅ Smoke test passed: script executed without fatal errors.");
  } catch (e) {
    writeLog(e.stack || e.message || e);
    console.error("❌ Smoke test failed — see build/smoke-error.log");
    process.exit(1);
  }
}

runSmoke();
