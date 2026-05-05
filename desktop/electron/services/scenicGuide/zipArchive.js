const fs = require('node:fs/promises');
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function createZipError(message, code = 'zip_read_failed') {
  return Object.assign(new Error(message), { code });
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function parseZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw createZipError('ZIP end of central directory was not found.', 'invalid_zip');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw createZipError('Invalid ZIP central directory entry.', 'invalid_zip');
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileNameStart = offset + 46;
    const fileName = buffer.toString('utf8', fileNameStart, fileNameStart + fileNameLength);

    entries.set(fileName, {
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset = fileNameStart + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

class ZipArchive {
  constructor(buffer) {
    this.buffer = buffer;
    this.entries = parseZipEntries(buffer);
  }

  static async fromFile(filePath) {
    const buffer = await fs.readFile(filePath);
    return new ZipArchive(buffer);
  }

  hasEntry(entryName) {
    return this.entries.has(entryName);
  }

  listEntries() {
    return [...this.entries.keys()];
  }

  readEntryBuffer(entryName) {
    const entry = this.entries.get(entryName);
    if (!entry) {
      throw createZipError(`ZIP entry not found: ${entryName}`, 'zip_entry_not_found');
    }

    const localOffset = entry.localHeaderOffset;
    if (this.buffer.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) {
      throw createZipError('Invalid ZIP local file header.', 'invalid_zip');
    }

    const localFileNameLength = this.buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = this.buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    const compressed = this.buffer.subarray(dataStart, dataEnd);

    if (entry.compressionMethod === 0) {
      return Buffer.from(compressed);
    }

    if (entry.compressionMethod === 8) {
      return zlib.inflateRawSync(compressed, {
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
    }

    throw createZipError(
      `Unsupported ZIP compression method: ${entry.compressionMethod}`,
      'unsupported_zip_compression',
    );
  }

  readEntryText(entryName) {
    return this.readEntryBuffer(entryName).toString('utf8');
  }
}

module.exports = {
  ZipArchive,
};
