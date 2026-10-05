import { InjectionToken, Service, inject, signal } from '@angular/core';

export const EDIT_HISTORY_LIMIT = 50;

export interface StoredEdit {
  id: string;
  fileName: string;
  rightCaption: string;
  date: string;
  thumbnail: Blob;
  thumbnailUrl: string;
  panX: number;
  panY: number;
  zoom: number;
}

export interface EditRecord {
  id: string;
  fileName: string;
  rightCaption: string;
  date: string;
  thumbnail: Blob;
  panX: number;
  panY: number;
  zoom: number;
}

export interface StoredFileHandle {
  readonly kind: 'file';
  queryPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
  getFile(): Promise<File>;
}

export interface NewEdit {
  fileName: string;
  rightCaption: string;
  date: string;
  thumbnail: Blob | null;
  image: Blob | null;
  handle: StoredFileHandle | null;
  panX: number;
  panY: number;
  zoom: number;
}

export interface EditListDb {
  read(): Promise<EditRecord[]>;
  write(edits: readonly EditRecord[]): Promise<void>;
}

export interface EditImageDb {
  get(id: string): Promise<Blob | undefined>;
  put(id: string, image: Blob): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
}

export interface FileHandleDb {
  get(id: string): Promise<StoredFileHandle | undefined>;
  put(id: string, handle: StoredFileHandle): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
}

export type FileAccess = 'granted' | 'prompt' | 'denied' | 'missing' | 'gone';

export interface ResolvedEdits {
  visible: StoredEdit[];
  goneIds: string[];
}

const handleDbName = 'ricordo';
const handleStoreName = 'file-handles';
const imageStoreName = 'edit-images';
const listStoreName = 'edits';
const listKey = 'list';
const databaseVersion = 3;

export const EDIT_LIST_DB = new InjectionToken<EditListDb>('EDIT_LIST_DB', {
  providedIn: 'root',
  factory: () => new IndexedDbEditList(),
});

export const FILE_HANDLE_DB = new InjectionToken<FileHandleDb>('FILE_HANDLE_DB', {
  providedIn: 'root',
  factory: () => new IndexedDbFileHandles(),
});

export const EDIT_IMAGE_DB = new InjectionToken<EditImageDb>('EDIT_IMAGE_DB', {
  providedIn: 'root',
  factory: () => new IndexedDbEditImages(),
});

@Service()
export class EditHistory {
  private readonly records = inject(EDIT_LIST_DB);
  private readonly handles = inject(FILE_HANDLE_DB);
  private readonly images = inject(EDIT_IMAGE_DB);
  private readonly loadedState = signal(false);
  private readonly editsState = signal<StoredEdit[]>([]);
  private readonly thumbnailUrls = new Map<string, string>();
  private chain = this.restore();

  readonly loaded = this.loadedState.asReadonly();
  readonly edits = this.editsState.asReadonly();

  async record(input: NewEdit): Promise<void> {
    await this.enqueue(() => this.persist(input));
  }

  private async persist(input: NewEdit): Promise<void> {
    const entry: StoredEdit = {
      id: crypto.randomUUID(),
      fileName: input.fileName,
      rightCaption: input.rightCaption,
      date: input.date,
      thumbnail: input.thumbnail ?? new Blob(),
      thumbnailUrl: '',
      panX: unitPosition(input.panX),
      panY: unitPosition(input.panY),
      zoom: framedZoom(input.zoom),
    };
    const { edits, removedIds } = prependEdit(this.editsState(), entry);

    if (input.handle) {
      try {
        await this.handles.put(entry.id, input.handle);
      } catch {
        // The saved thumbnail can still be shown when the handle cannot be stored.
      }
    }

    if (input.image) {
      try {
        await this.images.put(entry.id, input.image);
      } catch {
        // The row can still be shown. Opening it reports that the copy is missing.
      }
    }

    try {
      await this.records.write(edits.map(toRecord));
    } catch {
      await this.handles.delete([entry.id]);
      await this.images.delete([entry.id]);
      return;
    }

    this.publish(edits);
    try {
      await this.handles.delete(removedIds);
    } catch {
      // The dropped edits are already gone from the list. A leftover handle stays hidden.
    }
    try {
      await this.images.delete(removedIds);
    } catch {
      // The dropped edits are already gone from the list. A leftover copy stays unused.
    }
  }

