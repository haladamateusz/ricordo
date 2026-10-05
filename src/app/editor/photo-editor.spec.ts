import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';

import {
  EDIT_IMAGE_DB,
  EDIT_LIST_DB,
  EditHistory,
  FILE_HANDLE_DB,
  type EditImageDb,
  type EditListDb,
  type EditRecord,
  type FileHandleDb,
  type StoredFileHandle,
} from './edit-history';
import { HEIC_DECODER } from './heic-image';
import { CurrentSession } from './current-session';
import { PhotoEditor } from './photo-editor';
import { heicWithExifDate, jpegWithExifDate } from './photo-exif-fixture';
import { PHOTO_FILE_PICKER, type PhotoSelection } from './photo-file-picker';

const decodeHeic = vi.fn<(file: Blob) => Promise<Blob>>();
const pickPhoto = vi.fn<(multiple: boolean) => Promise<PhotoSelection>>(async () => 'fallback');

describe('PhotoEditor', () => {
  let fixture: ComponentFixture<PhotoEditor>;
  let handles: MemoryHandles;
  let images: MemoryImages;
  let lists: MemoryEditList;

  beforeEach(async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('Image', FakeImage);

    decodeHeic.mockReset();
    decodeHeic.mockRejectedValue(new Error('decode'));
    pickPhoto.mockReset();
    pickPhoto.mockResolvedValue('fallback');
    handles = new MemoryHandles();
    images = new MemoryImages();
    lists = new MemoryEditList();

    await TestBed.configureTestingModule({
      imports: [PhotoEditor],
      providers: [
        { provide: HEIC_DECODER, useValue: decodeHeic },
        { provide: PHOTO_FILE_PICKER, useValue: pickPhoto },
        { provide: EDIT_LIST_DB, useValue: lists },
        { provide: FILE_HANDLE_DB, useValue: handles },
        { provide: EDIT_IMAGE_DB, useValue: images },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PhotoEditor);
    await fixture.whenStable();
  });

  afterEach(() => {
    FakeImage.failNext = false;
    FakeImage.hold = false;
    FakeImage.held = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects a file that is not a photo', async () => {
    chooseFile(fileInput(fixture), new File(['notes'], 'notes.txt', { type: 'text/plain' }));
    await fixture.whenStable();

    expect(text(fixture)).toContain('Please choose a JPEG, PNG, WebP, or HEIC image.');
    expect(text(fixture)).toContain('Choose a photo');
  });

  it('disables the date and caption until a current edit exists', async () => {
    const date = fixture.nativeElement.querySelector('#captionDate') as HTMLButtonElement;
    const caption = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;

    expect(date.disabled).toBe(true);
    expect(caption.disabled).toBe(true);

    await loadPortrait(fixture);

    expect(date.disabled).toBe(false);
    expect(caption.disabled).toBe(false);
  });

  it('shows the file name on the photo', async () => {
    await loadPortrait(fixture);

    const name = fixture.nativeElement.querySelector('.photo-name');
    expect(name?.textContent).toBe('dog.png');
  });

  it('opens Current edits and highlights the uploaded photo', async () => {
    stubElementBox();
    await loadPortrait(fixture);

    expect(button(fixture, 'Current edits').getAttribute('aria-selected')).toBe('true');
    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('#current-panel .history-open')).toBeTruthy();
    });
    const openRow = fixture.nativeElement.querySelector(
      '#current-panel .history-open',
    ) as HTMLButtonElement;
    expect(openRow.getAttribute('aria-current')).toBe('true');
  });

  it('fills the date from the photo capture date', async () => {
    chooseFile(
      fileInput(fixture),
      jpegWithExifDate('pier.jpg', [{ tag: 0x9003, value: '2024:06:15 10:30:00' }]),
    );

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('15 czerwca 2024');
    });
  });

  it('shows a HEIC photo the browser can decode directly', async () => {
    chooseFile(
      fileInput(fixture),
      heicWithExifDate('pier.heic', [{ tag: 0x9004, value: '2023:01:02 08:00:00' }]),
    );

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('2 stycznia 2023');
    });

    expect(decodeHeic).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('pier.heic');
    expect(text(fixture)).toContain('Remove');
  });

  it('converts a HEIC photo when the browser cannot decode it', async () => {
    decodeHeic.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    FakeImage.failNext = true;
    chooseFile(
      fileInput(fixture),
      heicWithExifDate('pier.heic', [{ tag: 0x9004, value: '2023:01:02 08:00:00' }]),
    );

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('2 stycznia 2023');
    });

    expect(decodeHeic).toHaveBeenCalledOnce();
    expect(text(fixture)).toContain('pier.heic');
    expect(text(fixture)).toContain('Remove');
    expect(text(fixture)).not.toContain('cannot display HEIC');
  });

  it('fills the date from a HEIC file this browser cannot display', async () => {
    FakeImage.failNext = true;
    chooseFile(
      fileInput(fixture),
      heicWithExifDate('pier.heic', [{ tag: 0x9004, value: '2023:01:02 08:00:00' }]),
    );

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('2 stycznia 2023');
    });
    expect(text(fixture)).toContain(
      'This browser cannot display HEIC photos. The created date was filled in from the file.',
    );
    expect(text(fixture)).toContain('Choose a photo');
  });

  it('keeps the current photo when a HEIC file cannot be displayed', async () => {
    await loadPortrait(fixture);
    state(fixture).captionModel.set({ left: '2026-09-12', right: '' });
    fixture.detectChanges();

    FakeImage.failNext = true;
    chooseFile(
      fileInput(fixture),
      heicWithExifDate('pier.heic', [{ tag: 0x9004, value: '2023:01:02 08:00:00' }]),
    );

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('This browser cannot display HEIC photos.');
    });

    expect(text(fixture)).toContain('12 września 2026');
    expect(text(fixture)).not.toContain('2 stycznia 2023');
    expect(text(fixture)).toContain('Remove');
  });

  it('clears the caption on upload and the date when the photo has no capture date', async () => {
    state(fixture).captionModel.set({ left: '2026-09-12', right: 'Cafe' });
    await loadPortrait(fixture);

    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    expect(captionInput.value).toBe('');
    expect(text(fixture)).not.toContain('12 września 2026');
    expect(currentSession(fixture).edits()[0]).toMatchObject({ rightCaption: '', date: '' });
  });

  it('clears the caption when the uploaded photo has a capture date', async () => {
    state(fixture).captionModel.set({ left: '2026-09-12', right: 'Cafe' });
    chooseFile(
      fileInput(fixture),
      jpegWithExifDate('pier.jpg', [{ tag: 0x9003, value: '2024:06:15 10:30:00' }]),
    );

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('15 czerwca 2024');
    });
    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    expect(captionInput.value).toBe('');
    expect(text(fixture)).not.toContain('12 września 2026');
  });

  it('returns to the empty editor when the last current edit is removed', async () => {
    await loadPortrait(fixture);
    state(fixture).captionModel.set({ left: '2026-09-12', right: 'Cafe' });
    fixture.detectChanges();

    button(fixture, 'Remove').click();
    await fixture.whenStable();

    expect(currentSession(fixture).edits()).toEqual([]);
    expect(state(fixture).photo()).toBeNull();
    expect(text(fixture)).toContain('Choose a photo');
    expect(text(fixture)).not.toContain('12 września 2026');
    expect(text(fixture)).toContain('No current edits');
    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    const dateButton = fixture.nativeElement.querySelector('#captionDate') as HTMLButtonElement;
    expect(captionInput.value).toBe('');
    expect(captionInput.disabled).toBe(true);
    expect(dateButton.disabled).toBe(true);
  });

  it('removes the open edit and opens the previous current edit', async () => {
    const harbor = new File(['photo'], 'harbor.png', { type: 'image/png' });
    const pier = new File(['photo'], 'pier.png', { type: 'image/png' });
    await loadPicked(fixture, harbor);
    const session = currentSession(fixture);
    const olderId = session.activeId();
    session.write(olderId ?? '', {
      rightCaption: 'Harbor',
      date: '2024-06-15',
      panX: 0.2,
      panY: 0.7,
      zoom: 1.4,
    });

    await loadPicked(fixture, pier);
    state(fixture).captionModel.set({ left: '2026-09-12', right: 'Pier' });
    fixture.detectChanges();

    button(fixture, 'Remove').click();
    await fixture.whenStable();

    expect(session.edits().map((edit) => edit.fileName)).toEqual(['harbor.png']);
    expect(session.activeId()).toBe(olderId);
    expect(text(fixture)).toContain('harbor.png');
    expect(text(fixture)).toContain('15 czerwca 2024');
    expect(text(fixture)).not.toContain('pier.png');
    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    expect(captionInput.value).toBe('Harbor');
    expect(state(fixture).pan()).toEqual({ x: 0.2, y: 0.7 });
    expect(state(fixture).zoom()).toBe(1.4);
  });

  it('saves the framed photo through the share sheet on a phone', async () => {
    await loadPortrait(fixture);
    stubCanvasExport(fixture);
    stubCoarsePointer(true);
    const share = vi.fn().mockResolvedValue(undefined);
    const restoreShare = stubShare(share);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    button(fixture, 'Download').click();
    await fixture.whenStable();

    expect(share).toHaveBeenCalledOnce();
    const shared = share.mock.calls[0]?.[0] as { files: File[] };
    expect(shared.files[0]?.name).toBe('dog-framed.png');
    expect(shared.files[0]?.type).toBe('image/png');
    expect(click).not.toHaveBeenCalled();
    restoreShare();
  });

  it('downloads a file when the phone cannot share images', async () => {
    await loadPortrait(fixture);
    stubCanvasExport(fixture);
    stubCoarsePointer(true);
    const restoreShare = stubShare(vi.fn(), false);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    button(fixture, 'Download').click();

    expect(downloads).toEqual(['dog-framed.png']);
    restoreShare();
  });

  it('adds the download to history when the original file can be opened again', async () => {
    stubElementBox();
    await loadPicked(fixture, new File(['photo'], 'harbor.png', { type: 'image/png' }));
    state(fixture).captionModel.set({ left: '2024-06-15', right: 'Right caption text' });
    fixture.detectChanges();
    stubCanvasExport(fixture);

    button(fixture, 'Download').click();
    button(fixture, 'History').click();

    await vi.waitFor(() => {
      expect(caption(fixture)).toBe('Right caption text');
    });
    expect(historyDate(fixture)).toBe('15 czerwca 2024');
    expect(handles.values.size).toBe(1);
  });

  it('records a download when the browser did not provide a file handle', async () => {
    stubElementBox();
    await loadPortrait(fixture);
    state(fixture).captionModel.set({ left: '2024-06-15', right: 'Right caption text' });
    fixture.detectChanges();
    stubCanvasExport(fixture);

    button(fixture, 'Download').click();
    button(fixture, 'History').click();

    await vi.waitFor(() => {
      expect(caption(fixture)).toBe('Right caption text');
    });
    expect(handles.values.size).toBe(0);
  });

  it('saves the crop position with the download', async () => {
    stubElementBox();
    await loadPortrait(fixture);
    state(fixture).captionModel.set({ left: '2024-06-15', right: 'Pier' });
    state(fixture).pan.set({ x: 0.2, y: 0.7 });
    state(fixture).zoom.set(2);
    stubCanvasExport(fixture);

    button(fixture, 'Download').click();

    await vi.waitFor(() => {
      expect(TestBed.inject(EditHistory).edits()[0]?.zoom).toBe(2);
    });
    expect(TestBed.inject(EditHistory).edits()[0]).toMatchObject({ panX: 0.2, panY: 0.7 });
  });

  it('keeps a separate current edit for each opened photo and saves changes after a second', async () => {
    stubElementBox();
    const history = TestBed.inject(EditHistory);
    await history.record({
      fileName: 'harbor.png',
      rightCaption: 'Pier light',
      date: '2024-06-15',
      thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
      image: new Blob(['png'], { type: 'image/png' }),
      handle: null,
      panX: 0.25,
      panY: 0.8,
      zoom: 2,
    });
    fixture.detectChanges();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-open')).toBeTruthy();
    });
    const opener = fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement;
    opener.click();
    await vi.waitFor(() => {
      expect(currentSession(fixture).edits()).toHaveLength(1);
    });
    opener.click();
    await vi.waitFor(() => {
      expect(currentSession(fixture).edits()).toHaveLength(2);
    });
    expect(currentSession(fixture).edits().map((edit) => edit.rightCaption)).toEqual([
      'Pier light',
      'Pier light',
    ]);

    state(fixture).captionModel.set({ left: '2024-06-15', right: 'Night pier' });
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(currentSession(fixture).edits()[0]?.rightCaption).toBe('Pier light');

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(currentSession(fixture).edits()[0]).toMatchObject({
      rightCaption: 'Night pier',
      date: '2024-06-15',
    });
    expect(currentSession(fixture).edits()[1]?.rightCaption).toBe('Pier light');

    state(fixture).pan.set({ x: 0.2, y: 0.7 });
    state(fixture).zoom.set(1.5);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(currentSession(fixture).edits()[0]).toMatchObject({ panX: 0.2, panY: 0.7, zoom: 1.5 });
    expect(currentSession(fixture).edits()[1]).toMatchObject({ panX: 0.25, panY: 0.8, zoom: 2 });

    button(fixture, 'Current edits').click();
    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-open').length).toBe(2);
    });
    const rows = [
      ...fixture.nativeElement.querySelectorAll('.history-open'),
    ] as HTMLButtonElement[];
    rows[1]?.click();
    await fixture.whenStable();

    expect(currentSession(fixture).edits()).toHaveLength(2);
    expect(currentSession(fixture).activeId()).toBe(currentSession(fixture).edits()[1]?.id);
    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    expect(captionInput.value).toBe('Pier light');
  });

  it('replaces the photo inside the open current edit', async () => {
    await loadPortrait(fixture);
    const session = currentSession(fixture);
    const id = session.activeId();
    state(fixture).captionModel.set({ left: '2024-06-15', right: 'Pier light' });
    state(fixture).pan.set({ x: 0.2, y: 0.7 });
    fixture.detectChanges();

    const next = new File(['next'], 'pier.png', { type: 'image/png' });
    pickPhoto.mockResolvedValue([{ file: next, handle: fileHandle(next) }]);
    button(fixture, 'Replace').click();

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('pier.png');
    });
    expect(session.edits()).toHaveLength(1);
    expect(session.activeId()).toBe(id);
    expect(session.edits()[0]).toMatchObject({
      fileName: 'pier.png',
      rightCaption: '',
      date: '',
      panX: 0.5,
      panY: 0.5,
      zoom: 1,
    });
    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    expect(captionInput.value).toBe('');
  });

  it('sets the date from the replacement photo capture date', async () => {
    await loadPortrait(fixture);
    state(fixture).captionModel.set({ left: '2026-09-12', right: 'Pier light' });
    fixture.detectChanges();

    const next = jpegWithExifDate('pier.jpg', [{ tag: 0x9003, value: '2023:01:02 08:00:00' }]);
    pickPhoto.mockResolvedValue([{ file: next, handle: fileHandle(next) }]);
    button(fixture, 'Replace').click();

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('2 stycznia 2023');
    });
    expect(text(fixture)).not.toContain('12 września 2026');
    expect(currentSession(fixture).edits()[0]).toMatchObject({
      fileName: 'pier.jpg',
      date: '2023-01-02',
      rightCaption: '',
    });
  });

  it('opens every selected photo as its own current edit', async () => {
    const harbor = jpegWithExifDate('harbor.jpg', [{ tag: 0x9003, value: '2024:06:15 10:30:00' }]);
    const pier = new File(['photo'], 'pier.png', { type: 'image/png' });
    pickPhoto.mockResolvedValue([
      { file: harbor, handle: fileHandle(harbor) },
      { file: pier, handle: fileHandle(pier) },
    ]);

    button(fixture, 'Choose a photo').click();

    await vi.waitFor(() => {
      expect(currentSession(fixture).edits()).toHaveLength(2);
    });
    expect(currentSession(fixture).edits().map((edit) => edit.fileName)).toEqual([
      'pier.png',
      'harbor.jpg',
    ]);
    expect(currentSession(fixture).edits()[1]).toMatchObject({
      date: '2024-06-15',
      rightCaption: '',
    });
    expect(currentSession(fixture).edits()[0]).toMatchObject({ date: '', rightCaption: '' });
    expect(text(fixture)).toContain('pier.png');
    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    expect(captionInput.value).toBe('');
  });

  it('keeps the sidebar empty until every chosen photo has loaded', async () => {
    FakeImage.hold = true;
    const input = fileInput(fixture);
    const files = [
      new File(['a'], 'harbor.png', { type: 'image/png' }),
      new File(['b'], 'pier.png', { type: 'image/png' }),
    ];
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(text(fixture)).toContain('Loading images (0/2)');
    expect(text(fixture)).not.toContain('Choose a photo');
    expect(button(fixture, 'Current edits').getAttribute('aria-selected')).toBe('false');
    expect(currentSession(fixture).edits()).toEqual([]);

    FakeImage.hold = false;
    for (const image of FakeImage.held) {
      image.onload?.();
    }
    FakeImage.held = [];

    await vi.waitFor(() => {
      expect(currentSession(fixture).edits().map((edit) => edit.fileName)).toEqual([
        'pier.png',
        'harbor.png',
      ]);
    });
    fixture.detectChanges();
    expect(button(fixture, 'Current edits').getAttribute('aria-selected')).toBe('true');
  });

  it('opens every file from the input as its own current edit', async () => {
    const input = fileInput(fixture);
    expect(input.multiple).toBe(true);
    const files = [
      new File(['a'], 'harbor.png', { type: 'image/png' }),
      new File(['b'], 'pier.png', { type: 'image/png' }),
    ];
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(currentSession(fixture).edits().map((edit) => edit.fileName)).toEqual([
        'pier.png',
        'harbor.png',
      ]);
    });
  });

  it('shows Choose a photo above the current edits after a photo is open', async () => {
    expect(fixture.nativeElement.querySelector('.picker--current')).toBeNull();
    await loadPortrait(fixture);
    await fixture.whenStable();

    const panel = fixture.nativeElement.querySelector('#current-panel') as HTMLElement;
    const picker = panel.querySelector('.picker--current');
    const list = panel.querySelector('.history-scroll');
    expect(picker).toBeInstanceOf(HTMLButtonElement);
    expect(list).toBeTruthy();
    expect(picker!.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    (picker as HTMLButtonElement).click();
    expect(pickPhoto).toHaveBeenCalled();
  });

  it('opens a saved edit with its photo, caption, and date', async () => {
    stubElementBox();
    const history = TestBed.inject(EditHistory);
    await history.record({
      fileName: 'harbor.png',
      rightCaption: 'Pier light',
      date: '2024-06-15',
      thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
      image: new Blob(['png'], { type: 'image/png' }),
      handle: null,
      panX: 0.25,
      panY: 0.8,
      zoom: 2,
    });
    fixture.detectChanges();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-open')).toBeTruthy();
    });
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('harbor.png');
    });
    const captionInput = fixture.nativeElement.querySelector('#rightCaption') as HTMLInputElement;
    expect(captionInput.value).toBe('Pier light');
    expect(text(fixture)).toContain('15 czerwca 2024');
    expect(state(fixture).pan()).toEqual({ x: 0.25, y: 0.8 });
    expect(state(fixture).zoom()).toBe(2);
  });

  it('reports when a saved edit has no photo copy', async () => {
    stubElementBox();
    const history = TestBed.inject(EditHistory);
    await history.record({
      fileName: 'harbor.png',
      rightCaption: 'Pier light',
      date: '2024-06-15',
      thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
      image: null,
      handle: null,
      panX: 0.5,
      panY: 0.5,
      zoom: 1,
    });
    fixture.detectChanges();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-open')).toBeTruthy();
    });
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('That saved photo could not be opened.');
    });
    expect(fixture.nativeElement.querySelector('.photo-name')).toBeNull();
  });

  it('does not record a download when sharing is cancelled', async () => {
    await loadPicked(fixture, new File(['photo'], 'harbor.png', { type: 'image/png' }));
    state(fixture).captionModel.set({ left: '2024-06-15', right: 'Right caption text' });
    fixture.detectChanges();
    stubCanvasExport(fixture);
    stubCoarsePointer(true);
    const share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'));
    const restoreShare = stubShare(share);

    button(fixture, 'Download').click();
    await fixture.whenStable();

    expect(share).toHaveBeenCalledOnce();
    expect(handles.values.size).toBe(0);
    button(fixture, 'History').click();
    await fixture.whenStable();
    expect(caption(fixture)).toBeNull();
    restoreShare();
  });

  it('resets the zoom when another photo is loaded', async () => {
    await loadPortrait(fixture);
    const overlay = fixture.nativeElement.querySelector('.photo-overlay') as HTMLElement;
    overlay.getBoundingClientRect = () => new DOMRect(0, 0, 200, 300);
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: 40, clientY: 40 }));
    await fixture.whenStable();

    expect(state(fixture).zoom()).toBeGreaterThan(1);

    await loadPortrait(fixture);

    expect(state(fixture).zoom()).toBe(1);
  });
});

