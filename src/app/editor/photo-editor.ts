import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { disabled, form, FormField } from '@angular/forms/signals';

import { CurrentSession, type CurrentEdit } from './current-session';
import { DatePicker, formatCaptionDate } from './date-picker';
import { EditHistory, type StoredEdit, type StoredFileHandle } from './edit-history';
import { EditHistoryList } from './edit-history-list';
import { HEIC_DECODER } from './heic-image';
import { isAcceptedPhoto, isHeic, readCreatedDate } from './photo-created-date';
import {
  PHOTO_FILE_PICKER,
  filesFromDrop,
  hasFileSystemPicker,
  pickPhotoFiles,
} from './photo-file-picker';
import { originalPng, thumbnailBlob } from './photo-thumbnail';

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
  handle: StoredFileHandle | null;
}

interface Pan {
  x: number;
  y: number;
}

interface IncomingPhoto {
  kind: 'photo';
  image: HTMLImageElement;
  fileName: string;
  objectUrl: string;
  handle: StoredFileHandle | null;
  date: string;
}

interface IncomingFailure {
  kind: 'failure';
  heic: boolean;
  date: string | null;
}

interface RestoredEdit {
  left: string;
  right: string;
  panX: number;
  panY: number;
  zoom: number;
}

interface LoadingRunner {
  rect: SVGRectElement;
  dash: number;
  gap: number;
  lap: number;
}

const CENTER_PAN: Pan = { x: 0.5, y: 0.5 };
const RUNNER_BAND_COUNT = 12;
const loadingRunnerBands = Array.from({ length: RUNNER_BAND_COUNT }, (_, index) => ({
  fraction: (RUNNER_BAND_COUNT - index) / RUNNER_BAND_COUNT,
  shift: index / RUNNER_BAND_COUNT,
  opacity: 1 / (RUNNER_BAND_COUNT - index),
}));
const loadingRunnerLines = [{ phase: 0 }, { phase: 0.5 }];
const KEY_NUDGE_PX = 20;
const ZOOM_WHEEL_GAIN = 0.002;
const currentEditSaveDelay = 1000;

@Component({
  selector: 'app-photo-editor',
  imports: [FormField, DatePicker, EditHistoryList],
  templateUrl: './photo-editor.html',
  styleUrl: './photo-editor.css',
  providers: [CurrentSession],
})
export class PhotoEditor {
  private readonly destroyRef = inject(DestroyRef);
  private readonly decodeHeic = inject(HEIC_DECODER);
  private readonly pickPhoto = inject(PHOTO_FILE_PICKER);
  private readonly history = inject(EditHistory);
  private readonly session = inject(CurrentSession);
  private committedKey = '';
  private replaceOnNextLoad = false;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('preview');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly editList = viewChild(EditHistoryList);
  private dragOrigin: { x: number; y: number; pan: Pan } | null = null;
  private loadId = 0;
  private runnerObserver: ResizeObserver | null = null;

  protected readonly photo = signal<LoadedPhoto | null>(null);
  protected readonly pan = signal<Pan>(CENTER_PAN);
  protected readonly zoom = signal(1);
  protected readonly dragging = signal(false);
  protected readonly dragOver = signal(false);
  protected readonly currentDragOver = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly pendingMessage = signal('');
  protected readonly loadingCount = signal(0);
  private batchId = 0;
  protected readonly fontReady = signal(false);
  protected readonly captionModel = signal({ left: '', right: '' });
  protected readonly captionForm = form(this.captionModel, (schema) => {
    const noCurrentEdits = () => this.session.edits().length === 0;
    disabled(schema.left, noCurrentEdits);
    disabled(schema.right, noCurrentEdits);
  });

