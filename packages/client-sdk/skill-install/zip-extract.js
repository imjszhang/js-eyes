'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL_DIR_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

const DEFAULT_MAX_TOTAL_SIZE = 100 * 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 5000;

function readUInt16(buf, off) { return buf.readUInt16LE(off); }
function readUInt32(buf, off) { return buf.readUInt32LE(off); }

function findEndOfCentralDirectory(buf) {
  const minLen = 22;
  if (buf.length < minLen) {
    throw new Error('zip: file too small');
  }
  const maxBack = Math.min(buf.length, 65536 + minLen);
  for (let i = buf.length - minLen; i >= buf.length - maxBack; i--) {
    if (i < 0) break;
    if (readUInt32(buf, i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  throw new Error('zip: end-of-central-directory not found');
}

function parseEntries(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  let cdSize = readUInt32(buf, eocdOffset + 12);
  let cdOffset = readUInt32(buf, eocdOffset + 16);
  let entryCount = readUInt16(buf, eocdOffset + 10);

  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset >= 0 && readUInt32(buf, locatorOffset) === ZIP64_EOCD_LOCATOR) {
      const zip64Offset = Number(buf.readBigUInt64LE(locatorOffset + 8));
      if (zip64Offset >= 0 && readUInt32(buf, zip64Offset) === ZIP64_EOCD) {
        entryCount = Number(buf.readBigUInt64LE(zip64Offset + 32));
        cdSize = Number(buf.readBigUInt64LE(zip64Offset + 40));
        cdOffset = Number(buf.readBigUInt64LE(zip64Offset + 48));
      }
    }
  }

  const entries = [];
  let offset = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (readUInt32(buf, offset) !== CENTRAL_DIR_HEADER) {
      throw new Error(`zip: bad central directory at entry ${i}`);
    }
    const versionMadeBy = readUInt16(buf, offset + 4);
    const generalFlag = readUInt16(buf, offset + 8);
    const method = readUInt16(buf, offset + 10);
    let compressedSize = readUInt32(buf, offset + 20);
    let uncompressedSize = readUInt32(buf, offset + 24);
    const fileNameLength = readUInt16(buf, offset + 28);
    const extraLength = readUInt16(buf, offset + 30);
    const commentLength = readUInt16(buf, offset + 32);
    const externalAttrs = readUInt32(buf, offset + 38);
    let localHeaderOffset = readUInt32(buf, offset + 42);
    const fileName = buf.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    let extraOffset = offset + 46 + fileNameLength;
    const extraEnd = extraOffset + extraLength;
    while (extraOffset + 4 <= extraEnd) {
      const id = readUInt16(buf, extraOffset);
      const size = readUInt16(buf, extraOffset + 2);
      if (id === 0x0001) {
        let p = extraOffset + 4;
        if (uncompressedSize === 0xffffffff && p + 8 <= extraEnd) {
          uncompressedSize = Number(buf.readBigUInt64LE(p)); p += 8;
        }
        if (compressedSize === 0xffffffff && p + 8 <= extraEnd) {
          compressedSize = Number(buf.readBigUInt64LE(p)); p += 8;
        }
        if (localHeaderOffset === 0xffffffff && p + 8 <= extraEnd) {
          localHeaderOffset = Number(buf.readBigUInt64LE(p)); p += 8;
        }
      }
      extraOffset += 4 + size;
    }

    const isUnix = (versionMadeBy >>> 8) === 3;
    const unixMode = isUnix ? (externalAttrs >>> 16) & 0xffff : 0;
    const isSymlink = isUnix && (unixMode & 0xf000) === 0xa000;

    entries.push({
      fileName,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      generalFlag,
      isSymlink,
      isDirectory: fileName.endsWith('/') || (isUnix && (unixMode & 0xf000) === 0x4000),
      unixMode,
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntryData(buf, entry) {
  const lhOffset = entry.localHeaderOffset;
  if (readUInt32(buf, lhOffset) !== LOCAL_HEADER) {
    throw new Error(`zip: bad local header for ${entry.fileName}`);
  }
  const fileNameLen = readUInt16(buf, lhOffset + 26);
  const extraLen = readUInt16(buf, lhOffset + 28);
  const dataStart = lhOffset + 30 + fileNameLen + extraLen;
  const compressed = buf.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) {
    return compressed;
  }
  if (entry.method === 8) {
    return zlib.inflateRawSync(compressed);
  }
  throw new Error(`zip: unsupported compression method ${entry.method} for ${entry.fileName}`);
}

function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function safeJoin(targetDir, fileName) {
  const normalized = fileName.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`zip: refusing path traversal entry ${fileName}`);
  }
  const dest = path.resolve(targetDir, normalized);
  if (!isPathInside(path.resolve(targetDir), dest)) {
    throw new Error(`zip: entry escapes target dir: ${fileName}`);
  }
  return dest;
}

function extractZipBuffer(buffer, targetDir, options = {}) {
  const maxTotal = options.maxTotalSize || DEFAULT_MAX_TOTAL_SIZE;
  const maxFile = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
  const maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;

  const entries = parseEntries(buffer);
  if (entries.length > maxEntries) {
    throw new Error(`zip: too many entries (${entries.length} > ${maxEntries})`);
  }

  let totalSize = 0;
  for (const entry of entries) {
    if (entry.uncompressedSize > maxFile) {
      throw new Error(`zip: entry ${entry.fileName} exceeds max file size (${entry.uncompressedSize})`);
    }
    totalSize += entry.uncompressedSize;
    if (totalSize > maxTotal) {
      throw new Error(`zip: total uncompressed size exceeds limit (${totalSize} > ${maxTotal})`);
    }
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const written = [];
  for (const entry of entries) {
    if (entry.isSymlink) {
      throw new Error(`zip: symlinks are not allowed (${entry.fileName})`);
    }
    if (entry.isDirectory) {
      const dest = safeJoin(targetDir, entry.fileName);
      fs.mkdirSync(dest, { recursive: true });
      continue;
    }
    const dest = safeJoin(targetDir, entry.fileName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const data = readEntryData(buffer, entry);
    if (data.length > maxFile) {
      throw new Error(`zip: decompressed entry exceeds limit (${entry.fileName})`);
    }
    fs.writeFileSync(dest, data);
    written.push(path.relative(targetDir, dest));
  }

  return { entries: entries.length, written };
}

function extractZipFile(zipPath, targetDir, options = {}) {
  const buffer = fs.readFileSync(zipPath);
  return extractZipBuffer(buffer, targetDir, options);
}

module.exports = {
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_TOTAL_SIZE,
  DEFAULT_MAX_ENTRIES,
  extractZipBuffer,
  extractZipFile,
  parseEntries,
};
