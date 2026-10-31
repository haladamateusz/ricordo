import { longestCaptionDate } from './date-picker';
import { buildFrameLayout, captionFontScale, captionGapMm, mmToPx } from './frame-layout';
import { paintFrame } from './frame-renderer';

describe('paintFrame', () => {
  const layout = buildFrameLayout('landscape');
  const image = {} as CanvasImageSource;

  it('paints the Polish date on the left and the right caption on the image edge', () => {
    const { context, captions } = recordingContext();

    paintFrame(context, image, 4000, 2000, layout, 0.5, 0.5, 1, '12 września 2026', 'Cafe');

    expect(captions).toEqual([
      {
        text: '12 września 2026',
        x: layout.leftCaptionX,
        y: layout.captionCenterY,
        align: 'left',
      },
      {
        text: 'Cafe',
        x: layout.rightCaptionX,
        y: layout.captionCenterY,
        align: 'right',
      },
    ]);
  });

  it('skips a blank date', () => {
    const { context, captions } = recordingContext();

    paintFrame(context, image, 4000, 2000, layout, 0.5, 0.5, 1, '   ', 'Cafe');

    expect(captions.map((caption) => caption.text)).toEqual(['Cafe']);
  });

  it('keeps the longest Polish date full size and gives the rest to the right caption', () => {
    const { context, captions, fonts } = recordingContext();
    const rightCaption = 'a'.repeat(400);

    paintFrame(context, image, 4000, 2000, layout, 0.5, 0.5, 1, longestCaptionDate, rightCaption);

    const dateSlot = longestCaptionDate.length * 8;
    const rightMax = layout.photo.width - dateSlot - Math.round(mmToPx(captionGapMm));
    const rightScale = captionFontScale(rightCaption.length * 8, rightMax);

    expect(fonts[0]).toBe(`400 ${layout.captionFontSizePx}px Geist, sans-serif`);
    expect(fonts[1]).toBe(`400 ${layout.captionFontSizePx * rightScale}px Geist, sans-serif`);
    expect(captions[1]?.x).toBe(layout.rightCaptionX);
    expect(rightMax).toBeGreaterThan(layout.photo.width / 2);
  });

  it('keeps the right caption full size when the date leaves enough room', () => {
    const { context, fonts } = recordingContext();
    const portrait = buildFrameLayout('portrait');
    const date = '31 lipca 2025';
    const rightCaption = 'x'.repeat(100);

    paintFrame(context, image, 2000, 4000, portrait, 0.5, 0.5, 1, date, rightCaption);

    const gap = Math.round(mmToPx(captionGapMm));
    const besideDate = portrait.photo.width - date.length * 8 - gap;
    const besideLongest = portrait.photo.width - longestCaptionDate.length * 8 - gap;

    expect(rightCaption.length * 8).toBeGreaterThan(besideLongest);
    expect(rightCaption.length * 8).toBeLessThanOrEqual(besideDate);
    expect(fonts[1]).toBe(`400 ${portrait.captionFontSizePx}px Geist, sans-serif`);
  });

  it('scales the right caption only when it is wider than the room beside the date', () => {
    const { context, fonts } = recordingContext();
    const portrait = buildFrameLayout('portrait');
    const date = '23 marca 2026';
    const rightCaption = 'x'.repeat(200);

    paintFrame(context, image, 2000, 4000, portrait, 0.5, 0.5, 1, date, rightCaption);

    const besideDate = portrait.photo.width - date.length * 8 - Math.round(mmToPx(captionGapMm));
    const rightScale = captionFontScale(rightCaption.length * 8, besideDate);

    expect(rightScale).toBeLessThan(1);
    expect(fonts[1]).toBe(`400 ${portrait.captionFontSizePx * rightScale}px Geist, sans-serif`);
  });

  it('uses a tighter crop when the photo is zoomed in', () => {
    const fitted = recordingContext();
    const zoomed = recordingContext();

    paintFrame(fitted.context, image, 4000, 2000, layout, 0.5, 0.5, 1, '', '');
    paintFrame(zoomed.context, image, 4000, 2000, layout, 0.5, 0.5, 2, '', '');

    expect(zoomed.crops[0][2]).toBeLessThan(fitted.crops[0][2]);
    expect(zoomed.crops[0][3]).toBeLessThan(fitted.crops[0][3]);
  });
});

function unused() {
  return undefined;
}

function recordingContext() {
  const captions: { text: string; x: number; y: number; align: CanvasTextAlign }[] = [];
  const fonts: string[] = [];
  const crops: number[][] = [];
  const context = {
    fillStyle: '',
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    textAlign: 'start' as CanvasTextAlign,
    font: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
    clearRect: unused,
    fillRect: unused,
    save: unused,
    restore: unused,
    beginPath: unused,
    rect: unused,
    clip: unused,
    measureText(text: string) {
      return { width: text.length * 8 };
    },
    fillText(text: string, x: number, y: number) {
      captions.push({ text, x, y, align: context.textAlign });
      fonts.push(context.font);
    },
    drawImage(_image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) {
      crops.push([sx, sy, sw, sh]);
    },
  };

  return { context: context as unknown as CanvasRenderingContext2D, captions, fonts, crops };
}
