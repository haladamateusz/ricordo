import { pluralForm } from './languages';

describe('pluralForm', () => {
  it('uses one and other outside Polish', () => {
    expect(pluralForm('en', 1)).toBe('one');
    expect(pluralForm('en', 0)).toBe('other');
    expect(pluralForm('en', 2)).toBe('other');
    expect(pluralForm('en', 5)).toBe('other');
    expect(pluralForm('de', 1)).toBe('one');
    expect(pluralForm('it', 3)).toBe('other');
  });

  it('uses the Polish few form for 2–4, but not for the teens', () => {
    expect(pluralForm('pl', 1)).toBe('one');

    for (const count of [2, 3, 4, 22, 23, 24, 102]) {
      expect(pluralForm('pl', count)).toBe('few');
    }

    for (const count of [0, 5, 11, 12, 13, 14, 15, 21, 25, 112]) {
      expect(pluralForm('pl', count)).toBe('other');
    }
  });
});
