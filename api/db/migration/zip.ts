import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Reads a ZIP archive (store or deflate). Enough for Holded xlsx and the Shopify customers zip. */
export function readZip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    let compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    let dataStart = nameStart + nameLength + extraLength;
    if ((flags & 0x8) !== 0 && compressedSize === 0) {
      const found = findDataDescriptor(buffer, dataStart);
      compressedSize = found.size;
      dataStart = found.dataStart;
    }
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = inflate(method, compressed);
    entries.push({ name, data });
    offset = dataStart + compressedSize;
    if ((flags & 0x8) !== 0) {
      const marker = buffer.readUInt32LE(offset);
      offset += marker === 0x08074b50 ? 16 : 12;
    }
  }
  return entries;
}

function inflate(method: number, compressed: Buffer): Buffer {
  if (method === 0) return Buffer.from(compressed);
  if (method === 8) return inflateRawSync(compressed);
  throw new Error('ZIP_METHOD');
}

function findDataDescriptor(buffer: Buffer, dataStart: number): { dataStart: number; size: number } {
  for (let index = dataStart; index + 16 < buffer.length; index += 1) {
    const marker = buffer.readUInt32LE(index);
    if (marker !== 0x08074b50) continue;
    return { dataStart, size: index - dataStart };
  }
  throw new Error('ZIP_DESCRIPTOR');
}
