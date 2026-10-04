const EXPORT_DPI = 300;
const CARD_LONG_MM = 150;
const CARD_SHORT_MM = 100;
const BORDER_MM = 0.6;
const PAD_TOP_MM = 10 / 3;
const PAD_SIDE_MM = 10 / 3;
const PAD_BOTTOM_MM = 28 / 3;
const CAPTION_SIZE_MM = 3.5;
export const captionGapMm = 4;
/**
 * Edge the CEWE Fotojoker exposure mask can leave unprinted.
 * https://www.cewe.pl/FAQ.html
 */
export const bleedMm = 4;

export type Orientation = 'landscape' | 'portrait';

interface FrameSpec {
  orientation: Orientation;
  cardWidthMm: number;
  cardHeightMm: number;
  borderMm: number;
  padTopMm: number;
  padSideMm: number;
  padBottomMm: number;
  captionSizeMm: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameLayout {
  canvas: { width: number; height: number };
  trim: Rect;
  photo: Rect;
  borderOuter: Rect;
  borderWidthPx: number;
  captionFontSizePx: number;
  captionCenterY: number;
  leftCaptionX: number;
  rightCaptionX: number;
}

export interface CoverCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface CoverSlack {
  scale: number;
  maxPanX: number;
  maxPanY: number;
}

export function mmToPx(mm: number, dpi = EXPORT_DPI): number {
  return (mm / 25.4) * dpi;
}

export function orientationOf(width: number, height: number): Orientation {
  return width >= height ? 'landscape' : 'portrait';
}

function frameSpec(orientation: Orientation): FrameSpec {
  const landscape = orientation === 'landscape';
  return {
    orientation,
    cardWidthMm: landscape ? CARD_LONG_MM : CARD_SHORT_MM,
    cardHeightMm: landscape ? CARD_SHORT_MM : CARD_LONG_MM,
    borderMm: BORDER_MM,
    padTopMm: PAD_TOP_MM,
    padSideMm: PAD_SIDE_MM,
    padBottomMm: PAD_BOTTOM_MM,
    captionSizeMm: CAPTION_SIZE_MM,
  };
}

export function clampUnit(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function buildFrameLayout(orientation: Orientation, dpi = EXPORT_DPI): FrameLayout {
  const spec = frameSpec(orientation);
  const bleed = Math.round(mmToPx(bleedMm, dpi));
  const padSide = bleed + Math.round(mmToPx(spec.padSideMm, dpi));
  const padTop = bleed + Math.round(mmToPx(spec.padTopMm, dpi));
  const padBottom = bleed + Math.round(mmToPx(spec.padBottomMm, dpi));
  const border = Math.round(mmToPx(spec.borderMm, dpi));
  const canvasWidth = Math.round(mmToPx(spec.cardWidthMm, dpi));
  const canvasHeight = Math.round(mmToPx(spec.cardHeightMm, dpi));
  const photoWidth = canvasWidth - padSide * 2 - border * 2;
  const photoHeight = canvasHeight - padTop - padBottom - border * 2;
  const photo: Rect = {
    x: padSide + border,
    y: padTop + border,
    width: photoWidth,
    height: photoHeight,
  };
  const borderOuter: Rect = {
    x: padSide,
    y: padTop,
    width: photoWidth + border * 2,
    height: photoHeight + border * 2,
  };
  const bandTop = borderOuter.y + borderOuter.height;
  const trim: Rect = {
    x: bleed,
    y: bleed,
    width: canvasWidth - bleed * 2,
    height: canvasHeight - bleed * 2,
  };

  return {
    canvas: { width: canvasWidth, height: canvasHeight },
    trim,
    photo,
    borderOuter,
    borderWidthPx: border,
    captionFontSizePx: Math.round(mmToPx(spec.captionSizeMm, dpi)),
    captionCenterY: bandTop + Math.round((trim.y + trim.height - bandTop) / 2),
    leftCaptionX: photo.x,
    rightCaptionX: photo.x + photo.width,
  };
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < MIN_ZOOM) {
    return MIN_ZOOM;
  }
  if (zoom > MAX_ZOOM) {
    return MAX_ZOOM;
  }
  return zoom;
}

export function coverSlack(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom = MIN_ZOOM,
): CoverSlack {
  if (imageWidth <= 0 || imageHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { scale: 1, maxPanX: 0, maxPanY: 0 };
  }

  const coverScale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  const scale = coverScale * clampZoom(zoom);
  return {
    scale,
    maxPanX: Math.max(0, imageWidth * scale - frameWidth),
    maxPanY: Math.max(0, imageHeight * scale - frameHeight),
  };
}

export function coverCrop(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  panX: number,
  panY: number,
  zoom = MIN_ZOOM,
): CoverCrop {
  const slack = coverSlack(imageWidth, imageHeight, frameWidth, frameHeight, zoom);
  if (imageWidth <= 0 || imageHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  const sw = frameWidth / slack.scale;
  const sh = frameHeight / slack.scale;
  return {
    sx: (slack.maxPanX * clampUnit(panX)) / slack.scale,
    sy: (slack.maxPanY * clampUnit(panY)) / slack.scale,
    sw,
    sh,
  };
}

export function zoomCover(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  panX: number,
  panY: number,
  zoom: number,
  focalX: number,
  focalY: number,
  nextZoom: number,
): { zoom: number; panX: number; panY: number } {
  const currentZoom = clampZoom(zoom);
  const targetZoom = clampZoom(nextZoom);
  const current = coverSlack(imageWidth, imageHeight, frameWidth, frameHeight, currentZoom);
  const upcoming = coverSlack(imageWidth, imageHeight, frameWidth, frameHeight, targetZoom);
  const focusX = Math.min(Math.max(focalX, 0), frameWidth);
  const focusY = Math.min(Math.max(focalY, 0), frameHeight);
  const sourceX =
    current.scale === 0 ? 0 : (clampUnit(panX) * current.maxPanX + focusX) / current.scale;
  const sourceY =
    current.scale === 0 ? 0 : (clampUnit(panY) * current.maxPanY + focusY) / current.scale;
  const offsetX = sourceX * upcoming.scale - focusX;
  const offsetY = sourceY * upcoming.scale - focusY;

  return {
    zoom: targetZoom,
    panX: upcoming.maxPanX === 0 ? 0.5 : clampUnit(offsetX / upcoming.maxPanX),
    panY: upcoming.maxPanY === 0 ? 0.5 : clampUnit(offsetY / upcoming.maxPanY),
  };
}

export function captionFontScale(measuredWidth: number, maxWidth: number): number {
  if (measuredWidth <= 0 || maxWidth <= 0 || measuredWidth <= maxWidth) {
    return 1;
  }
  return maxWidth / measuredWidth;
}