  image(id: string): Promise<Blob | undefined> {
    return this.images.get(id);
  }

  handle(id: string): Promise<StoredFileHandle | undefined> {
    return this.handles.get(id);
  }

  async remove(ids: readonly string[]): Promise<void> {
    await this.enqueue(() => this.drop(ids));
  }

  private async drop(ids: readonly string[]): Promise<void> {
    const drop = new Set(ids);
    if (drop.size === 0) {
      return;
    }

    const next = this.editsState().filter((edit) => !drop.has(edit.id));
    if (next.length === this.editsState().length) {
      return;
    }

    try {
      await this.records.write(next.map(toRecord));
    } catch {
      return;
    }

    this.publish(next);
    try {
      await this.handles.delete([...drop]);
    } catch {
      // The edits are already gone. A leftover handle cannot appear on its own.
    }
    try {
      await this.images.delete([...drop]);
    } catch {
      // The edits are already gone. A leftover copy cannot appear on its own.
    }
  }

  private async restore(): Promise<void> {
    try {
      this.publish(fromRecords(await this.records.read()));
    } catch {
      this.publish([]);
    } finally {
      this.loadedState.set(true);
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

  private publish(edits: readonly StoredEdit[]): void {
    const alive = new Set(edits.map((edit) => edit.id));
    for (const [id, url] of this.thumbnailUrls) {
      if (!alive.has(id)) {
        URL.revokeObjectURL(url);
        this.thumbnailUrls.delete(id);
      }
    }

    this.editsState.set(edits.map((edit) => ({ ...edit, thumbnailUrl: this.thumbnailUrl(edit) })));
  }

  private thumbnailUrl(edit: StoredEdit): string {
    const existing = this.thumbnailUrls.get(edit.id);
    if (existing) {
      return existing;
    }
    if (edit.thumbnail.size === 0) {
      return '';
    }

    const url = URL.createObjectURL(edit.thumbnail);
    this.thumbnailUrls.set(edit.id, url);
    return url;
  }
}

export function editRecordsFromUnknown(value: unknown): EditRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) => {
      const record = normalizeRecord(item);
      return record ? [record] : [];
    })
    .slice(0, EDIT_HISTORY_LIMIT);
}

export function prependEdit(
  current: readonly StoredEdit[],
  entry: StoredEdit,
): { edits: StoredEdit[]; removedIds: string[] } {
  const edits = [entry, ...current].slice(0, EDIT_HISTORY_LIMIT);
  const kept = new Set(edits.map((edit) => edit.id));
  const removedIds = current.filter((edit) => !kept.has(edit.id)).map((edit) => edit.id);
  return { edits, removedIds };
}

export async function fileAccess(handle: StoredFileHandle | undefined): Promise<FileAccess> {
  if (!handle) {
    return 'missing';
  }

  let permission: PermissionState;
  try {
    permission = await handle.queryPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }

  if (permission === 'prompt') {
    return 'prompt';
  }
  if (permission !== 'granted') {
    return 'denied';
  }

  try {
    await handle.getFile();
    return 'granted';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return 'gone';
    }
    return 'denied';
  }
}

export async function resolveVisibleEdits(
  edits: readonly StoredEdit[],
  handles: Pick<FileHandleDb, 'get'>,
): Promise<ResolvedEdits> {
  const visible: StoredEdit[] = [];
  const goneIds: string[] = [];

  for (const edit of edits) {
    let access: FileAccess;
    try {
      access = await fileAccess(await handles.get(edit.id));
    } catch {
      access = 'missing';
    }
    if (access === 'gone') {
      goneIds.push(edit.id);
    } else {
      visible.push(edit);
    }
  }

  return { visible, goneIds };
}

