const fs = require("fs");
const archiver = require("archiver");

fs.mkdirSync("build", { recursive: true });

const out = fs.createWriteStream("build/Verter_SAFE.zip");
const archive = archiver("zip", { zlib: { level: 9 } });

archive.pipe(out);
archive.file("src/Verter.user.js", { name: "Verter.user.js" });
archive.finalize().then(() => console.log("✅ Build: build/Verter_SAFE.zip ready"));
