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
      expect(text(fixture)).toContain('No edits yet');
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
      image: new Image(),
      objectUrl: 'blob:harbor',
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
      image: new Image(),
      objectUrl: 'blob:harbor',
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

function text(fixture: ComponentFixture<EditHistoryList>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
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
