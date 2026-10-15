import { InjectionToken, Service, inject } from '@angular/core';

import type { Orientation } from './frame-layout';
import {
  isStoredFileHandle,
  openPhotoDatabase,
  sessionHandleStoreName,
  sessionImageStoreName,
  sessionListKey,
  sessionListStoreName,
  type EditImageDb,
  type FileHandleDb,
  type StoredFileHandle,
} from './edit-history';

export interface SessionEdit {
  id: string;
  fileName: string;
  rightCaption: string;
  date: string;
  thumbnail: Blob;
  panX: number;
  panY: number;
  zoom: number;
  orientation: Orientation;
}

export interface StoredSession {
  activeId: string | null;
  edits: SessionEdit[];
}

export interface SessionWrite {
  images?: ReadonlyMap<string, Blob>;
  handles?: ReadonlyMap<string, StoredFileHandle | null>;
}

export interface SessionListDb {
  read(): Promise<StoredSession>;
  write(session: StoredSession): Promise<void>;
}

export function emptySession(): StoredSession {
  return { activeId: null, edits: [] };
}

export function sessionFromUnknown(value: unknown): StoredSession {
  if (typeof value !== 'object' || value === null) {
    return emptySession();
  }

  const entry = value as Record<string, unknown>;
  const edits = Array.isArray(entry['edits'])
    ? entry['edits'].flatMap((item) => {
        const record = normalizeSessionEdit(item);
        return record ? [record] : [];
      })
    : [];
  const activeId = typeof entry['activeId'] === 'string' ? entry['activeId'] : null;
  return {
    activeId: edits.some((edit) => edit.id === activeId) ? activeId : (edits[0]?.id ?? null),
    edits,
  };
}

export const SESSION_LIST_DB = new InjectionToken<SessionListDb>('SESSION_LIST_DB', {
  providedIn: 'root',
  factory: () => new IndexedDbSessionList(),
});

export const SESSION_IMAGE_DB = new InjectionToken<EditImageDb>('SESSION_IMAGE_DB', {
  providedIn: 'root',
  factory: () => new IndexedDbSessionImages(),
});

export const SESSION_HANDLE_DB = new InjectionToken<FileHandleDb>('SESSION_HANDLE_DB', {
  providedIn: 'root',
  factory: () => new IndexedDbSessionHandles(),
});

@Service()
export class CurrentSessionStore {
  private readonly records = inject(SESSION_LIST_DB);
  private readonly images = inject(SESSION_IMAGE_DB);
  private readonly handles = inject(SESSION_HANDLE_DB);
  private chain: Promise<void> = Promise.resolve();

  async read(): Promise<StoredSession> {
    try {
      return await this.records.read();
    } catch {
      return emptySession();
    }
  }

  async image(id: string): Promise<Blob | undefined> {
    try {
      return await this.images.get(id);
    } catch {
      return undefined;
    }
  }

  async handle(id: string): Promise<StoredFileHandle | undefined> {
    try {
      return await this.handles.get(id);
    } catch {
      return undefined;
    }
  }

  write(session: StoredSession, assets: SessionWrite = {}): Promise<void> {
    return this.enqueue(() => this.persist(session, assets));
  }

  clear(): Promise<void> {
    return this.write(emptySession());
  }

