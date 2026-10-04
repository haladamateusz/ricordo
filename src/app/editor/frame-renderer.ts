import { longestCaptionDate } from './date-picker';
import {
  captionFontScale,
  captionGapMm,
  coverCrop,
  mmToPx,
  type FrameLayout,
} from './frame-layout';

const CAPTION_FONT_FAMILY = 'Geist, sans-serif';

export function paintFrame(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  layout: FrameLayout,
  panX: number,
  panY: number,
  zoom: number,
  leftCaption: string,
  rightCaption: string,
): void {
  const { canvas, photo, borderOuter } = layout;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(borderOuter.x, borderOuter.y, borderOuter.width, borderOuter.height);

  const crop = coverCrop(imageWidth, imageHeight, photo.width, photo.height, panX, panY, zoom);
  if (crop.sw > 0 && crop.sh > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(photo.x, photo.y, photo.width, photo.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      image,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      photo.x,
      photo.y,
      photo.width,
      photo.height,
    );
    ctx.restore();
  }

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${layout.captionFontSizePx}px ${CAPTION_FONT_FAMILY}`;
  const dateSlot = Math.ceil(ctx.measureText(longestCaptionDate).width);
  const captionGap = Math.round(mmToPx(captionGapMm));
  const rightCaptionMaxWidth = Math.max(0, photo.width - dateSlot - captionGap);
  paintCaption(
    ctx,
    leftCaption,
    layout.captionFontSizePx,
    dateSlot,
    'left',
    layout.leftCaptionX,
    layout.captionCenterY,
  );
  paintCaption(
    ctx,
    rightCaption,
    layout.captionFontSizePx,
    rightCaptionMaxWidth,
    'right',
    layout.rightCaptionX,
    layout.captionCenterY,
  );
}

function paintCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  maxWidth: number,
  align: CanvasTextAlign,
  x: number,
  y: number,
): void {
  if (text.trim() === '') {
    return;
  }

  ctx.font = `400 ${fontSize}px ${CAPTION_FONT_FAMILY}`;
  const scale = captionFontScale(ctx.measureText(text).width, maxWidth);
  ctx.font = `400 ${fontSize * scale}px ${CAPTION_FONT_FAMILY}`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}
