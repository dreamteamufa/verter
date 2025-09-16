const fs = require("fs");
const esprima = require("esprima");
const file = process.argv[2];
const src = fs.readFileSync(file, "utf8");
try {
  esprima.parseScript(src, { tolerant: false, loc: true });
  console.log("✅ Syntax OK:", file);
} catch (e) {
  console.error(`❌ Syntax ERROR ${e.lineNumber}:${e.column} — ${e.description}`);
  process.exit(1);
}
