import { readStoredZip, zipStored } from './zip-store';

describe('zipStored', () => {
  it('packs stored files that can be read back', async () => {
    const zip = zipStored(
      [
        { name: 'crc.txt', bytes: text('123456789') },
        { name: 'pier-framed.png', bytes: text('two') },
      ],
      new Date(2026, 0, 2, 3, 4, 6),
    );

    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(zip.type).toBe('application/zip');
    expect(readStoredNames(bytes)).toEqual([
      { name: 'crc.txt', text: '123456789' },
      { name: 'pier-framed.png', text: 'two' },
    ]);
    expect(readStoredZip(bytes)?.map((entry) => entry.name)).toEqual([
      'crc.txt',
      'pier-framed.png',
    ]);
    expect(bytes.subarray(14, 18)).toEqual(uint32(0xcbf43926));
  });

  it('rejects a truncated archive', async () => {
    const bytes = await archive();

    expect(readStoredZip(bytes.subarray(0, bytes.byteLength - 8))).toBeNull();
  });

  it('rejects a compressed entry', async () => {
    const bytes = await archive();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(centralStart(bytes) + 10, 8, true);

    expect(readStoredZip(bytes)).toBeNull();
  });

  it('rejects an entry whose checksum does not match', async () => {
    const bytes = await archive();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const crcAt = centralStart(bytes) + 16;
    view.setUint32(crcAt, view.getUint32(crcAt, true) ^ 0xffffffff, true);

    expect(readStoredZip(bytes)).toBeNull();
  });
});

async function archive(): Promise<Uint8Array> {
  const zip = zipStored([{ name: 'note.txt', bytes: text('hello') }]);
  return new Uint8Array(await zip.arrayBuffer());
}

function centralStart(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(bytes.byteLength - 6, true);
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function readStoredNames(bytes: Uint8Array): { name: string; text: string }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: { name: string; text: string }[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 22, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    files.push({
      name: new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength)),
      text: new TextDecoder().decode(bytes.subarray(dataStart, dataStart + size)),
    });
    offset = dataStart + size;
  }
  expect(view.getUint32(bytes.byteLength - 22, true)).toBe(0x06054b50);
  return files;
}
