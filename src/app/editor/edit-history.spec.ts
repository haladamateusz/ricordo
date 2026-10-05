import { TestBed } from '@angular/core/testing';

import {
  EDIT_HISTORY_LIMIT,
  EDIT_IMAGE_DB,
  EDIT_LIST_DB,
  FILE_HANDLE_DB,
  EditHistory,
  editRecordsFromUnknown,
  fileAccess,
  prependEdit,
  resolveVisibleEdits,
  type EditImageDb,
  type EditListDb,
  type EditRecord,
  type FileHandleDb,
  type StoredEdit,
  type StoredFileHandle,
} from './edit-history';

describe('edit history storage', () => {
  it('reads an empty list when storage is blank, corrupt, or not a list', () => {
    const kept = record('keep');

    expect(editRecordsFromUnknown(undefined)).toEqual([]);
    expect(editRecordsFromUnknown({})).toEqual([]);
    expect(editRecordsFromUnknown([1, kept])).toEqual([kept]);
  });

  it('keeps a saved crop and clamps a position that falls outside the frame', () => {
    const framed = record('framed');
    framed.panX = 1.4;
    framed.panY = -0.2;
    framed.zoom = 9;

    expect(editRecordsFromUnknown([framed])[0]).toMatchObject({ panX: 1, panY: 0, zoom: 4 });
  });

  it('keeps the newest 50 edits and reports the dropped ids', () => {
    const current = Array.from({ length: EDIT_HISTORY_LIMIT }, (_, index) => edit(`${index}`));
    const { edits, removedIds } = prependEdit(current, edit('new'));

    expect(edits).toHaveLength(EDIT_HISTORY_LIMIT);
    expect(edits[0]?.id).toBe('new');
    expect(edits.some((item) => item.id === `${EDIT_HISTORY_LIMIT - 1}`)).toBe(false);
    expect(removedIds).toEqual([`${EDIT_HISTORY_LIMIT - 1}`]);
  });
});

describe('file access', () => {
  it('reports each permission and missing-file outcome', async () => {
    expect(await fileAccess(undefined)).toBe('missing');
    expect(await fileAccess(handle('prompt'))).toBe('prompt');
    expect(await fileAccess(handle('denied'))).toBe('denied');
    expect(await fileAccess(handle('granted'))).toBe('granted');
    expect(await fileAccess(handle('granted', null))).toBe('gone');
    expect(
      await fileAccess({
        kind: 'file',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        getFile: async () => {
          throw new DOMException('blocked', 'NotAllowedError');
        },
      }),
    ).toBe('denied');
  });

  it('shows saved edits and drops a file that is gone', async () => {
    const granted = edit('open');
    const pending = edit('pending');
    const missing = edit('missing');
    const handles = new Map<string, StoredFileHandle>([
      ['open', handle('granted')],
      ['pending', handle('prompt')],
      ['missing', handle('granted', null)],
    ]);

    await expect(
      resolveVisibleEdits([granted, pending, missing], {
        get: async (id) => handles.get(id),
      }),
    ).resolves.toEqual({
      visible: [granted, pending],
      goneIds: ['missing'],
    });
  });

  it('shows the saved edit when the file handle cannot be read', async () => {
    const saved = edit('saved');

    await expect(
      resolveVisibleEdits([saved], {
        get: async () => {
          throw new Error('unavailable');
        },
      }),
    ).resolves.toEqual({
      visible: [saved],
      goneIds: [],
    });
  });
});

