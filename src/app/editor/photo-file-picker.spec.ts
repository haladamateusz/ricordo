import { vi } from 'vitest';

import { filesFromDrop, pickPhotoFiles, type PickedPhoto } from './photo-file-picker';
import type { StoredFileHandle } from './edit-history';

describe('pickPhotoFiles', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
  });

  it('falls back when the browser has no file picker', async () => {
    await expect(pickPhotoFiles(true)).resolves.toBe('fallback');
  });

  it('returns nothing when the picker is cancelled', async () => {
    stubPicker(vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError')));

    await expect(pickPhotoFiles(true)).resolves.toBeNull();
  });

  it('returns every chosen file and its handle', async () => {
    const harbor = new File(['photo'], 'harbor.png', { type: 'image/png' });
    const pier = new File(['photo'], 'pier.png', { type: 'image/png' });
    const first = fileHandle(harbor);
    const second = fileHandle(pier);
    const picker = vi.fn().mockResolvedValue([first, second]);
    stubPicker(picker);

    await expect(pickPhotoFiles(true)).resolves.toEqual([
      { file: harbor, handle: first },
      { file: pier, handle: second },
    ]);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
  });

  it('asks for one file when replacing', async () => {
    const file = new File(['photo'], 'dog.png', { type: 'image/png' });
    const stored = fileHandle(file);
    const picker = vi.fn().mockResolvedValue([stored]);
    stubPicker(picker);

    await expect(pickPhotoFiles(false)).resolves.toEqual([{ file, handle: stored }]);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }));
  });
});

describe('filesFromDrop', () => {
  it('uses the dropped file handle', async () => {
    const file = new File(['photo'], 'dog.png', { type: 'image/png' });
    const stored = fileHandle(file);
    const getAsFileSystemHandle = vi.fn().mockResolvedValue(stored);
    const transfer = {
      items: [{ getAsFileSystemHandle }],
      files: [],
    } as unknown as DataTransfer;

    await expect(filesFromDrop(transfer)).resolves.toEqual([
      {
        file,
        handle: stored,
      } satisfies PickedPhoto,
    ]);
    expect(getAsFileSystemHandle).toHaveBeenCalledOnce();
  });

  it('uses every plain file when the drop has no handles', async () => {
    const harbor = new File(['photo'], 'harbor.png', { type: 'image/png' });
    const pier = new File(['photo'], 'pier.png', { type: 'image/png' });
    const transfer = {
      items: [{}, {}],
      files: [harbor, pier],
    } as unknown as DataTransfer;

    await expect(filesFromDrop(transfer)).resolves.toEqual([harbor, pier]);
  });
});

function stubPicker(picker: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, 'showOpenFilePicker', {
    configurable: true,
    value: picker,
  });
}

function fileHandle(file: File): StoredFileHandle {
  return {
    kind: 'file',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => file,
  };
}
