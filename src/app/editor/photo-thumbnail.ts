import { coverCrop } from './frame-layout';

const thumbnailHeight = 144;
const thumbnailQuality = 0.72;

export function thumbnailBlob(
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  frameWidth: number,
  frameHeight: number,
  panX: number,
  panY: number,
  zoom: number,
): Promise<Blob | null> {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return Promise.resolve(null);
  }

  const crop = coverCrop(sourceWidth, sourceHeight, frameWidth, frameHeight, panX, panY, zoom);
  if (crop.sw <= 0 || crop.sh <= 0) {
    return Promise.resolve(null);
  }

  const width = Math.max(1, Math.round(thumbnailHeight * (frameWidth / frameHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = thumbnailHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.resolve(null);
  }

  try {
    context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, thumbnailHeight);
  } catch {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', thumbnailQuality);
    } catch {
      resolve(null);
    }
  });
}

export function originalPng(
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
): Promise<Blob | null> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) {
    return Promise.resolve(null);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.resolve(null);
  }

  try {
    context.drawImage(image, 0, 0, width, height);
  } catch {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}
