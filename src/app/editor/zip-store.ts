const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

// Stored entries (method 0). The framed PNGs are already compressed.
export function zipStored(entries: readonly ZipEntry[], modified = new Date()): Blob {
  const stamp = dosStamp(modified);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = localHeader(name, entry.bytes.byteLength, crc, stamp);
    locals.push(local, entry.bytes);
    centrals.push(centralHeader(name, entry.bytes.byteLength, crc, stamp, offset));
    offset += local.byteLength + entry.bytes.byteLength;
  }

  return new Blob(
    [...locals, ...centrals, endRecord(entries.length, centrals, offset)].map((part) =>
      copyBytes(part),
    ),
    { type: 'application/zip' },
  );
}

export function readStoredZip(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd === null) {
    return null;
  }

  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset > bytes.byteLength || centralSize > bytes.byteLength - centralOffset) {
    return null;
  }

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      return null;
    }

    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > bytes.byteLength) {
      return null;
    }

    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameEnd));
    cursor = nameEnd + extraLength + commentLength;
    if (name.endsWith('/')) {
      continue;
    }
    if (method !== 0) {
      return null;
    }

    const data = readLocal(bytes, view, localOffset, size);
    if (!data || crc32(data) !== crc) {
      return null;
    }
    entries.push({ name, bytes: data });
  }

  return entries;
}

function copyBytes(part: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(part.byteLength);
  new Uint8Array(copy).set(part);
  return copy;
}

function localHeader(name: Uint8Array, size: number, crc: number, stamp: DosStamp): Uint8Array {
  const header = new Uint8Array(30 + name.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.byteLength, true);
  header.set(name, 30);
  return header;
}

function centralHeader(
  name: Uint8Array,
  size: number,
  crc: number,
  stamp: DosStamp,
  offset: number,
): Uint8Array {
  const header = new Uint8Array(46 + name.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

function endRecord(
  count: number,
  centrals: readonly Uint8Array[],
  centralOffset: number,
): Uint8Array {
  const centralLength = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralLength, true);
  view.setUint32(16, centralOffset, true);
  return header;
}

function findEocd(view: DataView): number | null {
  const length = view.byteLength;
  const start = Math.max(0, length - 22 - 0xffff);
  for (let offset = length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) {
      continue;
    }
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === length) {
      return offset;
    }
  }
  return null;
}

function readLocal(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  size: number,
): Uint8Array | null {
  if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
    return null;
  }

  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + size;
  if (end > bytes.byteLength) {
    return null;
  }
  return bytes.subarray(start, end);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface DosStamp {
  time: number;
  date: number;
}

function dosStamp(modified: Date): DosStamp {
  const year = Math.max(modified.getFullYear(), 1980);
  return {
    time:
      (modified.getHours() << 11) |
      (modified.getMinutes() << 5) |
      Math.floor(modified.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate(),
  };
}
