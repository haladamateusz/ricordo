import { Injectable, signal } from '@angular/core';

import type { StoredFileHandle } from './edit-history';
import type { Orientation } from './frame-layout';

export interface CurrentEdit {
  id: string;
  fileName: string;
  rightCaption: string;
  date: string;
  panX: number;
  panY: number;
  zoom: number;
  orientation: Orientation;
  thumbnailUrl: string;
  thumbnail: Blob;
  image: HTMLImageElement;
  objectUrl: string;
  source: Blob;
  handle: StoredFileHandle | null;
}

export interface CurrentDraft {
  fileName: string;
  rightCaption: string;
  date: string;
  panX: number;
  panY: number;
  zoom: number;
  orientation: Orientation;
  image: HTMLImageElement;
  objectUrl: string;
  source: Blob;
  handle: StoredFileHandle | null;
}

export interface CurrentPatch {
  rightCaption: string;
  date: string;
  panX: number;
  panY: number;
  zoom: number;
  orientation: Orientation;
}

@Injectable()
export class CurrentSession {
  private readonly editsState = signal<readonly CurrentEdit[]>([]);
  private readonly activeIdState = signal<string | null>(null);

  readonly edits = this.editsState.asReadonly();
  readonly activeId = this.activeIdState.asReadonly();

  begin(draft: CurrentDraft): string {
    const id = crypto.randomUUID();
    const edit: CurrentEdit = { id, thumbnailUrl: '', thumbnail: new Blob(), ...draft };
    this.editsState.update((edits) => [edit, ...edits]);
    this.activeIdState.set(id);
    return id;
  }

  adopt(edits: readonly CurrentEdit[], activeId: string | null): void {
    const kept = new Set<string>();
    for (const edit of edits) {
      kept.add(edit.objectUrl);
      if (edit.thumbnailUrl) {
        kept.add(edit.thumbnailUrl);
      }
    }
    for (const edit of this.editsState()) {
      if (edit.thumbnailUrl && !kept.has(edit.thumbnailUrl)) {
        URL.revokeObjectURL(edit.thumbnailUrl);
      }
      if (!kept.has(edit.objectUrl)) {
        URL.revokeObjectURL(edit.objectUrl);
      }
    }

    this.editsState.set(edits);
    this.activeIdState.set(
      edits.some((edit) => edit.id === activeId) ? activeId : (edits[0]?.id ?? null),
    );
  }

  activate(id: string): void {
    if (this.editsState().some((edit) => edit.id === id)) {
      this.activeIdState.set(id);
    }
  }

  move(id: string, toIndex: number): boolean {
    const edits = this.editsState();
    const from = edits.findIndex((edit) => edit.id === id);
    if (from < 0 || edits.length < 2) {
      return false;
    }

    const to = Math.max(0, Math.min(edits.length - 1, toIndex));
    if (from === to) {
      return false;
    }

    const next = [...edits];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.editsState.set(next);
    return true;
  }

  moveGroup(ids: readonly string[], anchorId: string, anchorIndex: number): boolean {
    const edits = this.editsState();
    const wanted = new Set(ids);
    const moving = edits.filter((edit) => wanted.has(edit.id));
    const anchorOffset = moving.findIndex((edit) => edit.id === anchorId);
    if (anchorOffset < 0 || moving.length < 2 || edits.length < 2) {
      return false;
    }

    const rest = edits.filter((edit) => !wanted.has(edit.id));
    const insertAt = Math.max(0, Math.min(rest.length, anchorIndex - anchorOffset));
    const next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    if (next.every((edit, index) => edit.id === edits[index]?.id)) {
      return false;
    }

    this.editsState.set(next);
    return true;
  }

  discard(id: string): CurrentEdit | null {
    const edits = this.editsState();
    const index = edits.findIndex((edit) => edit.id === id);
    if (index < 0) {
      return null;
    }

    const removed = edits[index];
    const remaining = edits.filter((edit) => edit.id !== id);
    this.editsState.set(remaining);
    if (removed.thumbnailUrl) {
      URL.revokeObjectURL(removed.thumbnailUrl);
    }
    if (!this.holds(removed.objectUrl)) {
      URL.revokeObjectURL(removed.objectUrl);
    }

    const next = remaining[Math.max(0, index - 1)] ?? null;
    this.activeIdState.set(next?.id ?? null);
    return next;
  }

  find(id: string): CurrentEdit | undefined {
    return this.editsState().find((edit) => edit.id === id);
  }

  write(id: string, patch: CurrentPatch): void {
    this.editsState.update((edits) =>
      edits.map((edit) => (edit.id === id ? { ...edit, ...patch } : edit)),
    );
  }

  replacePhoto(id: string, draft: CurrentDraft): boolean {
    const current = this.find(id);
    if (!current) {
      return false;
    }

    const previousUrl = current.objectUrl;
    const previousThumb = current.thumbnailUrl;
    this.editsState.update((edits) =>
      edits.map((edit) =>
        edit.id === id ? { ...edit, ...draft, id, thumbnailUrl: '', thumbnail: new Blob() } : edit,
      ),
    );
    if (previousThumb) {
      URL.revokeObjectURL(previousThumb);
    }
    if (previousUrl !== draft.objectUrl && !this.holds(previousUrl)) {
      URL.revokeObjectURL(previousUrl);
    }
    return true;
  }

  setThumbnail(id: string, thumbnailUrl: string, thumbnail: Blob): void {
    const previous = this.find(id)?.thumbnailUrl;
    if (previous && previous !== thumbnailUrl) {
      URL.revokeObjectURL(previous);
    }
    this.editsState.update((edits) =>
      edits.map((edit) => (edit.id === id ? { ...edit, thumbnailUrl, thumbnail } : edit)),
    );
  }

  holds(objectUrl: string): boolean {
    return this.editsState().some((edit) => edit.objectUrl === objectUrl);
  }

  release(): void {
    const urls = new Set<string>();
    for (const edit of this.editsState()) {
      urls.add(edit.objectUrl);
      if (edit.thumbnailUrl) {
        urls.add(edit.thumbnailUrl);
      }
    }
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
    this.editsState.set([]);
    this.activeIdState.set(null);
  }
}