describe('EditHistory', () => {
  let lists: MemoryEditList;
  let handles: MemoryHandles;
  let images: MemoryImages;

  beforeEach(() => {
    lists = new MemoryEditList();
    handles = new MemoryHandles();
    images = new MemoryImages();
    TestBed.configureTestingModule({
      providers: [
        { provide: EDIT_LIST_DB, useValue: lists },
        { provide: FILE_HANDLE_DB, useValue: handles },
        { provide: EDIT_IMAGE_DB, useValue: images },
      ],
    });
  });

  it('stores a download and drops the handle past the newest 50', async () => {
    const history = TestBed.inject(EditHistory);
    const photo = new Blob(['png'], { type: 'image/png' });

    for (let index = 0; index < EDIT_HISTORY_LIMIT + 1; index += 1) {
      await history.record({
        fileName: `${index}.png`,
        rightCaption: `caption ${index}`,
        date: '2024-06-15',
        thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
        image: photo,
        handle: handle('granted'),
        panX: 0.2,
        panY: 0.8,
        zoom: 2,
      });
    }

    expect(history.edits()).toHaveLength(EDIT_HISTORY_LIMIT);
    expect(history.edits()[0]?.fileName).toBe(`${EDIT_HISTORY_LIMIT}.png`);
    expect(history.edits()[0]).toMatchObject({ panX: 0.2, panY: 0.8, zoom: 2 });
    expect(history.edits().some((item) => item.fileName === '0.png')).toBe(false);
    expect(handles.values.size).toBe(EDIT_HISTORY_LIMIT);
    expect(images.values.size).toBe(EDIT_HISTORY_LIMIT);
    expect(await history.image(history.edits()[0]?.id ?? '')).toBe(photo);
    expect(lists.records.map((item) => item.fileName)).toEqual(
      history.edits().map((item) => item.fileName),
    );
    expect(history.edits()[0]?.thumbnailUrl).not.toBe('');
  });

  it('removes a missing file from storage and from the handle database', async () => {
    lists.records = [record('gone'), record('keep')];
    handles.values.set('gone', handle('granted', null));
    handles.values.set('keep', handle('granted'));
    images.values.set('gone', new Blob(['png'], { type: 'image/png' }));
    images.values.set('keep', new Blob(['png'], { type: 'image/png' }));
    const history = TestBed.inject(EditHistory);

    await history.remove(['gone']);

    expect(history.edits().map((item) => item.id)).toEqual(['keep']);
    expect(handles.values.has('gone')).toBe(false);
    expect(handles.values.has('keep')).toBe(true);
    expect(images.values.has('gone')).toBe(false);
    expect(images.values.has('keep')).toBe(true);
    expect(lists.records.map((item) => item.id)).toEqual(['keep']);
  });
});

function edit(id: string): StoredEdit {
  return {
    ...record(id),
    thumbnailUrl: '',
  };
}

function record(id: string): EditRecord {
  return {
    id,
    fileName: `${id}.png`,
    rightCaption: 'Cafe',
    date: '2024-06-15',
    thumbnail: new Blob([id], { type: 'image/jpeg' }),
    panX: 0.5,
    panY: 0.5,
    zoom: 1,
  };
}

function handle(
  permission: PermissionState,
  file: File | null = new File(['x'], 'dog.png'),
): StoredFileHandle {
  return {
    kind: 'file',
    queryPermission: async () => permission,
    requestPermission: async () => permission,
    getFile: async () => {
      if (!file) {
        throw new DOMException('missing', 'NotFoundError');
      }
      return file;
    },
  };
}

class MemoryEditList implements EditListDb {
  records: EditRecord[] = [];

  async read(): Promise<EditRecord[]> {
    return this.records;
  }

  async write(edits: readonly EditRecord[]): Promise<void> {
    this.records = [...edits];
  }
}

class MemoryImages implements EditImageDb {
  readonly values = new Map<string, Blob>();

  async get(id: string): Promise<Blob | undefined> {
    return this.values.get(id);
  }

  async put(id: string, image: Blob): Promise<void> {
    this.values.set(id, image);
  }

  async delete(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      this.values.delete(id);
    }
  }
}

class MemoryHandles implements FileHandleDb {
  readonly values = new Map<string, StoredFileHandle>();

  async get(id: string): Promise<StoredFileHandle | undefined> {
    return this.values.get(id);
  }

  async put(id: string, value: StoredFileHandle): Promise<void> {
    this.values.set(id, value);
  }

  async delete(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      this.values.delete(id);
    }
  }
}