  private async persist(session: StoredSession, assets: SessionWrite): Promise<void> {
    let previous: StoredSession;
    try {
      previous = await this.records.read();
    } catch {
      previous = emptySession();
    }

    const kept = new Set(session.edits.map((edit) => edit.id));
    for (const [id, blob] of assets.images ?? []) {
      if (!kept.has(id)) {
        continue;
      }
      try {
        await this.images.put(id, blob);
      } catch {
        // The row can still be listed. Opening it reports that the copy is missing.
      }
    }
    for (const [id, handle] of assets.handles ?? []) {
      if (!kept.has(id)) {
        continue;
      }
      try {
        if (handle) {
          await this.handles.put(id, handle);
        } else {
          await this.handles.delete([id]);
        }
      } catch {
        // A missing handle still leaves the saved photo copy.
      }
    }

    await this.records.write(session);
    const removed = previous.edits.map((edit) => edit.id).filter((id) => !kept.has(id));
    if (removed.length === 0) {
      return;
    }
    try {
      await this.images.delete(removed);
    } catch {
      // The dropped edits are already gone from the list. A leftover copy stays unused.
    }
    try {
      await this.handles.delete(removed);
    } catch {
      // The dropped edits are already gone from the list. A leftover handle stays hidden.
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

class IndexedDbSessionList implements SessionListDb {
  async read(): Promise<StoredSession> {
    const db = await openPhotoDatabase();
    const value = await requestResult(
      db
        .transaction(sessionListStoreName, 'readonly')
        .objectStore(sessionListStoreName)
        .get(sessionListKey),
    );
    return sessionFromUnknown(value);
  }

  async write(session: StoredSession): Promise<void> {
    const db = await openPhotoDatabase();
    const transaction = db.transaction(sessionListStoreName, 'readwrite');
    transaction.objectStore(sessionListStoreName).put(session, sessionListKey);
    await transactionDone(transaction);
  }
}

class IndexedDbSessionImages implements EditImageDb {
  async get(id: string): Promise<Blob | undefined> {
    const db = await openPhotoDatabase();
    const value = await requestResult(
      db.transaction(sessionImageStoreName, 'readonly').objectStore(sessionImageStoreName).get(id),
    );
    return value instanceof Blob ? value : undefined;
  }

  async put(id: string, image: Blob): Promise<void> {
    const db = await openPhotoDatabase();
    const transaction = db.transaction(sessionImageStoreName, 'readwrite');
    transaction.objectStore(sessionImageStoreName).put(image, id);
    await transactionDone(transaction);
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const db = await openPhotoDatabase();
    const transaction = db.transaction(sessionImageStoreName, 'readwrite');
    const store = transaction.objectStore(sessionImageStoreName);
    for (const id of ids) {
      store.delete(id);
    }
    await transactionDone(transaction);
  }
}

class IndexedDbSessionHandles implements FileHandleDb {
  async get(id: string): Promise<StoredFileHandle | undefined> {
    const db = await openPhotoDatabase();
    const value = await requestResult(
      db
        .transaction(sessionHandleStoreName, 'readonly')
        .objectStore(sessionHandleStoreName)
        .get(id),
    );
    return isStoredFileHandle(value) ? value : undefined;
  }

  async put(id: string, handle: StoredFileHandle): Promise<void> {
    const db = await openPhotoDatabase();
    const transaction = db.transaction(sessionHandleStoreName, 'readwrite');
    transaction.objectStore(sessionHandleStoreName).put(handle, id);
    await transactionDone(transaction);
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const db = await openPhotoDatabase();
    const transaction = db.transaction(sessionHandleStoreName, 'readwrite');
    const store = transaction.objectStore(sessionHandleStoreName);
    for (const id of ids) {
      store.delete(id);
    }
    await transactionDone(transaction);
  }
}

function normalizeSessionEdit(value: unknown): SessionEdit | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  if (
    typeof entry['id'] !== 'string' ||
    typeof entry['fileName'] !== 'string' ||
    typeof entry['rightCaption'] !== 'string' ||
    typeof entry['date'] !== 'string'
  ) {
    return null;
  }

  return {
    id: entry['id'],
    fileName: entry['fileName'],
    rightCaption: entry['rightCaption'],
    date: entry['date'],
    thumbnail: entry['thumbnail'] instanceof Blob ? entry['thumbnail'] : new Blob(),
    panX: unitPosition(entry['panX']),
    panY: unitPosition(entry['panY']),
    zoom: framedZoom(entry['zoom']),
    orientation: entry['orientation'] === 'portrait' ? 'portrait' : 'landscape',
  };
}

function unitPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

function framedZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return 1;
  }
  if (value > 4) {
    return 4;
  }
  return value;
}

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
