import { formatCaptionDate } from './date-picker';
import { buildFrameLayout, type Orientation } from './frame-layout';
import { paintFrame } from './frame-renderer';

export interface FramedSource {
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number };
  orientation: Orientation;
  panX: number;
  panY: number;
  zoom: number;
  date: string;
  rightCaption: string;
}

export function framedDownloadName(fileName: string, used: Map<string, number>): string {
  const base =
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/]/g, '-')
      .trim() || 'photo';
  const stem = `${base}-framed`;
  const count = (used.get(stem) ?? 0) + 1;
  used.set(stem, count);
  return count === 1 ? `${stem}.png` : `${stem}-${count}.png`;
}

export function renderFramedPng(source: FramedSource): Promise<Blob> {
  const layout = buildFrameLayout(source.orientation);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.canvas.width);
  canvas.height = Math.round(layout.canvas.height);
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.reject(new Error('canvas'));
  }

  paintFrame(
    context,
    source.image,
    source.image.naturalWidth,
    source.image.naturalHeight,
    layout,
    source.panX,
    source.panY,
    source.zoom,
    formatCaptionDate(source.date),
    source.rightCaption,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('png'));
      }
    }, 'image/png');
  });
}
