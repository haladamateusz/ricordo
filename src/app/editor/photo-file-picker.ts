import { InjectionToken } from '@angular/core';

import { isStoredFileHandle, type StoredFileHandle } from './edit-history';

export interface PickedPhoto {
  file: File;
  handle: StoredFileHandle;
}

export type PhotoSelection = readonly PickedPhoto[] | 'fallback' | null;

interface FilePickerWindow {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    excludeAcceptAllOption: boolean;
    types: {
      description: string;
      accept: Record<string, string[]>;
    }[];
  }) => Promise<unknown[]>;
}

interface DropItem {
  getAsFileSystemHandle?: () => Promise<unknown>;
}

const photoType = {
  description: 'Photos',
  accept: {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
    'image/heic': ['.heic'],
    'image/heif': ['.heif'],
  },
};

export const PHOTO_FILE_PICKER = new InjectionToken<
  (multiple: boolean) => Promise<PhotoSelection>
>('PHOTO_FILE_PICKER', {
  providedIn: 'root',
  factory: () => pickPhotoFiles,
});

export function hasFileSystemPicker(): boolean {
  return typeof (window as Window & FilePickerWindow).showOpenFilePicker === 'function';
}

export async function pickPhotoFiles(multiple: boolean): Promise<PhotoSelection> {
  if (!hasFileSystemPicker()) {
    return 'fallback';
  }

  try {
    const picker = (window as Window & FilePickerWindow).showOpenFilePicker;
    if (!picker) {
      return 'fallback';
    }
    const selected = await picker.call(window, {
      multiple,
      excludeAcceptAllOption: false,
      types: [photoType],
    });
    const photos: PickedPhoto[] = [];
    for (const picked of selected) {
      const handle = isStoredFileHandle(picked) ? picked : null;
      if (!handle) {
        continue;
      }
      photos.push({ file: await handle.getFile(), handle });
    }
    return photos.length > 0 ? photos : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null;
    }
    return 'fallback';
  }
}

export async function filesFromDrop(
  dataTransfer: DataTransfer | null,
): Promise<(PickedPhoto | File)[]> {
  const items = [...(dataTransfer?.items ?? [])];
  const picked: (PickedPhoto | File)[] = [];
  for (const item of items) {
    const source = item as DataTransferItem & DropItem;
    if (typeof source.getAsFileSystemHandle === 'function') {
      try {
        const handle = await source.getAsFileSystemHandle();
        if (isStoredFileHandle(handle)) {
          picked.push({ file: await handle.getFile(), handle });
          continue;
        }
      } catch {
        // The dropped file could not be reopened. Fall through to the plain file.
      }
    }
    const file = item.getAsFile?.();
    if (file) {
      picked.push(file);
    }
  }
  if (picked.length > 0) {
    return picked;
  }

  return [...(dataTransfer?.files ?? [])];
}