export function isStoredFileHandle(value: unknown): value is StoredFileHandle {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const handle = value as Partial<StoredFileHandle>;
  return (
    handle.kind === 'file' &&
    typeof handle.getFile === 'function' &&
    typeof handle.queryPermission === 'function' &&
    typeof handle.requestPermission === 'function'
  );
}

class IndexedDbFileHandles implements FileHandleDb {
  async get(id: string): Promise<StoredFileHandle | undefined> {
    const db = await openPhotoDatabase();
    const value = await requestResult(
      db.transaction(handleStoreName, 'readonly').objectStore(handleStoreName).get(id),
    );
    return isStoredFileHandle(value) ? value : undefined;
  }

  async put(id: string, handle: StoredFileHandle): Promise<void> {
    const db = await openPhotoDatabase();
    const transaction = db.transaction(handleStoreName, 'readwrite');
    transaction.objectStore(handleStoreName).put(handle, id);
    await transactionDone(transaction);
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const db = await openPhotoDatabase();
    const transaction = db.transaction(handleStoreName, 'readwrite');
    const store = transaction.objectStore(handleStoreName);
    for (const id of ids) {
      store.delete(id);
    }
    await transactionDone(transaction);
  }
}

class IndexedDbEditImages implements EditImageDb {
  async get(id: string): Promise<Blob | undefined> {
    const db = await openPhotoDatabase();
    const value = await requestResult(
      db.transaction(imageStoreName, 'readonly').objectStore(imageStoreName).get(id),
    );
    return value instanceof Blob ? value : undefined;
  }

  async put(id: string, image: Blob): Promise<void> {
    const db = await openPhotoDatabase();
    const transaction = db.transaction(imageStoreName, 'readwrite');
    transaction.objectStore(imageStoreName).put(image, id);
    await transactionDone(transaction);
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const db = await openPhotoDatabase();
    const transaction = db.transaction(imageStoreName, 'readwrite');
    const store = transaction.objectStore(imageStoreName);
    for (const id of ids) {
      store.delete(id);
    }
    await transactionDone(transaction);
  }
}

let photoDatabase: Promise<IDBDatabase> | null = null;

function openPhotoDatabase(): Promise<IDBDatabase> {
  photoDatabase ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(handleDbName, databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(handleStoreName)) {
        db.createObjectStore(handleStoreName);
      }
      if (!db.objectStoreNames.contains(imageStoreName)) {
        db.createObjectStore(imageStoreName);
      }
      if (!db.objectStoreNames.contains(listStoreName)) {
        db.createObjectStore(listStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      photoDatabase = null;
      reject(request.error);
    };
  });
  return photoDatabase;
}

const centeredPan = 0.5;
const minZoom = 1;
const maxZoom = 4;

class IndexedDbEditList implements EditListDb {
  async read(): Promise<EditRecord[]> {
    const db = await openPhotoDatabase();
    const value = await requestResult(
      db.transaction(listStoreName, 'readonly').objectStore(listStoreName).get(listKey),
    );
    return editRecordsFromUnknown(value);
  }

  async write(edits: readonly EditRecord[]): Promise<void> {
    const db = await openPhotoDatabase();
    const transaction = db.transaction(listStoreName, 'readwrite');
    transaction.objectStore(listStoreName).put([...edits], listKey);
    await transactionDone(transaction);
  }
}

function fromRecords(records: readonly EditRecord[]): StoredEdit[] {
  return records.map((record) => ({
    ...record,
    thumbnailUrl: '',
  }));
}

function toRecord(edit: StoredEdit): EditRecord {
  return {
    id: edit.id,
    fileName: edit.fileName,
    rightCaption: edit.rightCaption,
    date: edit.date,
    thumbnail: edit.thumbnail,
    panX: edit.panX,
    panY: edit.panY,
    zoom: edit.zoom,
  };
}

function normalizeRecord(value: unknown): EditRecord | null {
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
  };
}

function unitPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return centeredPan;
  }
  return Math.min(1, Math.max(0, value));
}

function framedZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minZoom) {
    return minZoom;
  }
  if (value > maxZoom) {
    return maxZoom;
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
