import { Injectable, signal } from '@angular/core';

import type { StoredFileHandle } from './edit-history';

export interface CurrentEdit {
  id: string;
  fileName: string;
  rightCaption: string;
  date: string;
  panX: number;
  panY: number;
  zoom: number;
  thumbnailUrl: string;
  image: HTMLImageElement;
  objectUrl: string;
  handle: StoredFileHandle | null;
}

export interface CurrentDraft {
  fileName: string;
  rightCaption: string;
  date: string;
  panX: number;
  panY: number;
  zoom: number;
  image: HTMLImageElement;
  objectUrl: string;
  handle: StoredFileHandle | null;
}

export interface CurrentPatch {
  rightCaption: string;
  date: string;
  panX: number;
  panY: number;
  zoom: number;
}

@Injectable()
export class CurrentSession {
  private readonly editsState = signal<readonly CurrentEdit[]>([]);
  private readonly activeIdState = signal<string | null>(null);

  readonly edits = this.editsState.asReadonly();
  readonly activeId = this.activeIdState.asReadonly();

  begin(draft: CurrentDraft): string {
    const id = crypto.randomUUID();
    const edit: CurrentEdit = { id, thumbnailUrl: '', ...draft };
    this.editsState.update((edits) => [edit, ...edits]);
    this.activeIdState.set(id);
    return id;
  }

  activate(id: string): void {
    if (this.editsState().some((edit) => edit.id === id)) {
      this.activeIdState.set(id);
    }
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
      edits.map((edit) => (edit.id === id ? { ...edit, ...draft, id, thumbnailUrl: '' } : edit)),
    );
    if (previousThumb) {
      URL.revokeObjectURL(previousThumb);
    }
    if (previousUrl !== draft.objectUrl && !this.holds(previousUrl)) {
      URL.revokeObjectURL(previousUrl);
    }
    return true;
  }

  setThumbnail(id: string, thumbnailUrl: string): void {
    const previous = this.find(id)?.thumbnailUrl;
    if (previous && previous !== thumbnailUrl) {
      URL.revokeObjectURL(previous);
    }
    this.editsState.update((edits) =>
      edits.map((edit) => (edit.id === id ? { ...edit, thumbnailUrl } : edit)),
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
