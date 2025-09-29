import fs from "fs";
import path from "path";
import { deflateRawSync } from "zlib";

const VERSION = "Verter ver. 2.2 (OrderGate+VirtFix)";
const ARTIFACT_PREFIX = "Verter_ver_2.2_(OrderGate+VirtFix)_";
const OUTPUT_DIR = "build";
const FILES = [
  { path: path.join("src", "Verter.user.js"), name: "Verter.user.js" },
  { path: path.join("src", "cloudstats_s1.js"), name: "cloudstats_s1.js" },
  { path: "CloudStats_s1_README.txt", name: "CloudStats_s1_README.txt" }
];

function formatTimestamp(date) {
  const pad = (value) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}${month}${day}-${hours}${minutes}`;
}

function toDosTime(date) {
  const d = new Date(date);
  const seconds = Math.floor(d.getSeconds() / 2);
  return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (seconds & 0x1f);
}

function toDosDate(date) {
  const d = new Date(date);
  const year = Math.max(0, d.getFullYear() - 1980);
  return ((year & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)) >>> 0;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const artifactTimestamp = formatTimestamp(new Date());
const artifactName = `${ARTIFACT_PREFIX}${artifactTimestamp}.zip`;
const artifactPath = path.join(OUTPUT_DIR, artifactName);

const entries = FILES.map((file) => {
  const buffer = fs.readFileSync(file.path);
  const stats = fs.statSync(file.path);
  return {
    name: file.name,
    buffer,
    compressed: deflateRawSync(buffer),
    crc: crc32(buffer),
    modTime: toDosTime(stats.mtime),
    modDate: toDosDate(stats.mtime)
  };
});

let offset = 0;
const localParts = [];
const centralParts = [];

entries.forEach((entry) => {
  const nameBuffer = Buffer.from(entry.name, "utf8");
  const localHeader = Buffer.alloc(30 + nameBuffer.length);
  let ptr = 0;
  localHeader.writeUInt32LE(0x04034b50, ptr); ptr += 4;
  localHeader.writeUInt16LE(20, ptr); ptr += 2;
  localHeader.writeUInt16LE(0x0800, ptr); ptr += 2;
  localHeader.writeUInt16LE(8, ptr); ptr += 2;
  localHeader.writeUInt16LE(entry.modTime, ptr); ptr += 2;
  localHeader.writeUInt16LE(entry.modDate, ptr); ptr += 2;
  localHeader.writeUInt32LE(entry.crc, ptr); ptr += 4;
  localHeader.writeUInt32LE(entry.compressed.length, ptr); ptr += 4;
  localHeader.writeUInt32LE(entry.buffer.length, ptr); ptr += 4;
  localHeader.writeUInt16LE(nameBuffer.length, ptr); ptr += 2;
  localHeader.writeUInt16LE(0, ptr); ptr += 2;
  nameBuffer.copy(localHeader, ptr);

  localParts.push(localHeader, entry.compressed);

  const centralHeader = Buffer.alloc(46 + nameBuffer.length);
  ptr = 0;
  centralHeader.writeUInt32LE(0x02014b50, ptr); ptr += 4;
  centralHeader.writeUInt16LE(0x0014, ptr); ptr += 2;
  centralHeader.writeUInt16LE(20, ptr); ptr += 2;
  centralHeader.writeUInt16LE(0x0800, ptr); ptr += 2;
  centralHeader.writeUInt16LE(8, ptr); ptr += 2;
  centralHeader.writeUInt16LE(entry.modTime, ptr); ptr += 2;
  centralHeader.writeUInt16LE(entry.modDate, ptr); ptr += 2;
  centralHeader.writeUInt32LE(entry.crc, ptr); ptr += 4;
  centralHeader.writeUInt32LE(entry.compressed.length, ptr); ptr += 4;
  centralHeader.writeUInt32LE(entry.buffer.length, ptr); ptr += 4;
  centralHeader.writeUInt16LE(nameBuffer.length, ptr); ptr += 2;
  centralHeader.writeUInt16LE(0, ptr); ptr += 2;
  centralHeader.writeUInt16LE(0, ptr); ptr += 2;
  centralHeader.writeUInt16LE(0, ptr); ptr += 2;
  centralHeader.writeUInt16LE(0, ptr); ptr += 2;
  centralHeader.writeUInt32LE(0, ptr); ptr += 4;
  centralHeader.writeUInt32LE(offset, ptr); ptr += 4;
  nameBuffer.copy(centralHeader, ptr);

  offset += localHeader.length + entry.compressed.length;
  centralParts.push(centralHeader);
});

const centralDirectoryOffset = offset;
const centralDirectory = Buffer.concat(centralParts);
const centralDirectorySize = centralDirectory.length;

const endRecord = Buffer.alloc(22);
let endPtr = 0;
endRecord.writeUInt32LE(0x06054b50, endPtr); endPtr += 4;
endRecord.writeUInt16LE(0, endPtr); endPtr += 2;
endRecord.writeUInt16LE(0, endPtr); endPtr += 2;
endRecord.writeUInt16LE(entries.length, endPtr); endPtr += 2;
endRecord.writeUInt16LE(entries.length, endPtr); endPtr += 2;
endRecord.writeUInt32LE(centralDirectorySize, endPtr); endPtr += 4;
endRecord.writeUInt32LE(centralDirectoryOffset, endPtr); endPtr += 4;
endRecord.writeUInt16LE(0, endPtr);

const zipBuffer = Buffer.concat([...localParts, centralDirectory, endRecord]);
fs.writeFileSync(artifactPath, zipBuffer);
fs.writeFileSync("ARTIFACT_NAME.txt", `${artifactName}\n`);

console.log(`[PACK] ${artifactName} for ${VERSION}`);
