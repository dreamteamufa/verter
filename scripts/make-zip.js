// scripts/make-zip.js — ESM
import fs from "fs";
import path from "path";
import archiver from "archiver";

const OUT_DIR = "build";
fs.mkdirSync(OUT_DIR, { recursive: true });

const outPath = path.join(OUT_DIR, "Verter_SAFE.zip");
const out = fs.createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.pipe(out);
archive.file(path.join("src", "Verter.user.js"), { name: "Verter.user.js" });
archive.finalize().then(() => console.log("✅ Build: build/Verter_SAFE.zip ready"));