  protected readonly hasCurrentEdits = computed(() => this.session.edits().length > 0);
  private readonly loadingDone = signal(0);
  protected readonly loadingLabel = computed(() => {
    const total = this.loadingCount();
    const word = total === 1 ? 'Loading image' : 'Loading images';
    return `${word} (${this.loadingDone()}/${total})`;
  });
  protected readonly runnerBands = loadingRunnerBands;
  protected readonly runnerLines = loadingRunnerLines;

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
      this.runnerObserver?.disconnect();
      this.session.release();
      this.revokePhoto();
    });

    effect((onCleanup) => {
      const photo = this.photo();
      const id = this.session.activeId();
      const key = this.draftKey();
      if (!photo || !id || key === this.committedKey) {
        return;
      }

      const timer = setTimeout(() => {
        this.saveActiveEdit();
      }, currentEditSaveDelay);
      onCleanup(() => clearTimeout(timer));
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

    afterRenderEffect({
      earlyRead: () => {
        this.runnerObserver?.disconnect();
        this.runnerObserver = null;
        return this.loadingCount() > 0 ? this.measureLoadingRunners() : [];
      },
      write: (measures) => {
        const runners = measures();
        this.applyLoadingRunners(runners);
        if (runners.length === 0 || typeof ResizeObserver === 'undefined') {
          return;
        }

        this.runnerObserver = new ResizeObserver(() => {
          this.applyLoadingRunners(this.measureLoadingRunners());
        });
        for (const picker of this.host.nativeElement.querySelectorAll<HTMLElement>(
          '.picker.is-loading',
        )) {
          this.runnerObserver.observe(picker);
        }
      },
    });
  }

  private measureLoadingRunners(): LoadingRunner[] {
    const dashCap = (this.longRunner() ? 16 : 7) * this.rootFontSize();
    const runners: LoadingRunner[] = [];
    for (const rect of this.host.nativeElement.querySelectorAll<SVGRectElement>(
      '.picker-runner rect',
    )) {
      const box = this.runnerBox(rect);
      if (box.width < 1 || box.height < 1) {
        continue;
      }

      const radius = Math.min(this.runnerRadius(), box.width / 2, box.height / 2);
      const lap = 2 * (box.width + box.height) + 2 * radius * (Math.PI - 4);
      const dash = Math.min(dashCap, lap * 0.34);
      runners.push({ rect, dash, gap: lap - dash, lap });
    }
    return runners;
  }

  private applyLoadingRunners(runners: readonly LoadingRunner[]): void {
    for (const { rect, dash, gap, lap } of runners) {
      rect.style.setProperty('--runner-dash', `${dash}px`);
      rect.style.setProperty('--runner-gap', `${gap}px`);
      rect.style.setProperty('--runner-lap', `${lap}px`);
    }
  }

  private runnerBox(rect: SVGRectElement): DOMRect {
    try {
      const box = rect.getBBox();
      if (box.width > 0 && box.height > 0) {
        return box;
      }
    } catch {
      // jsdom does not implement SVG geometry.
    }
    return rect.getBoundingClientRect();
  }

  private runnerRadius(): number {
    return Math.max(0.7 * this.rootFontSize() - 0.5, 0);
  }

  private rootFontSize(): number {
    const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(size) ? size : 16;
  }

  private longRunner(): boolean {
    return window.matchMedia('(min-width: 641px)').matches;
  }

  protected openPicker(): void {
    this.launchPicker(false);
  }

  protected replacePhoto(): void {
    this.launchPicker(true);
  }

  protected onFileSelected(event: Event): void {
    const replace = this.replaceOnNextLoad;
    this.replaceOnNextLoad = false;
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (replace) {
      const file = files[0];
      if (file) {
        void this.loadFile(file, null, null, true);
      }
      return;
    }
    void this.loadIncoming(files.map((file) => ({ file, handle: null })));
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
    void this.loadDrop(event.dataTransfer);
  }

  protected onCurrentDragOver(event: DragEvent): void {
    event.preventDefault();
    this.currentDragOver.set(true);
  }

  protected onCurrentDragLeave(event: DragEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as Node).contains(next)) {
      return;
    }
    this.currentDragOver.set(false);
  }

  protected onCurrentDrop(event: DragEvent): void {
    event.preventDefault();
    this.currentDragOver.set(false);
    void this.loadDrop(event.dataTransfer);
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
    this.dragging.set(false);
    this.dragOrigin = null;
    const next = this.session.discard(this.session.activeId() ?? '');
    if (!next) {
      this.photo.set(null);
      this.pan.set(CENTER_PAN);
      this.zoom.set(1);
      this.captionModel.set({ left: '', right: '' });
      this.committedKey = this.draftKey();
      this.errorMessage.set('');
      this.pendingMessage.set('');
      return;
    }

    this.openCurrentEdit(next);
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

    const saveHistory = () => {
      const rightCaption = this.captionModel().right;
      const date = this.captionModel().left;
      const pan = this.pan();
      const zoom = this.zoom();
      const frame = this.layout().photo;
      void Promise.all([
        originalPng(photo.image),
        thumbnailBlob(photo.image, frame.width, frame.height, pan.x, pan.y, zoom),
      ]).then(([image, thumbnail]) =>
        this.history.record({
          fileName: photo.fileName,
          rightCaption,
          date,
          thumbnail,
          image,
          handle: photo.handle,
          panX: pan.x,
          panY: pan.y,
          zoom,
        }),
      );
    };

    const file = new File([blob], fileName, { type: 'image/png' });
    if (canSaveToGallery(file)) {
      void navigator.share({ files: [file] }).then(
        () => {
          saveHistory();
        },
        (error: unknown) => {
          if (!isShareAbort(error)) {
            downloadFile(blob, fileName);
            saveHistory();
          }
        },
      );
      return;
    }

    downloadFile(blob, fileName);
    saveHistory();
  }

  protected openPastEdit(edit: StoredEdit): void {
    void this.restoreEdit(edit);
  }

  protected openCurrentEdit(edit: CurrentEdit): void {
    this.errorMessage.set('');
    this.pendingMessage.set('');
    this.session.activate(edit.id);
    this.photo.set({
      image: edit.image,
      fileName: edit.fileName,
      objectUrl: edit.objectUrl,
      handle: edit.handle,
    });
    this.pan.set({ x: edit.panX, y: edit.panY });
    this.zoom.set(edit.zoom);
    this.captionModel.set({ left: edit.date, right: edit.rightCaption });
    this.committedKey = this.draftKey();
  }

  private async restoreEdit(edit: StoredEdit): Promise<void> {
    let image: Blob | undefined;
    try {
      image = await this.history.image(edit.id);
    } catch {
      image = undefined;
    }

    if (!image) {
      this.errorMessage.set('That saved photo could not be opened.');
      return;
    }

    const file = new File([image], edit.fileName, { type: 'image/png' });
    await this.loadFile(file, null, {
      left: edit.date,
      right: edit.rightCaption,
      panX: edit.panX,
      panY: edit.panY,
      zoom: edit.zoom,
    });
  }

  private launchPicker(replace: boolean): void {
    this.replaceOnNextLoad = replace;
    const input = this.fileInput()?.nativeElement;
    if (input) {
      input.multiple = !replace;
    }
    if (this.pickPhoto === pickPhotoFiles && !hasFileSystemPicker()) {
      input?.click();
      return;
    }
    void this.pickFromDisk();
  }

  private async pickFromDisk(): Promise<void> {
    const replace = this.replaceOnNextLoad;
    const picked = await this.pickPhoto(!replace);
    if (picked === 'fallback') {
      this.fileInput()?.nativeElement.click();
      return;
    }
    this.replaceOnNextLoad = false;
    if (!picked || picked.length === 0) {
      return;
    }
    if (replace) {
      const [first] = picked;
      if (first) {
        await this.loadFile(first.file, first.handle, null, true);
      }
      return;
    }
    await this.loadIncoming(picked);
  }

  private async loadDrop(dataTransfer: DataTransfer | null): Promise<void> {
    const picked = await filesFromDrop(dataTransfer);
    await this.loadIncoming(
      picked.map((item) => (item instanceof File ? { file: item, handle: null } : item)),
    );
  }

  private async loadIncoming(
    picked: readonly { file: File; handle: StoredFileHandle | null }[],
  ): Promise<void> {
    const accepted = picked.filter((item) => isAcceptedPhoto(item.file));
    if (picked.length > 0 && accepted.length === 0) {
      this.pendingMessage.set('');
      this.errorMessage.set('Please choose a JPEG, PNG, WebP, or HEIC image.');
      return;
    }

    const batchId = ++this.batchId;
    this.loadingDone.set(0);
    this.loadingCount.set(accepted.length);
    this.pendingMessage.set('');
    this.errorMessage.set('');
    const drafts: IncomingPhoto[] = [];
    let failedHeicDate: string | null | undefined;

    for (const item of accepted) {
      const result = await this.readIncoming(item.file, item.handle, batchId);
      if (batchId !== this.batchId) {
        this.revokeIncoming(drafts);
        if (result?.kind === 'photo') {
          URL.revokeObjectURL(result.objectUrl);
        }
        return;
      }
      this.loadingDone.update((count) => count + 1);
      if (!result) {
        continue;
      }
      if (result.kind === 'photo') {
        drafts.push(result);
        continue;
      }
      if (result.heic) {
        failedHeicDate = result.date;
      }
      this.errorMessage.set(incomingError(result, false));
    }

    if (batchId !== this.batchId) {
      this.revokeIncoming(drafts);
      return;
    }

    this.loadingCount.set(0);
    if (drafts.length === 0) {
      if (failedHeicDate !== undefined && this.photo() === null) {
        this.captionModel.update((current) => ({ ...current, right: '' }));
        this.useCreatedDate(failedHeicDate, this.loadId);
        this.errorMessage.set(
          incomingError({ kind: 'failure', heic: true, date: failedHeicDate }, true),
        );
      }
      return;
    }

    for (const draft of drafts) {
      this.applyIncoming(draft);
    }
    this.editList()?.showCurrent();
  }

  private async readIncoming(
    file: File,
    handle: StoredFileHandle | null,
    batchId: number,
  ): Promise<IncomingPhoto | IncomingFailure | null> {
    const createdDate = readCreatedDate(file);
    try {
      const display = await this.openDisplayImage(file, () => undefined);
      if (batchId !== this.batchId) {
        URL.revokeObjectURL(display.objectUrl);
        return null;
      }
      const date = (await createdDate) ?? '';
      if (batchId !== this.batchId) {
        URL.revokeObjectURL(display.objectUrl);
        return null;
      }
      return {
        kind: 'photo',
        image: display.image,
        fileName: file.name,
        objectUrl: display.objectUrl,
        handle,
        date,
      };
    } catch {
      if (batchId !== this.batchId) {
        return null;
      }
      if (!isHeic(file)) {
        return { kind: 'failure', heic: false, date: null };
      }
      const date = await createdDate;
      if (batchId !== this.batchId) {
        return null;
      }
      return { kind: 'failure', heic: true, date };
    }
  }

  private applyIncoming(draft: IncomingPhoto): void {
    this.revokePhoto();
    this.photo.set({
      image: draft.image,
      fileName: draft.fileName,
      objectUrl: draft.objectUrl,
      handle: draft.handle,
    });
    this.pan.set(CENTER_PAN);
    this.zoom.set(1);
    this.captionModel.set({ left: draft.date, right: '' });
    this.startCurrentEdit();
  }

  private revokeIncoming(drafts: readonly IncomingPhoto[]): void {
    for (const draft of drafts) {
      if (!this.session.holds(draft.objectUrl)) {
        URL.revokeObjectURL(draft.objectUrl);
      }
    }
  }

  private async loadFile(
    file: File,
    handle: StoredFileHandle | null = null,
    restored: RestoredEdit | null = null,
    replace = false,
  ): Promise<void> {
    if (!isAcceptedPhoto(file)) {
      this.pendingMessage.set('');
      this.errorMessage.set('Please choose a JPEG, PNG, WebP, or HEIC image.');
      return;
    }

    const loadId = ++this.loadId;
    this.batchId += 1;
    this.loadingDone.set(0);
    this.loadingCount.set(restored ? 0 : 1);
    this.pendingMessage.set('');
    this.errorMessage.set('');
    const createdDate = readCreatedDate(file);
    try {
      const display = await this.openDisplayImage(file, () => {
        if (loadId === this.loadId) {
          this.loadingCount.set(1);
        }
      });
      const date = restored ? null : await createdDate;
      if (loadId !== this.loadId) {
        URL.revokeObjectURL(display.objectUrl);
        return;
      }

      this.revokePhoto();
      this.photo.set({
        image: display.image,
        fileName: file.name,
        objectUrl: display.objectUrl,
        handle,
      });
      this.pendingMessage.set('');
      this.errorMessage.set('');
      this.loadingCount.set(0);
      if (restored && loadId === this.loadId) {
        this.pan.set({ x: restored.panX, y: restored.panY });
        this.zoom.set(restored.zoom);
        this.captionModel.set({ left: restored.left, right: restored.right });
        this.startCurrentEdit();
        return;
      }
      this.pan.set(CENTER_PAN);
      this.zoom.set(1);
      this.captionModel.set({ left: date ?? '', right: '' });
      if (!(replace && this.replaceCurrentEdit())) {
        this.startCurrentEdit();
      }
      this.editList()?.showCurrent();
    } catch {
      if (loadId !== this.loadId) {
        return;
      }

      this.loadingCount.set(0);
      this.pendingMessage.set('');
      if (isHeic(file)) {
        const date = await createdDate;
        if (loadId !== this.loadId) {
          return;
        }

        if (this.photo() === null) {
          this.captionModel.update((current) => ({ ...current, right: '' }));
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

  private startCurrentEdit(): void {
    const photo = this.photo();
    if (!photo) {
      return;
    }

    const captions = this.captionModel();
    const pan = this.pan();
    const zoom = this.zoom();
    const id = this.session.begin({
      fileName: photo.fileName,
      rightCaption: captions.right,
      date: captions.left,
      panX: pan.x,
      panY: pan.y,
      zoom,
      image: photo.image,
      objectUrl: photo.objectUrl,
      handle: photo.handle,
    });
    this.committedKey = this.draftKey();
    void this.refreshThumbnail(id, pan.x, pan.y, zoom);
  }

  private replaceCurrentEdit(): boolean {
    const id = this.session.activeId();
    const photo = this.photo();
    if (!id || !photo) {
      return false;
    }

    const captions = this.captionModel();
    const pan = this.pan();
    const zoom = this.zoom();
    const replaced = this.session.replacePhoto(id, {
      fileName: photo.fileName,
      rightCaption: captions.right,
      date: captions.left,
      panX: pan.x,
      panY: pan.y,
      zoom,
      image: photo.image,
      objectUrl: photo.objectUrl,
      handle: photo.handle,
    });
    if (!replaced) {
      return false;
    }

    this.committedKey = this.draftKey();
    void this.refreshThumbnail(id, pan.x, pan.y, zoom);
    return true;
  }

  private saveActiveEdit(): void {
    const id = this.session.activeId();
    const photo = this.photo();
    if (!id || !photo) {
      return;
    }

    const captions = this.captionModel();
    const pan = this.pan();
    const zoom = this.zoom();
    this.session.write(id, {
      rightCaption: captions.right,
      date: captions.left,
      panX: pan.x,
      panY: pan.y,
      zoom,
    });
    this.committedKey = this.draftKey();
    void this.refreshThumbnail(id, pan.x, pan.y, zoom);
  }

  private async refreshThumbnail(
    id: string,
    panX: number,
    panY: number,
    zoom: number,
  ): Promise<void> {
    const edit = this.session.find(id);
    if (!edit) {
      return;
    }

    const frame = buildFrameLayout(
      orientationOf(edit.image.naturalWidth, edit.image.naturalHeight),
    ).photo;
    const blob = await thumbnailBlob(edit.image, frame.width, frame.height, panX, panY, zoom);
    const latest = this.session.find(id);
    if (!blob || !latest || latest.panX !== panX || latest.panY !== panY || latest.zoom !== zoom) {
      return;
    }

    this.session.setThumbnail(id, URL.createObjectURL(blob));
  }

  private draftKey(): string {
    const captions = this.captionModel();
    const pan = this.pan();
    return [
      this.session.activeId() ?? '',
      captions.left,
      captions.right,
      String(pan.x),
      String(pan.y),
      String(this.zoom()),
    ].join('\u0000');
  }

  private useCreatedDate(isoDate: string | null, loadId: number): void {
    if (loadId !== this.loadId) {
      return;
    }

    const date = isoDate ?? '';
    if (this.captionModel().left === date) {
      return;
    }

    this.captionModel.update((current) => ({ ...current, left: date }));
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
    if (photo && !this.session.holds(photo.objectUrl)) {
      URL.revokeObjectURL(photo.objectUrl);
    }
  }
}

function incomingError(failure: IncomingFailure, noPhoto: boolean): string {
  if (!failure.heic) {
    return 'That file could not be opened. Please choose a JPEG, PNG, WebP, or HEIC image.';
  }
  if (noPhoto && failure.date) {
    return 'This browser cannot display HEIC photos. The created date was filled in from the file.';
  }
  return 'This browser cannot display HEIC photos.';
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
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
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
