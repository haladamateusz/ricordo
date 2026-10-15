import { TestBed } from '@angular/core/testing';

import type { EditImageDb, FileHandleDb, StoredFileHandle } from './edit-history';
import {
  CurrentSessionStore,
  SESSION_HANDLE_DB,
  SESSION_IMAGE_DB,
  SESSION_LIST_DB,
  sessionFromUnknown,
  type SessionEdit,
  type SessionListDb,
  type StoredSession,
} from './current-session-store';

describe('session storage', () => {
  it('reads an empty session when storage is blank or corrupt', () => {
    expect(sessionFromUnknown(undefined)).toEqual({ activeId: null, edits: [] });
    expect(sessionFromUnknown({})).toEqual({ activeId: null, edits: [] });
    expect(sessionFromUnknown({ edits: [1, edit('keep')] }).edits).toEqual([edit('keep')]);
  });

  it('keeps a saved crop and clamps a position that falls outside the frame', () => {
    const framed = edit('framed');
    framed.panX = 1.4;
    framed.panY = -0.2;
    framed.zoom = 9;
    framed.orientation = 'portrait';

    expect(sessionFromUnknown({ activeId: 'missing', edits: [framed] })).toMatchObject({
      activeId: 'framed',
      edits: [{ panX: 1, panY: 0, zoom: 4, orientation: 'portrait' }],
    });
  });
});

describe('CurrentSessionStore', () => {
  let lists: MemorySessionList;
  let images: MemoryImages;
  let handles: MemoryHandles;

  beforeEach(() => {
    lists = new MemorySessionList();
    images = new MemoryImages();
    handles = new MemoryHandles();
    TestBed.configureTestingModule({
      providers: [
        { provide: SESSION_LIST_DB, useValue: lists },
        { provide: SESSION_IMAGE_DB, useValue: images },
        { provide: SESSION_HANDLE_DB, useValue: handles },
      ],
    });
  });

  it('stores each open photo and drops one that was removed', async () => {
    const store = TestBed.inject(CurrentSessionStore);
    const photo = new Blob(['png'], { type: 'image/png' });
    const handle = fileHandle();
    const first = edit('harbor');
    const second = edit('pier');

    const harborPhoto = new Blob(['harbor'], { type: 'image/png' });
    await store.write(
      { activeId: 'pier', edits: [second, first] },
      {
        images: new Map<string, Blob>([
          ['pier', photo],
          ['harbor', harborPhoto],
        ]),
        handles: new Map([['pier', handle]]),
      },
    );

    expect(await store.image('pier')).toBe(photo);
    expect(await store.handle('pier')).toBe(handle);

    await store.write({ activeId: 'harbor', edits: [first] });

    expect(lists.session.edits.map((item) => item.id)).toEqual(['harbor']);
    expect(lists.session.activeId).toBe('harbor');
    expect(await store.image('pier')).toBeUndefined();
    expect(await store.handle('pier')).toBeUndefined();
    expect(await store.image('harbor')).toBe(harborPhoto);
    expect(handles.values.has('pier')).toBe(false);
  });

  it('clears the saved session', async () => {
    const store = TestBed.inject(CurrentSessionStore);
    lists.session = { activeId: 'harbor', edits: [edit('harbor')] };
    images.values.set('harbor', new Blob(['png']));
    handles.values.set('harbor', fileHandle());

    await store.clear();

    expect(lists.session).toEqual({ activeId: null, edits: [] });
    expect(images.values.size).toBe(0);
    expect(handles.values.size).toBe(0);
  });
});

function edit(id: string): SessionEdit {
  return {
    id,
    fileName: `${id}.png`,
    rightCaption: 'Cafe',
    date: '2024-06-15',
    thumbnail: new Blob([id], { type: 'image/jpeg' }),
    panX: 0.5,
    panY: 0.5,
    zoom: 1,
    orientation: 'landscape',
  };
}

function fileHandle(): StoredFileHandle {
  return {
    kind: 'file',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => new File(['x'], 'dog.png'),
  };
}

class MemorySessionList implements SessionListDb {
  session: StoredSession = { activeId: null, edits: [] };

  async read(): Promise<StoredSession> {
    return this.session;
  }

  async write(session: StoredSession): Promise<void> {
    this.session = {
      activeId: session.activeId,
      edits: session.edits.map((item) => ({ ...item })),
    };
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
