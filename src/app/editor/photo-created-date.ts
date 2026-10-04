// The full exifr build dynamically imports optional readers, which Vite cannot
// analyze. The lite build covers JPEG and HEIC dates without that import.
import exifr from 'exifr/dist/lite.esm.mjs';

const JPEG_TYPES = new Set(['image/jpeg', 'image/jpg']);
const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const OTHER_PHOTO_TYPES = new Set(['image/png', 'image/webp']);
const JPEG_EXTENSIONS = ['.jpg', '.jpeg'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];
const OTHER_PHOTO_EXTENSIONS = ['.png', '.webp'];

export function isHeic(file: File): boolean {
  return matchesFile(file, HEIC_TYPES, HEIC_EXTENSIONS);
}

export function isAcceptedPhoto(file: File): boolean {
  return (
    isHeic(file) ||
    matchesFile(file, JPEG_TYPES, JPEG_EXTENSIONS) ||
    matchesFile(file, OTHER_PHOTO_TYPES, OTHER_PHOTO_EXTENSIONS)
  );
}

export async function readCreatedDate(file: File): Promise<string | null> {
  if (!isHeic(file) && !matchesFile(file, JPEG_TYPES, JPEG_EXTENSIONS)) {
    return null;
  }

  try {
    // A `pick` list walks every TIFF block. The lite build has no interop
    // dictionary, so that list throws before any date is read.
    const tags: unknown = await exifr.parse(file, {
      reviveValues: false,
    });
    return createdDateFromTags(tags);
  } catch {
    return null;
  }
}

function matchesFile(file: File, types: Set<string>, extensions: readonly string[]): boolean {
  if (types.has(file.type.toLowerCase())) {
    return true;
  }

  const name = file.name.toLowerCase();
  return extensions.some((extension) => name.endsWith(extension));
}

function createdDateFromTags(tags: unknown): string | null {
  if (typeof tags !== 'object' || tags === null) {
    return null;
  }

  const dates = tags as {
    DateTimeOriginal?: unknown;
    CreateDate?: unknown;
    ModifyDate?: unknown;
  };

  // The capture date is the one that belongs on the print. CreateDate is the
  // digitized date, and some cameras only fill that in.
  return (
    isoDateFromExif(dates.DateTimeOriginal) ??
    isoDateFromExif(dates.CreateDate) ??
    isoDateFromExif(dates.ModifyDate)
  );
}

function isoDateFromExif(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(value.trim());
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (!yearText || !monthText || !dayText) {
    return null;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${yearText}-${monthText}-${dayText}`;
}
