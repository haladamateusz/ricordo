import {
  buildFrameLayout,
  captionFontScale,
  clampUnit,
  coverCrop,
  mmToPx,
  orientationOf,
  zoomCover,
} from './frame-layout';

describe('frame layout', () => {
  it('treats square and landscape photos as 15 by 10', () => {
    expect(orientationOf(1500, 1000)).toBe('landscape');
    expect(orientationOf(1000, 1000)).toBe('landscape');
    expect(orientationOf(1000, 1500)).toBe('portrait');
  });

  it('converts millimetres at 300 dpi', () => {
    expect(mmToPx(25.4, 300)).toBe(300);
  });

  it('places the black rule outside the photo and centers captions on the image', () => {
    const layout = buildFrameLayout('landscape');

    expect(layout.canvas.width).toBe(Math.round(mmToPx(150)));
    expect(layout.canvas.height).toBe(Math.round(mmToPx(100)));
    expect(layout.canvas.width / layout.canvas.height).toBeCloseTo(1.5, 2);
    expect(layout.photo.width).toBeGreaterThan(layout.photo.height);
    expect(layout.photo.x).toBeCloseTo(layout.borderOuter.x + layout.borderWidthPx);
    expect(layout.photo.y).toBeCloseTo(layout.borderOuter.y + layout.borderWidthPx);
    expect(layout.borderOuter.width).toBeCloseTo(layout.photo.width + layout.borderWidthPx * 2);
    expect(layout.leftCaptionX).toBe(layout.photo.x);
    expect(layout.rightCaptionX).toBe(layout.photo.x + layout.photo.width);
    const bandTop = layout.borderOuter.y + layout.borderOuter.height;
    expect(layout.captionCenterY).toBe(bandTop + Math.round((layout.canvas.height - bandTop) / 2));
    expect(layout.captionCenterY).toBeGreaterThan(layout.photo.y + layout.photo.height);
  });

  it('uses a 10 by 15 card for a portrait photo', () => {
    const layout = buildFrameLayout('portrait');

    expect(layout.canvas.width).toBe(Math.round(mmToPx(100)));
    expect(layout.canvas.height).toBe(Math.round(mmToPx(150)));
    expect(layout.canvas.width / layout.canvas.height).toBeCloseTo(2 / 3, 2);
    expect(layout.photo.height).toBeGreaterThan(layout.photo.width);
  });

  it('centers a cover crop and clamps the pan', () => {
    const crop = coverCrop(4000, 2000, 1500, 1000, 0.5, 0.5);

    expect(crop.sw).toBeCloseTo(3000);
    expect(crop.sh).toBeCloseTo(2000);
    expect(crop.sx).toBeCloseTo(500);
    expect(crop.sy).toBeCloseTo(0);
    expect(clampUnit(-0.2)).toBe(0);
    expect(clampUnit(1.4)).toBe(1);
  });

  it('keeps the opening covered and zooms toward a point', () => {
    const covered = coverCrop(4000, 2000, 1500, 1000, 0.5, 0.5, 0.2);
    const minimum = coverCrop(4000, 2000, 1500, 1000, 0.5, 0.5, 1);
    expect(covered).toEqual(minimum);

    const zoomed = coverCrop(4000, 2000, 1500, 1000, 0.5, 0.5, 2);
    expect(zoomed.sw).toBeCloseTo(1500);
    expect(zoomed.sh).toBeCloseTo(1000);
    expect(zoomed.sx).toBeGreaterThanOrEqual(0);
    expect(zoomed.sy).toBeGreaterThanOrEqual(0);
    expect(zoomed.sx + zoomed.sw).toBeLessThanOrEqual(4000);
    expect(zoomed.sy + zoomed.sh).toBeLessThanOrEqual(2000);

    const shifted = zoomCover(4000, 2000, 1500, 1000, 0.5, 0.5, 1, 0, 500, 2);
    expect(shifted.zoom).toBe(2);
    expect(shifted.panX).toBeCloseTo(0.2);
    expect(shifted.panY).toBeCloseTo(0.5);
    expect(zoomCover(4000, 2000, 1500, 1000, 0.5, 0.5, 1, 750, 500, 8).zoom).toBe(4);
  });

  it('covers a portrait photo and stays covered when zooming back out', () => {
    const crop = coverCrop(2000, 4000, 1000, 1500, 0.5, 0.5);

    expect(crop.sw).toBeCloseTo(2000);
    expect(crop.sh).toBeCloseTo(3000);
    expect(crop.sx).toBeCloseTo(0);
    expect(crop.sy).toBeCloseTo(500);

    const zoomedOut = zoomCover(4000, 2000, 1500, 1000, 0, 0, 2, 0, 0, 0.5);
    expect(zoomedOut.zoom).toBe(1);
    expect(zoomedOut.panX).toBeCloseTo(0);
    expect(zoomedOut.panY).toBeCloseTo(0.5);

    const covered = coverCrop(
      4000,
      2000,
      1500,
      1000,
      zoomedOut.panX,
      zoomedOut.panY,
      zoomedOut.zoom,
    );
    expect(covered.sx).toBeGreaterThanOrEqual(0);
    expect(covered.sy).toBeGreaterThanOrEqual(0);
    expect(covered.sx + covered.sw).toBeLessThanOrEqual(4000);
    expect(covered.sy + covered.sh).toBeLessThanOrEqual(2000);
    expect(covered.sw).toBeCloseTo(3000);
    expect(covered.sh).toBeCloseTo(2000);
  });

  it('shrinks a caption only when it would cross the center', () => {
    expect(captionFontScale(80, 120)).toBe(1);
    expect(captionFontScale(200, 100)).toBeCloseTo(0.5);
    expect(captionFontScale(0, 100)).toBe(1);
  });
});
