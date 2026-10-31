import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import {
  EDIT_IMAGE_DB,
  EDIT_LIST_DB,
  FILE_HANDLE_DB,
  type EditImageDb,
  type EditListDb,
  type EditRecord,
  type FileHandleDb,
  type StoredFileHandle,
} from './edit-history';
import { CurrentSession } from './current-session';
import { EditDrawer } from './edit-drawer';
import { EditHistoryList } from './edit-history-list';

describe('EditHistoryList', () => {
  let lists: MemoryEditList;
  let handles: MemoryHandles;
  let images: MemoryImages;

  beforeEach(() => {
    lists = new MemoryEditList();
    handles = new MemoryHandles();
    images = new MemoryImages();
    stubElementBox();
  });

  it('says when there are no edits', async () => {
    const fixture = await create();

    await vi.waitFor(() => {
      expect(text(fixture)).toContain('No saved edits yet');
    });
    expect(fixture.nativeElement.querySelector('.history-caption')).toBeNull();
  });

  it('shows a saved edit from its thumbnail while file access is still pending', async () => {
    const pending = edit('cafe');
    handles.values.set(pending.id, {
      kind: 'file',
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'prompt',
      getFile: async () => new File(['photo'], 'cafe.png', { type: 'image/png' }),
    });
    const fixture = await create([pending]);

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-caption')?.textContent).toBe(
        'Cafe terrace overloo...',
      );
    });
    expect(fixture.nativeElement.querySelector('.history-date')?.textContent).toBe(
      '15 czerwca 2024',
    );
  });

  it('keeps the saved edits under the History tab', async () => {
    const fixture = await create([edit('cafe')]);

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-caption')?.textContent).toBe(
        'Cafe terrace overloo...',
      );
    });
    const historyTab = tab(fixture, 'History');
    expect(historyTab.getAttribute('aria-selected')).toBe('true');

    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-caption')).toBeNull();
      expect(text(fixture)).toContain('No current edits');
      expect(text(fixture)).not.toContain('Oldest first');
      expect(text(fixture)).not.toContain('Download all');
    });
    expect(tab(fixture, 'Current edits').getAttribute('aria-selected')).toBe('true');

    tab(fixture, 'History').click();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.history-caption')?.textContent).toBe(
      'Cafe terrace overloo...',
    );
  });

  it('moves between the edit tabs with the arrow keys', async () => {
    const fixture = await create();
    const historyTab = tab(fixture, 'History');

    historyTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    await vi.waitFor(() => {
      expect(tab(fixture, 'Current edits').getAttribute('aria-selected')).toBe('true');
      expect(text(fixture)).toContain('No current edits');
      expect(text(fixture)).not.toContain('No edits yet');
    });
  });

  it('sorts current edits from oldest to newest, by time of day, with undated edits first', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    const saved: string[] = [];
    session.begin({ ...currentDraft('newest.png', 'Newest'), date: '2024-12-01' });
    session.begin({ ...currentDraft('blank.png', 'Blank'), date: '' });
    session.begin({ ...currentDraft('oldest.png', 'Oldest'), date: '2024-01-03' });
    session.begin({ ...currentDraft('morning.png', 'Morning'), date: '2024-06-15T09:15:00' });
    session.begin({ ...currentDraft('evening.png', 'Evening'), date: '2024-06-15T18:04:00' });
    fixture.componentInstance.reordered.subscribe(() => saved.push('saved'));
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(button(fixture, 'Oldest first')).toBeTruthy();
    });
    button(fixture, 'Oldest first').click();
    fixture.detectChanges();

    expect(session.edits().map((edit) => edit.fileName)).toEqual([
      'blank.png',
      'oldest.png',
      'morning.png',
      'evening.png',
      'newest.png',
    ]);
    expect(fixture.nativeElement.querySelector('.reorder-status')?.textContent).toBe(
      'Current edits sorted from oldest to newest.',
    );
    expect(saved).toEqual(['saved']);

    button(fixture, 'Oldest first').click();
    fixture.detectChanges();

    expect(session.edits().map((edit) => edit.fileName)).toEqual([
      'blank.png',
      'oldest.png',
      'morning.png',
      'evening.png',
      'newest.png',
    ]);
    expect(fixture.nativeElement.querySelector('.reorder-status')?.textContent).toBe(
      'Current edits are already oldest first.',
    );
    expect(saved).toEqual(['saved']);
  });

  it('shows each opened photo on the Current edits tab', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    session.begin({
      fileName: 'harbor.png',
      rightCaption: 'Cafe terrace overlooking the harbor',
      date: '2024-06-15',
      panX: 0.2,
      panY: 0.7,
      zoom: 1.5,
      orientation: 'landscape',
      image: new Image(),
      objectUrl: 'blob:harbor',
      source: new Blob(),
      handle: null,
    });
    fixture.detectChanges();

    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-caption')?.textContent).toBe(
        'Cafe terrace overloo...',
      );
    });
    expect(fixture.nativeElement.querySelector('.history-date')?.textContent).toBe(
      '15 czerwca 2024',
    );
    expect(fixture.nativeElement.querySelector('.history-open')?.getAttribute('aria-current')).toBe(
      'true',
    );
    expect(editCount(fixture)).toBe('Photo 1 of 1');
  });

  it('shows where the open edit sits in the current batch', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    const oldest = session.begin(currentDraft('oldest.png', 'Oldest'));
    session.begin(currentDraft('middle.png', 'Middle'));
    session.begin(currentDraft('newest.png', 'Newest'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.edit-count')).toBeNull();

    tab(fixture, 'Current edits').click();
    await vi.waitFor(() => {
      expect(editCount(fixture)).toBe('Photo 1 of 3');
    });

    session.activate(oldest);
    fixture.detectChanges();

    expect(editCount(fixture)).toBe('Photo 3 of 3');
  });

  it('offers each saved edit as a button', async () => {
    const fixture = await create([edit('cafe')]);

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-open')).toBeTruthy();
    });
    const opener = fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement;
    expect(opener.getAttribute('aria-label')).toBe(
      'Cafe terrace overlooking the harbor, 15 czerwca 2024',
    );
    expect(opener.textContent).toContain('Cafe terrace overloo...');
  });

  it('closes the edits dialog when a history edit is opened', async () => {
    const fixture = await create([edit('cafe')]);
    const drawer = fixture.debugElement.injector.get(EditDrawer);
    drawer.show();
    fixture.detectChanges();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-open')).toBeTruthy();
    });
    expect(fixture.nativeElement.getAttribute('role')).toBe('dialog');

    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(drawer.open()).toBe(false);
    expect(fixture.nativeElement.getAttribute('role')).toBe('region');
  });

  it('drags one current edit to a new place without opening it', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    const drawer = fixture.debugElement.injector.get(EditDrawer);
    session.begin(currentDraft('pier.png', 'Pier'));
    session.begin(currentDraft('cafe.png', 'Cafe'));
    session.begin(currentDraft('night.png', 'Night'));
    drawer.show();
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-row.is-sortable').length).toBe(3);
    });
    const scroll = fixture.nativeElement
      .querySelector('.history-row.is-sortable')
      ?.closest('.history-scroll');
    if (!(scroll instanceof HTMLElement)) {
      throw new Error('Missing current edits list');
    }
    scroll.getBoundingClientRect = () => new DOMRect(0, 0, 320, 480);
    const rows = [
      ...fixture.nativeElement.querySelectorAll('#current-panel .history-row'),
    ] as HTMLElement[];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => new DOMRect(0, index * 88, 320, 88);
    });

    rows[0].dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 30,
        pointerId: 1,
      }),
    );
    scroll.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 130, pointerId: 1 }),
    );
    scroll.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: 40, clientY: 130, pointerId: 1 }),
    );
    (rows[0].querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(session.edits().map((edit) => edit.fileName)).toEqual([
      'cafe.png',
      'night.png',
      'pier.png',
    ]);
    expect(session.activeId()).toBe(session.edits()[1]?.id);
    expect(drawer.open()).toBe(true);
  });

  it('selects a dragged edit on the click after the drag', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    const drawer = fixture.debugElement.injector.get(EditDrawer);
    session.begin(currentDraft('pier.png', 'Pier'));
    session.begin(currentDraft('cafe.png', 'Cafe'));
    const night = session.begin(currentDraft('night.png', 'Night'));
    const selected: string[] = [];
    fixture.componentInstance.currentSelected.subscribe((edit) => selected.push(edit.fileName));
    drawer.show();
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-row.is-sortable').length).toBe(3);
    });
    const scroll = fixture.nativeElement
      .querySelector('.history-row.is-sortable')
      ?.closest('.history-scroll');
    if (!(scroll instanceof HTMLElement)) {
      throw new Error('Missing current edits list');
    }
    scroll.getBoundingClientRect = () => new DOMRect(0, 0, 320, 480);
    const rows = [
      ...fixture.nativeElement.querySelectorAll('.history-row.is-sortable'),
    ] as HTMLElement[];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => new DOMRect(0, index * 88, 320, 88);
    });

    rows[1].dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 16,
        clientY: 118,
        pointerId: 1,
      }),
    );
    scroll.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 16, clientY: 150, pointerId: 1 }),
    );
    scroll.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: 16, clientY: 150, pointerId: 1 }),
    );
    (rows[1].querySelector('.history-grip') as HTMLButtonElement).click();
    expect(session.activeId()).toBe(night);

    await new Promise((resolve) => setTimeout(resolve, 0));
    (fixture.nativeElement.querySelectorAll('.history-open')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(selected).toEqual(['cafe.png']);
    expect(session.activeId()).toBe(night);
    expect(drawer.open()).toBe(false);
  });

  it('moves one current edit at a time from the keyboard', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    session.begin(currentDraft('pier.png', 'Pier'));
    session.begin(currentDraft('cafe.png', 'Cafe'));
    session.begin(currentDraft('night.png', 'Night'));
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-grip').length).toBe(3);
    });
    const grip = fixture.nativeElement.querySelector('.history-grip') as HTMLButtonElement;

    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();

    expect(session.edits().map((edit) => edit.fileName)).toEqual([
      'cafe.png',
      'night.png',
      'pier.png',
    ]);
    expect(fixture.nativeElement.querySelector('.reorder-status')?.textContent).toContain(
      'position 2 of 3',
    );
  });

  it('selects several current edits with command or control without opening them', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    const drawer = fixture.debugElement.injector.get(EditDrawer);
    const opened: string[] = [];
    session.begin(currentDraft('pier.png', 'Pier'));
    session.begin(currentDraft('cafe.png', 'Cafe'));
    session.begin(currentDraft('night.png', 'Night'));
    fixture.componentInstance.currentSelected.subscribe((edit) => opened.push(edit.fileName));
    drawer.show();
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-open').length).toBe(3);
    });
    const openers = [
      ...fixture.nativeElement.querySelectorAll('.history-open'),
    ] as HTMLButtonElement[];
    openers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    openers[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    fixture.detectChanges();

    const rows = [
      ...fixture.nativeElement.querySelectorAll('.history-row.is-sortable'),
    ] as HTMLElement[];
    expect(rows[0].classList.contains('is-picked')).toBe(true);
    expect(rows[1].classList.contains('is-picked')).toBe(false);
    expect(rows[2].classList.contains('is-picked')).toBe(true);
    expect(openers[0].getAttribute('aria-label')).toContain('selected');
    expect(opened).toEqual([]);
    expect(drawer.open()).toBe(true);

    openers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    fixture.detectChanges();
    expect(rows[0].classList.contains('is-picked')).toBe(true);

    openers[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    fixture.detectChanges();
    expect(rows[0].classList.contains('is-picked')).toBe(false);
    expect(rows[2].classList.contains('is-picked')).toBe(false);
  });

  it('adds the open edit when another row is selected and drags them together', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    session.begin(currentDraft('pier.png', 'Pier'));
    session.begin(currentDraft('cafe.png', 'Cafe'));
    const night = session.begin(currentDraft('night.png', 'Night'));
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-open').length).toBe(3);
    });
    const openers = [
      ...fixture.nativeElement.querySelectorAll('.history-open'),
    ] as HTMLButtonElement[];
    openers[1].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    fixture.detectChanges();

    const rows = [
      ...fixture.nativeElement.querySelectorAll('.history-row.is-sortable'),
    ] as HTMLElement[];
    expect(rows[0].classList.contains('is-picked')).toBe(true);
    expect(rows[1].classList.contains('is-picked')).toBe(true);
    expect(rows[2].classList.contains('is-picked')).toBe(false);
    expect(openers[0].getAttribute('aria-label')).toContain('selected');
    expect(fixture.nativeElement.querySelector('.reorder-status')?.textContent).toContain(
      '2 selected',
    );

    const scroll = rows[0].closest('.history-scroll');
    if (!(scroll instanceof HTMLElement)) {
      throw new Error('Missing current edits list');
    }
    scroll.getBoundingClientRect = () => new DOMRect(0, 0, 320, 480);
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => new DOMRect(0, index * 88, 320, 88);
    });

    rows[0].dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 30,
        pointerId: 1,
      }),
    );
    scroll.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 100, pointerId: 1 }),
    );
    scroll.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: 40, clientY: 100, pointerId: 1 }),
    );
    fixture.detectChanges();

    expect(session.edits().map((edit) => edit.fileName)).toEqual([
      'pier.png',
      'night.png',
      'cafe.png',
    ]);
    expect(session.activeId()).toBe(night);
  });

  it('drops separated edits one after another and leaves the others in place', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    session.begin(currentDraft('pier.png', 'Pier'));
    session.begin(currentDraft('cafe.png', 'Cafe'));
    session.begin(currentDraft('night.png', 'Night'));
    session.begin(currentDraft('lake.png', 'Lake'));
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-open').length).toBe(4);
    });
    const openers = [
      ...fixture.nativeElement.querySelectorAll('.history-open'),
    ] as HTMLButtonElement[];
    openers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    openers[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    fixture.detectChanges();

    const scroll = fixture.nativeElement
      .querySelector('.history-row.is-sortable')
      ?.closest('.history-scroll');
    if (!(scroll instanceof HTMLElement)) {
      throw new Error('Missing current edits list');
    }
    scroll.getBoundingClientRect = () => new DOMRect(0, 0, 320, 480);
    const rows = [
      ...fixture.nativeElement.querySelectorAll('.history-row.is-sortable'),
    ] as HTMLElement[];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => new DOMRect(0, index * 88, 320, 88);
    });

    rows[0].dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 30,
        pointerId: 1,
      }),
    );
    scroll.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 200, pointerId: 1 }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.history-row.is-lifted').length).toBe(2);

    scroll.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: 40, clientY: 200, pointerId: 1 }),
    );
    fixture.detectChanges();

    expect(session.edits().map((edit) => edit.fileName)).toEqual([
      'night.png',
      'pier.png',
      'lake.png',
      'cafe.png',
    ]);
    expect(fixture.nativeElement.querySelector('.reorder-status')?.textContent).toContain(
      'positions 3 through 4',
    );
    expect(session.activeId()).toBe(session.edits()[2]?.id);
  });

  it('moves a separated selection together from the keyboard', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    session.begin(currentDraft('pier.png', 'Pier'));
    session.begin(currentDraft('cafe.png', 'Cafe'));
    session.begin(currentDraft('night.png', 'Night'));
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelectorAll('.history-grip').length).toBe(3);
    });
    const openers = [
      ...fixture.nativeElement.querySelectorAll('.history-open'),
    ] as HTMLButtonElement[];
    openers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    openers[2].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    fixture.detectChanges();

    const grip = fixture.nativeElement.querySelector('.history-grip') as HTMLButtonElement;
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();

    expect(session.edits().map((edit) => edit.fileName)).toEqual([
      'cafe.png',
      'night.png',
      'pier.png',
    ]);
    expect(fixture.nativeElement.querySelector('.reorder-status')?.textContent).toContain(
      'positions 2 through 3',
    );
  });

  it('closes the edits dialog when a current edit is opened', async () => {
    const fixture = await create();
    const session = fixture.debugElement.injector.get(CurrentSession);
    session.begin({
      fileName: 'harbor.png',
      rightCaption: '',
      date: '',
      panX: 0.5,
      panY: 0.5,
      zoom: 1,
      orientation: 'landscape',
      image: new Image(),
      objectUrl: 'blob:harbor',
      source: new Blob(),
      handle: null,
    });
    const drawer = fixture.debugElement.injector.get(EditDrawer);
    drawer.show();
    fixture.detectChanges();
    tab(fixture, 'Current edits').click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.querySelector('.history-open')).toBeTruthy();
    });

    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(drawer.open()).toBe(false);
  });

  async function create(entries: EditRecord[] = []): Promise<ComponentFixture<EditHistoryList>> {
    lists.records = entries;

    await TestBed.configureTestingModule({
      imports: [EditHistoryList],
      providers: [
        { provide: EDIT_LIST_DB, useValue: lists },
        { provide: FILE_HANDLE_DB, useValue: handles },
        { provide: EDIT_IMAGE_DB, useValue: images },
        CurrentSession,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EditHistoryList);
    await fixture.whenStable();
    return fixture;
  }
});

