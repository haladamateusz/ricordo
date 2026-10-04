import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';

import { DatePicker, formatCaptionDate } from './date-picker';
import { HEIC_DECODER } from './heic-image';
import { isAcceptedPhoto, isHeic, readCreatedDate } from './photo-created-date';

import {
  buildFrameLayout,
  clampUnit,
  coverSlack,
  orientationOf,
  zoomCover,
  type Orientation,
} from './frame-layout';
import { paintFrame } from './frame-renderer';

interface LoadedPhoto {
  image: HTMLImageElement;
  fileName: string;
  objectUrl: string;
}

interface Pan {
  x: number;
  y: number;
}

const CENTER_PAN: Pan = { x: 0.5, y: 0.5 };
const KEY_NUDGE_PX = 20;
const ZOOM_WHEEL_GAIN = 0.002;

@Component({
  selector: 'app-photo-editor',
  imports: [FormField, DatePicker],
  templateUrl: './photo-editor.html',
  styleUrl: './photo-editor.css',
})
export class PhotoEditor {
  private readonly destroyRef = inject(DestroyRef);
  private readonly decodeHeic = inject(HEIC_DECODER);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('preview');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private dragOrigin: { x: number; y: number; pan: Pan } | null = null;
  private loadId = 0;

  protected readonly photo = signal<LoadedPhoto | null>(null);
  protected readonly pan = signal<Pan>(CENTER_PAN);
  protected readonly zoom = signal(1);
  protected readonly dragging = signal(false);
  protected readonly dragOver = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly pendingMessage = signal('');
  protected readonly fontReady = signal(false);
  protected readonly captionModel = signal({ left: '', right: '' });
  protected readonly captionForm = form(this.captionModel);

  protected readonly orientation = computed<Orientation>(() => {
    const photo = this.photo();
    if (!photo) {
      return 'landscape';
    }
    return orientationOf(photo.image.naturalWidth, photo.image.naturalHeight);
  });

  protected readonly layout = computed(() => buildFrameLayout(this.orientation()));

  protected readonly frameAspect = computed(() => {
    const { width, height } = this.layout().trim;
    return `${width} / ${height}`;
  });

  protected readonly stageLabel = computed(() => {
    const fileName = this.photo()?.fileName ?? 'photo';
    return `Framed photo, ${fileName}. Drag or use arrow keys to reposition. Scroll to scale.`;
  });

  protected readonly frameRatio = computed(() => {
    const { width, height } = this.layout().trim;
    return width / height;
  });

  protected readonly canvasFrame = computed(() => {
    const { canvas, trim } = this.layout();
    return {
      left: (-trim.x / trim.width) * 100,
      top: (-trim.y / trim.height) * 100,
      width: (canvas.width / trim.width) * 100,
      height: (canvas.height / trim.height) * 100,
    };
  });

  protected readonly photoBox = computed(() => {
    const layout = this.layout();
    const { trim } = layout;
    return {
      x: ((layout.photo.x - trim.x) / trim.width) * 100,
      y: ((layout.photo.y - trim.y) / trim.height) * 100,
      width: (layout.photo.width / trim.width) * 100,
      height: (layout.photo.height / trim.height) * 100,
    };
  });

  constructor() {
    if (document.fonts?.load) {
      void document.fonts.load('400 16px Geist').then(() => {
        this.fontReady.set(true);
      });
    }

    this.destroyRef.onDestroy(() => {
      this.revokePhoto();
    });

    afterRenderEffect({
      write: () => {
        const photo = this.photo();
        const pan = this.pan();
        const zoom = this.zoom();
        const captions = this.captionModel();
        const layout = this.layout();
        this.fontReady();
        const canvas = this.canvas()?.nativeElement;
        if (!canvas || !photo) {
          return;
        }

        canvas.width = Math.round(layout.canvas.width);
        canvas.height = Math.round(layout.canvas.height);
        const context = canvas.getContext('2d');
        if (!context) {
          return;
        }

        paintFrame(
          context,
          photo.image,
          photo.image.naturalWidth,
          photo.image.naturalHeight,
          layout,
          pan.x,
          pan.y,
          zoom,
          captions.left ? formatCaptionDate(captions.left) : '',
          captions.right,
        );
      },
    });
  }

