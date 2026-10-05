import { TestBed } from '@angular/core/testing';

import { CurrentSession } from './current-session';

describe('CurrentSession', () => {
  let session: CurrentSession;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CurrentSession] });
    session = TestBed.inject(CurrentSession);
  });

  it('keeps each opened photo as its own edit, newest first', () => {
    const first = session.begin(draft('harbor.png', 'Pier'));
    const second = session.begin(draft('harbor.png', 'Night'));

    expect(session.edits().map((edit) => edit.id)).toEqual([second, first]);
    expect(session.edits().map((edit) => edit.rightCaption)).toEqual(['Night', 'Pier']);
    expect(session.activeId()).toBe(second);
  });

  it('updates only the edit that is being worked on', () => {
    const first = session.begin(draft('harbor.png', 'Pier'));
    const second = session.begin(draft('harbor.png', 'Night'));

    session.activate(first);
    session.write(first, {
      rightCaption: 'Dawn',
      date: '2024-07-01',
      panX: 0.2,
      panY: 0.7,
      zoom: 2,
    });

    expect(session.find(first)).toMatchObject({
      rightCaption: 'Dawn',
      date: '2024-07-01',
      panX: 0.2,
      panY: 0.7,
      zoom: 2,
    });
    expect(session.find(second)?.rightCaption).toBe('Night');
  });

  it('replaces the photo on one edit without adding another', () => {
    const first = session.begin(draft('harbor.png', 'Pier'));
    const second = session.begin(draft('harbor.png', 'Night'));
    const image = new Image();

    const replaced = session.replacePhoto(second, {
      ...draft('pier.png', 'Night'),
      image,
      objectUrl: 'blob:pier.png',
      panX: 0.5,
      panY: 0.5,
      zoom: 1,
    });

    expect(replaced).toBe(true);
    expect(session.edits().map((edit) => edit.id)).toEqual([second, first]);
    expect(session.activeId()).toBe(second);
    expect(session.find(second)).toMatchObject({
      fileName: 'pier.png',
      rightCaption: 'Night',
      objectUrl: 'blob:pier.png',
      image,
    });
    expect(session.find(first)?.fileName).toBe('harbor.png');
  });

  it('drops an edit and activates the one before it', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const first = session.begin(draft('harbor.png', 'Pier'));
    const second = session.begin(draft('cafe.png', 'Cafe'));
    const third = session.begin(draft('night.png', 'Night'));

    const next = session.discard(second);

    expect(next?.id).toBe(third);
    expect(session.edits().map((edit) => edit.id)).toEqual([third, first]);
    expect(session.activeId()).toBe(third);
    expect(session.find(second)).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('blob:cafe.png');
    revoke.mockRestore();
  });

  it('activates the following edit when the newest one is removed', () => {
    const first = session.begin(draft('harbor.png', 'Pier'));
    const second = session.begin(draft('night.png', 'Night'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const next = session.discard(second);

    expect(next?.id).toBe(first);
    expect(session.activeId()).toBe(first);
    expect(session.edits().map((edit) => edit.fileName)).toEqual(['harbor.png']);
  });

  it('clears the session when the last edit is removed', () => {
    const only = session.begin(draft('harbor.png', 'Pier'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    expect(session.discard(only)).toBeNull();
    expect(session.edits()).toEqual([]);
    expect(session.activeId()).toBeNull();
  });

  function draft(fileName: string, rightCaption: string) {
    return {
      fileName,
      rightCaption,
      date: '2024-06-15',
      panX: 0.5,
      panY: 0.5,
      zoom: 1,
      image: new Image(),
      objectUrl: `blob:${fileName}`,
      handle: null,
    };
  }
});
