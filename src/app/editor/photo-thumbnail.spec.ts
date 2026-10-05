import { afterEach, vi } from 'vitest';

import { originalPng, thumbnailBlob } from './photo-thumbnail';

describe('thumbnailBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns nothing when the photo has no pixels', async () => {
    const image = { naturalWidth: 0, naturalHeight: 1200 } as HTMLImageElement;

    await expect(thumbnailBlob(image, 1500, 1000, 0.5, 0.5, 1)).resolves.toBeNull();
  });

  it('crops the thumbnail with the frame zoom and position', async () => {
    const draws: number[][] = [];
    const thumb = new Blob(['crop'], { type: 'image/jpeg' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: (_image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) => {
        draws.push([sx, sy, sw, sh]);
      },
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback?.(thumb);
    });
    const image = { naturalWidth: 4000, naturalHeight: 2000 } as HTMLImageElement;

    await expect(thumbnailBlob(image, 1500, 1000, 0.5, 0.5, 1)).resolves.toBe(thumb);
    await expect(thumbnailBlob(image, 1500, 1000, 0, 0.5, 2)).resolves.toBe(thumb);
    await expect(thumbnailBlob(image, 1500, 1000, 1, 0.5, 2)).resolves.toBe(thumb);

    const fitted = draws[0];
    const left = draws[1];
    const right = draws[2];
    expect(left?.[2]).toBeLessThan(fitted?.[2] ?? 0);
    expect(left?.[3]).toBeLessThan(fitted?.[3] ?? 0);
    expect(left?.[0]).toBeLessThan(right?.[0] ?? 0);
  });
});

describe('originalPng', () => {
  it('returns nothing when the photo has no pixels', async () => {
    const image = { naturalWidth: 0, naturalHeight: 1200 } as HTMLImageElement;

    await expect(originalPng(image)).resolves.toBeNull();
  });
});
