// scripts/make-zip.js — ESM
import fs from "fs";
import path from "path";
import { deflateRawSync } from "zlib";

const OUT_DIR = "build";
const SOURCE_FILE = path.join("src", "Verter.user.js");
const TARGET_ZIP = path.join(OUT_DIR, "Verter_SAFE.zip");
const FILE_NAME = "Verter.user.js";

function toDosTime(date){
  const d = new Date(date);
  const seconds = Math.floor(d.getSeconds() / 2);
  return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (seconds & 0x1f);
}

function toDosDate(date){
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

function crc32(buffer){
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const fileBuffer = fs.readFileSync(SOURCE_FILE);
const stats = fs.statSync(SOURCE_FILE);
const compressed = deflateRawSync(fileBuffer);
const crc = crc32(fileBuffer);
const modTime = toDosTime(stats.mtime);
const modDate = toDosDate(stats.mtime);
const nameBuffer = Buffer.from(FILE_NAME, "utf8");

const localHeader = Buffer.alloc(30 + nameBuffer.length);
let offset = 0;
localHeader.writeUInt32LE(0x04034b50, offset); offset += 4;
localHeader.writeUInt16LE(20, offset); offset += 2;
localHeader.writeUInt16LE(0, offset); offset += 2;
localHeader.writeUInt16LE(8, offset); offset += 2;
localHeader.writeUInt16LE(modTime, offset); offset += 2;
localHeader.writeUInt16LE(modDate, offset); offset += 2;
localHeader.writeUInt32LE(crc, offset); offset += 4;
localHeader.writeUInt32LE(compressed.length, offset); offset += 4;
localHeader.writeUInt32LE(fileBuffer.length, offset); offset += 4;
localHeader.writeUInt16LE(nameBuffer.length, offset); offset += 2;
localHeader.writeUInt16LE(0, offset); offset += 2;
nameBuffer.copy(localHeader, offset);

const centralHeader = Buffer.alloc(46 + nameBuffer.length);
offset = 0;
centralHeader.writeUInt32LE(0x02014b50, offset); offset += 4;
centralHeader.writeUInt16LE(0x0014, offset); offset += 2;
centralHeader.writeUInt16LE(20, offset); offset += 2;
centralHeader.writeUInt16LE(0, offset); offset += 2;
centralHeader.writeUInt16LE(8, offset); offset += 2;
centralHeader.writeUInt16LE(modTime, offset); offset += 2;
centralHeader.writeUInt16LE(modDate, offset); offset += 2;
centralHeader.writeUInt32LE(crc, offset); offset += 4;
centralHeader.writeUInt32LE(compressed.length, offset); offset += 4;
centralHeader.writeUInt32LE(fileBuffer.length, offset); offset += 4;
centralHeader.writeUInt16LE(nameBuffer.length, offset); offset += 2;
centralHeader.writeUInt16LE(0, offset); offset += 2;
centralHeader.writeUInt16LE(0, offset); offset += 2;
centralHeader.writeUInt16LE(0, offset); offset += 2;
centralHeader.writeUInt16LE(0, offset); offset += 2;
centralHeader.writeUInt32LE(0, offset); offset += 4;
centralHeader.writeUInt32LE(0, offset); offset += 4;
nameBuffer.copy(centralHeader, offset);

const centralDirectoryOffset = localHeader.length + compressed.length;
const centralDirectorySize = centralHeader.length;

const endRecord = Buffer.alloc(22);
offset = 0;
endRecord.writeUInt32LE(0x06054b50, offset); offset += 4;
endRecord.writeUInt16LE(0, offset); offset += 2;
endRecord.writeUInt16LE(0, offset); offset += 2;
endRecord.writeUInt16LE(1, offset); offset += 2;
endRecord.writeUInt16LE(1, offset); offset += 2;
endRecord.writeUInt32LE(centralDirectorySize, offset); offset += 4;
endRecord.writeUInt32LE(centralDirectoryOffset, offset); offset += 4;
endRecord.writeUInt16LE(0, offset);

const zipBuffer = Buffer.concat([localHeader, compressed, centralHeader, endRecord]);
fs.writeFileSync(TARGET_ZIP, zipBuffer);

console.log("✅ Build: build/Verter_SAFE.zip ready");