function currentDraft(fileName: string, rightCaption: string) {
  return {
    fileName,
    rightCaption,
    date: '2024-06-15',
    panX: 0.5,
    panY: 0.5,
    zoom: 1,
    orientation: 'landscape' as const,
    image: new Image(),
    objectUrl: `blob:${fileName}`,
    source: new Blob(),
    handle: null,
  };
}

function edit(id: string): EditRecord {
  return {
    id,
    fileName: `${id}.png`,
    rightCaption: 'Cafe terrace overlooking the harbor',
    date: '2024-06-15',
    thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
    panX: 0.5,
    panY: 0.5,
    zoom: 1,
    orientation: 'landscape',
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
  async get(): Promise<Blob | undefined> {
    return undefined;
  }

  async put(): Promise<void> {
    return undefined;
  }

  async delete(): Promise<void> {
    return undefined;
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

function editCount(fixture: ComponentFixture<EditHistoryList>): string {
  return (
    fixture.nativeElement.querySelector('.edit-count')?.textContent?.replace(/\s+/g, ' ').trim() ??
    ''
  );
}

function text(fixture: ComponentFixture<EditHistoryList>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function button(fixture: ComponentFixture<EditHistoryList>, name: string): HTMLButtonElement {
  const match = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${name}`);
  }
  return match;
}

function tab(fixture: ComponentFixture<EditHistoryList>, name: string): HTMLButtonElement {
  const button = [...fixture.nativeElement.querySelectorAll('[role="tab"]')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing tab ${name}`);
  }
  return button;
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
