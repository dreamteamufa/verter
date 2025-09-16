// scripts/syntax-check.js — ESM-версия для PCS
import fs from "fs";
import esprima from "esprima";

const file = process.argv[2] || "src/Verter.user.js";

let src = "";
try {
  src = fs.readFileSync(file, "utf8");
} catch (e) {
  console.error(`❌ Cannot read file: ${file}\n${e && e.message ? e.message : e}`);
  process.exit(1);
}

try {
  // Esprima 4 понимает современный синтаксис (const/let, и т.д.)
  esprima.parseScript(src, { tolerant: false, loc: true });
  console.log(`✅ Syntax OK: ${file}`);
} catch (e) {
  const line = e && e.lineNumber != null ? e.lineNumber : "?";
  const col = e && e.column != null ? e.column : "?";
  const msg = e && e.description ? e.description : (e && e.message ? e.message : String(e));
  console.error(`❌ Syntax ERROR ${line}:${col} — ${msg}`);
  process.exit(1);
}