function currentSession(fixture: ComponentFixture<PhotoEditor>): CurrentSession {
  return fixture.debugElement.injector.get(CurrentSession);
}

function state(fixture: ComponentFixture<PhotoEditor>) {
  return fixture.componentInstance as unknown as {
    zoom: { (): number; set(value: number): void };
    pan: { (): { x: number; y: number }; set(value: { x: number; y: number }): void };
    photo: () => unknown;
    captionModel: { set(value: { left: string; right: string }): void };
  };
}

function fileInput(fixture: ComponentFixture<PhotoEditor>): HTMLInputElement {
  return fixture.nativeElement.querySelector('#photoFile');
}

function text(fixture: ComponentFixture<PhotoEditor>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function button(fixture: ComponentFixture<PhotoEditor>, name: string): HTMLButtonElement {
  const match = [...fixture.nativeElement.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(name),
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${name} button`);
  }
  return match;
}

function stubCanvasExport(fixture: ComponentFixture<PhotoEditor>): void {
  const canvas = fixture.nativeElement.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Missing preview canvas');
  }
  canvas.toDataURL = () => `data:image/png;base64,${btoa('framed')}`;
}

function stubCoarsePointer(coarse: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) =>
      ({
        matches: coarse && query === '(pointer: coarse)',
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

function stubShare(share: ReturnType<typeof vi.fn>, canShare = true): () => void {
  const navigatorWithShare = navigator as Navigator & {
    share?: Navigator['share'];
    canShare?: Navigator['canShare'];
  };
  const originalShare = navigatorWithShare.share;
  const originalCanShare = navigatorWithShare.canShare;
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: () => canShare,
  });
  return () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: originalCanShare });
  };
}

function chooseFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: {
      0: file,
      length: 1,
      item: () => file,
    },
  });
  input.dispatchEvent(new Event('change'));
}

async function loadPortrait(fixture: ComponentFixture<PhotoEditor>): Promise<void> {
  chooseFile(fileInput(fixture), new File(['photo'], 'dog.png', { type: 'image/png' }));
  await fixture.whenStable();
}

async function loadPicked(fixture: ComponentFixture<PhotoEditor>, file: File): Promise<void> {
  pickPhoto.mockResolvedValue([{ file, handle: fileHandle(file) }]);
  button(fixture, 'Choose a photo').click();
  await vi.waitFor(() => {
    expect(text(fixture)).toContain(file.name);
  });
}

function caption(fixture: ComponentFixture<PhotoEditor>): string | null {
  return fixture.nativeElement.querySelector('.history-caption')?.textContent ?? null;
}

function historyDate(fixture: ComponentFixture<PhotoEditor>): string | null {
  return fixture.nativeElement.querySelector('.history-date')?.textContent ?? null;
}

function fileHandle(file: File): StoredFileHandle {
  return {
    kind: 'file',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => file,
  };
}

class MemoryEditList implements EditListDb {
  records: EditRecord[] = [];

  async read(): Promise<EditRecord[]> {
    return this.records;
  }

  async write(edits: readonly EditRecord[]): Promise<void> {
    this.records = [...edits];
  }
}

class MemoryImages implements EditImageDb {
  readonly values = new Map<string, Blob>();

  async get(id: string): Promise<Blob | undefined> {
    return this.values.get(id);
  }

  async put(id: string, image: Blob): Promise<void> {
    this.values.set(id, image);
  }

  async delete(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      this.values.delete(id);
    }
  }
}

class MemoryHandles implements FileHandleDb {
  readonly values = new Map<string, StoredFileHandle>();

  async get(id: string): Promise<StoredFileHandle | undefined> {
    return this.values.get(id);
  }

  async put(id: string, value: StoredFileHandle): Promise<void> {
    this.values.set(id, value);
  }

  async delete(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      this.values.delete(id);
    }
  }
}

function stubElementBox(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return 480;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return 320;
    },
  });
}

class FakeImage {
  static failNext = false;
  static hold = false;
  static held: FakeImage[] = [];
  naturalWidth = 800;
  naturalHeight = 1200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    if (FakeImage.failNext) {
      FakeImage.failNext = false;
      this.onerror?.();
      return;
    }
    if (FakeImage.hold) {
      FakeImage.held.push(this);
      return;
    }

    this.onload?.();
  }
}