  protected openPicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.loadFile(file);
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as Node).contains(next)) {
      return;
    }
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) {
      void this.loadFile(file);
    }
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('button')) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragOrigin = { x: event.clientX, y: event.clientY, pan: this.pan() };
    this.dragging.set(true);
  }

  protected onPointerMove(event: PointerEvent): void {
    const origin = this.dragOrigin;
    const photo = this.photo();
    const canvas = this.canvas()?.nativeElement;
    if (!origin || !photo || !canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }

    const layout = this.layout();
    const pixelsPerScreen = layout.canvas.width / rect.width;
    const dx = (event.clientX - origin.x) * pixelsPerScreen;
    const dy = (event.clientY - origin.y) * pixelsPerScreen;
    const slack = coverSlack(
      photo.image.naturalWidth,
      photo.image.naturalHeight,
      layout.photo.width,
      layout.photo.height,
      this.zoom(),
    );
    this.pan.set({
      x: slack.maxPanX === 0 ? 0.5 : clampUnit(origin.pan.x - dx / slack.maxPanX),
      y: slack.maxPanY === 0 ? 0.5 : clampUnit(origin.pan.y - dy / slack.maxPanY),
    });
  }

  protected onPointerUp(): void {
    this.dragOrigin = null;
    this.dragging.set(false);
  }

  protected onWheel(event: WheelEvent): void {
    const photo = this.photo();
    if (!photo) {
      return;
    }

    event.preventDefault();
    const layout = this.layout();
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    const focalX = ((event.clientX - bounds.left) / bounds.width) * layout.photo.width;
    const focalY = ((event.clientY - bounds.top) / bounds.height) * layout.photo.height;
    const distance = wheelDistance(event);
    const next = zoomCover(
      photo.image.naturalWidth,
      photo.image.naturalHeight,
      layout.photo.width,
      layout.photo.height,
      this.pan().x,
      this.pan().y,
      this.zoom(),
      focalX,
      focalY,
      this.zoom() * Math.exp(-distance * ZOOM_WHEEL_GAIN),
    );
    this.zoom.set(next.zoom);
    this.pan.set({ x: next.panX, y: next.panY });
  }

  protected onPreviewKeydown(event: KeyboardEvent): void {
    const photo = this.photo();
    if (!photo) {
      return;
    }

    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowLeft') {
      dx = -1;
    } else if (event.key === 'ArrowRight') {
      dx = 1;
    } else if (event.key === 'ArrowUp') {
      dy = -1;
    } else if (event.key === 'ArrowDown') {
      dy = 1;
    } else {
      return;
    }

    event.preventDefault();
    const layout = this.layout();
    const slack = coverSlack(
      photo.image.naturalWidth,
      photo.image.naturalHeight,
      layout.photo.width,
      layout.photo.height,
      this.zoom(),
    );
    const current = this.pan();
    this.pan.set({
      x: slack.maxPanX === 0 ? 0.5 : clampUnit(current.x - (dx * KEY_NUDGE_PX) / slack.maxPanX),
      y: slack.maxPanY === 0 ? 0.5 : clampUnit(current.y - (dy * KEY_NUDGE_PX) / slack.maxPanY),
    });
  }

  protected removePhoto(): void {
    this.revokePhoto();
    this.photo.set(null);
    this.pan.set(CENTER_PAN);
    this.zoom.set(1);
    this.dragging.set(false);
    this.dragOrigin = null;
  }

  protected download(): void {
    const canvas = this.canvas()?.nativeElement;
    const photo = this.photo();
    if (!canvas || !photo) {
      return;
    }

    const baseName = photo.fileName.replace(/\.[^.]+$/, '') || 'photo';
    const fileName = `${baseName}-framed.png`;
    let blob: Blob;
    try {
      blob = blobFromDataUrl(canvas.toDataURL('image/png'));
    } catch {
      this.errorMessage.set('The framed photo could not be created.');
      return;
    }

    const file = new File([blob], fileName, { type: 'image/png' });
    if (canSaveToGallery(file)) {
      void navigator.share({ files: [file] }).catch((error: unknown) => {
        if (!isShareAbort(error)) {
          downloadFile(blob, fileName);
        }
      });
      return;
    }

    downloadFile(blob, fileName);
  }

  private async loadFile(file: File): Promise<void> {
    if (!isAcceptedPhoto(file)) {
      this.pendingMessage.set('');
      this.errorMessage.set('Please choose a JPEG, PNG, WebP, or HEIC image.');
      return;
    }

    const loadId = ++this.loadId;
    this.pendingMessage.set('');
    this.errorMessage.set('');
    const createdDate = readCreatedDate(file);
    try {
      const display = await this.openDisplayImage(file, () => {
        if (loadId === this.loadId) {
          this.pendingMessage.set('Opening HEIC photo…');
        }
      });
      if (loadId !== this.loadId) {
        URL.revokeObjectURL(display.objectUrl);
        return;
      }

      this.revokePhoto();
      this.photo.set({ image: display.image, fileName: file.name, objectUrl: display.objectUrl });
      this.pan.set(CENTER_PAN);
      this.zoom.set(1);
      this.pendingMessage.set('');
      this.errorMessage.set('');
      this.useCreatedDate(await createdDate, loadId);
    } catch {
      if (loadId !== this.loadId) {
        return;
      }

      this.pendingMessage.set('');
      if (isHeic(file)) {
        const date = await createdDate;
        if (loadId !== this.loadId) {
          return;
        }

        if (this.photo() === null) {
          this.useCreatedDate(date, loadId);
        }
        this.errorMessage.set(
          this.photo() === null && date
            ? 'This browser cannot display HEIC photos. The created date was filled in from the file.'
            : 'This browser cannot display HEIC photos.',
        );
        return;
      }

      this.errorMessage.set(
        'That file could not be opened. Please choose a JPEG, PNG, WebP, or HEIC image.',
      );
    }
  }

  private useCreatedDate(isoDate: string | null, loadId: number): void {
    if (!isoDate || loadId !== this.loadId) {
      return;
    }

    this.captionModel.update((current) => ({ ...current, left: isoDate }));
  }

  private async openDisplayImage(
    file: File,
    onConvert: () => void,
  ): Promise<{ image: HTMLImageElement; objectUrl: string }> {
    const objectUrl = URL.createObjectURL(file);
    try {
      return { image: await loadImage(objectUrl), objectUrl };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      if (!isHeic(file)) {
        throw error;
      }
    }

    onConvert();
    const jpeg = await this.decodeHeic(file);
    const convertedUrl = URL.createObjectURL(jpeg);
    try {
      return { image: await loadImage(convertedUrl), objectUrl: convertedUrl };
    } catch (error) {
      URL.revokeObjectURL(convertedUrl);
      throw error;
    }
  }

  private revokePhoto(): void {
    const photo = this.photo();
    if (photo) {
      URL.revokeObjectURL(photo.objectUrl);
    }
  }
}

function wheelDistance(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * 400;
  }
  return event.deltaY;
}

function canSaveToGallery(file: File): boolean {
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    typeof navigator.share === 'function' &&
    navigator.canShare?.({ files: [file] }) === true
  );
}

function isShareAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function blobFromDataUrl(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  if (!header || !data) {
    throw new Error('empty image');
  }
  const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/png';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode'));
    image.src = url;
  });
}
