import type { Orientation } from './frame-layout';
import { readStoredZip, zipStored } from './zip-store';

export const projectFileName = 'ricordo-project.zip';

export interface ProjectPhoto {
  fileName: string;
  rightCaption: string;
  date: string;
  panX: number;
  panY: number;
  zoom: number;
  orientation: Orientation;
  source: Blob;
}

export interface ImportedProject {
  activeIndex: number;
  photos: ProjectPhoto[];
}

const projectManifest = 'project.json';
const archiveVersion = 1;

export async function projectArchive(
  photos: readonly ProjectPhoto[],
  activeIndex: number,
): Promise<Blob> {
  const edits = await Promise.all(
    photos.map(async (photo, index) => ({
      fileName: photo.fileName,
      rightCaption: photo.rightCaption,
      date: photo.date,
      panX: photo.panX,
      panY: photo.panY,
      zoom: photo.zoom,
      orientation: photo.orientation,
      mediaType: mediaTypeOf(photo.fileName, photo.source),
      image: photoEntryName(index, photo.fileName),
      bytes: new Uint8Array(await photo.source.arrayBuffer()),
    })),
  );
  const manifest = {
    version: archiveVersion,
    activeIndex: activeIndex >= 0 && activeIndex < edits.length ? activeIndex : 0,
    edits: edits.map((edit) => ({
      fileName: edit.fileName,
      rightCaption: edit.rightCaption,
      date: edit.date,
      panX: edit.panX,
      panY: edit.panY,
      zoom: edit.zoom,
      orientation: edit.orientation,
      mediaType: edit.mediaType,
      image: edit.image,
    })),
  };

  return zipStored([
    { name: projectManifest, bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
    ...edits.map((edit) => ({ name: edit.image, bytes: edit.bytes })),
  ]);
}

export async function readProjectArchive(file: Blob): Promise<ImportedProject | null> {
  const entries = readStoredZip(new Uint8Array(await file.arrayBuffer()));
  if (!entries) {
    return null;
  }

  const files = new Map(entries.map((entry) => [entry.name, entry.bytes]));
  const manifest = files.get(projectManifest);
  if (!manifest) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifest));
  } catch {
    return null;
  }
  return projectFromUnknown(parsed, files);
}

function projectFromUnknown(
  value: unknown,
  files: ReadonlyMap<string, Uint8Array>,
): ImportedProject | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  if (entry['version'] !== archiveVersion || !Array.isArray(entry['edits'])) {
    return null;
  }

  const photos: ProjectPhoto[] = [];
  for (const item of entry['edits']) {
    const photo = photoFromUnknown(item, files);
    if (!photo) {
      return null;
    }
    photos.push(photo);
  }
  if (photos.length === 0) {
    return null;
  }

  const activeIndex = entry['activeIndex'];
  return {
    activeIndex:
      typeof activeIndex === 'number' &&
      Number.isInteger(activeIndex) &&
      activeIndex >= 0 &&
      activeIndex < photos.length
        ? activeIndex
        : 0,
    photos,
  };
}

function photoFromUnknown(
  value: unknown,
  files: ReadonlyMap<string, Uint8Array>,
): ProjectPhoto | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const image = entry['image'];
  if (
    typeof entry['fileName'] !== 'string' ||
    typeof entry['rightCaption'] !== 'string' ||
    typeof entry['date'] !== 'string' ||
    typeof image !== 'string' ||
    !isSafeZipPath(image) ||
    (entry['orientation'] !== 'landscape' && entry['orientation'] !== 'portrait')
  ) {
    return null;
  }

  const bytes = files.get(image);
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  const panX = unitPosition(entry['panX']);
  const panY = unitPosition(entry['panY']);
  const zoom = framedZoom(entry['zoom']);
  if (panX === null || panY === null || zoom === null) {
    return null;
  }

  const mediaType = typeof entry['mediaType'] === 'string' ? entry['mediaType'] : '';
  return {
    fileName: entry['fileName'].replace(/[/\\]/g, '-').trim().slice(0, 255) || 'photo',
    rightCaption: entry['rightCaption'],
    date: entry['date'],
    panX,
    panY,
    zoom,
    orientation: entry['orientation'],
    source: new Blob([bytes.slice()], { type: mediaType || 'application/octet-stream' }),
  };
}

function photoEntryName(index: number, fileName: string): string {
  const padded = String(index + 1).padStart(3, '0');
  return `photos/${padded}-${archiveFileName(fileName)}`;
}

function archiveFileName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  let cleaned = '';
  for (const char of base) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) {
      continue;
    }
    cleaned += '/:*?"<>|'.includes(char) ? '_' : char;
  }
  return cleaned.replace(/^\.+/, '').trim().slice(0, 120) || 'photo';
}

function isSafeZipPath(name: string): boolean {
  if (name.startsWith('/') || name.includes('\\') || name.includes('\0')) {
    return false;
  }
  const parts = name.split('/');
  return parts.length > 0 && parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

function mediaTypeOf(fileName: string, blob: Blob): string {
  if (blob.type.startsWith('image/')) {
    return blob.type;
  }

  switch (fileName.split('.').pop()?.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
      return 'image/png';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    default:
      return 'application/octet-stream';
  }
}

function unitPosition(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

function framedZoom(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value < 1) {
    return 1;
  }
  if (value > 4) {
    return 4;
  }
  return value;
}
