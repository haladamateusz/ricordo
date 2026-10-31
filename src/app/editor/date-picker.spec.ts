import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { provideAppTranslations } from '../i18n/provide-app-translations';
import {
  DatePicker,
  captionDateTime,
  formatCaptionDate,
  keepCaptionTime,
  selectableYears,
  setCaptionLocale,
  toLocalIsoDate,
} from './date-picker';

describe('formatCaptionDate', () => {
  beforeEach(() => {
    setCaptionLocale('en-GB');
  });

  it('prints a selected date in English', () => {
    expect(formatCaptionDate('2026-09-12')).toBe('12 September 2026');
    expect(formatCaptionDate('1999-01-03')).toBe('3 January 1999');
    expect(formatCaptionDate('2025-10-31')).toBe('31 October 2025');
  });

  it('prints a selected date in Polish', () => {
    setCaptionLocale('pl');
    expect(formatCaptionDate('2026-09-12')).toBe('12 września 2026');
    expect(formatCaptionDate('2025-10-31')).toBe('31 października 2025');
  });

  it('prints nothing when no date is selected', () => {
    expect(formatCaptionDate('')).toBe('');
    expect(formatCaptionDate('2026-02-31')).toBe('');
  });

  it('prints a capture time as its calendar day', () => {
    expect(formatCaptionDate('2024-06-15T10:30:00')).toBe('15 June 2024');
  });
});

describe('captionDateTime', () => {
  it('orders a real date and treats a missing date as unset', () => {
    expect(captionDateTime('2024-06-15')).toBe(new Date(2024, 5, 15).getTime());
    expect(captionDateTime('2024-06-15T10:30:00')).toBe(new Date(2024, 5, 15, 10, 30, 0).getTime());
    expect(captionDateTime('2024-06-15T18:04:00')).toBeGreaterThan(
      captionDateTime('2024-06-15T10:30:00') ?? 0,
    );
    expect(captionDateTime('')).toBeNull();
    expect(captionDateTime('2026-02-31')).toBeNull();
    expect(captionDateTime('2024-06-15T25:00:00')).toBe(new Date(2024, 5, 15).getTime());
  });
});

describe('keepCaptionTime', () => {
  it('keeps the clock time when the calendar day changes', () => {
    expect(keepCaptionTime('2024-06-16', '2024-06-15T10:30:00')).toBe('2024-06-16T10:30:00');
    expect(keepCaptionTime('2024-06-16', '2024-06-15')).toBe('2024-06-16');
  });
});

describe('DatePicker', () => {
  let fixture: ComponentFixture<DatePicker>;

  beforeEach(async () => {
    localStorage.removeItem('ricordo.language');
    await TestBed.configureTestingModule({
      imports: [DatePicker],
      providers: [provideAppTranslations()],
    }).compileComponents();

    fixture = TestBed.createComponent(DatePicker);
    fixture.componentRef.setInput('value', '');
    fixture.componentRef.setInput('controlId', 'captionDate');
    fixture.componentRef.setInput('placeholder', 'Select date');
    await fixture.whenStable();
  });

  it('stays open when focus moves to a month or year control', async () => {
    open(fixture);

    focusOut(fixture, null);
    await fixture.whenStable();

    expect(isExpanded(fixture)).toBe(true);
  });

  it('closes when focus moves outside the calendar', async () => {
    open(fixture);

    focusOut(fixture, document.body);
    await fixture.whenStable();

    expect(isExpanded(fixture)).toBe(false);
  });

  it('shows every year from 2017 through today on one screen', async () => {
    fixture.componentRef.setInput('value', '2024-06-15');
    open(fixture);
    const heading = await yearHeading(fixture);

    expect(heading.textContent?.trim()).toBe('2024');
    const dialog = fixture.nativeElement.querySelector('.date-picker__dialog') as HTMLElement;
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 280, 320));
    heading.click();
    await fixture.whenStable();

    expect(dialog.style.getPropertyValue('--calendar-height')).toBe('320px');

    const years = yearOptions(fixture).map((button) => button.textContent?.trim());
    const today = new Date().getFullYear();
    expect(years).toEqual(selectableYears(today).map(String));
    expect(fixture.nativeElement.querySelector('.date-picker__dialog--years')).toBeTruthy();
    expect(
      yearOptions(fixture).find((button) => button.textContent?.trim() === '2024'),
    ).toHaveProperty('ariaCurrent', 'true');
  });

  it('returns to the same month in the chosen year', async () => {
    fixture.componentRef.setInput('value', '2024-06-15');
    open(fixture);
    const heading = await yearHeading(fixture);
    heading.click();
    await fixture.whenStable();

    yearOptions(fixture)
      .find((button) => button.textContent?.trim() === '2019')
      ?.click();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.date-picker__years')).toBeNull();
    expect(yearHeadingSync(fixture).textContent?.trim()).toBe('2019');
    expect(focusedDate(fixture)).toBe('2019-06-15');
  });

  it('moves through the year grid with the arrow keys', async () => {
    fixture.componentRef.setInput('value', '2024-06-15');
    open(fixture);
    const heading = await yearHeading(fixture);
    heading.click();
    await fixture.whenStable();

    const current = yearOptions(fixture).find((button) => button.textContent?.trim() === '2024');
    current?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(
      yearOptions(fixture).find((button) => button.textContent?.trim() === '2025'),
    );

    (document.activeElement as HTMLButtonElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(
      yearOptions(fixture).find(
        (button) => button.textContent?.trim() === String(Math.min(2030, new Date().getFullYear())),
      ),
    );
  });

  it('closes the year grid without leaving the calendar', async () => {
    fixture.componentRef.setInput('value', '2024-06-15');
    open(fixture);
    const heading = await yearHeading(fixture);
    heading.click();
    await fixture.whenStable();

    yearOptions(fixture)[0]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.date-picker__years')).toBeNull();
    expect(isExpanded(fixture)).toBe(true);
    expect(document.activeElement).toBe(yearHeadingSync(fixture));
  });
});

describe('selectable range', () => {
  it('uses the local calendar date as the latest day', () => {
    expect(toLocalIsoDate(new Date(2026, 8, 24))).toBe('2026-09-24');
  });

  it('lists every year from 2017 through the current year', () => {
    expect(selectableYears(2026)).toEqual([
      2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
    ]);
    expect(selectableYears(2017)).toEqual([2017]);
    expect(selectableYears(2016)).toEqual([2017]);
  });
});

function open(fixture: ComponentFixture<DatePicker>): void {
  const trigger = fixture.nativeElement.querySelector('button');
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error('Missing date trigger');
  }
  trigger.click();
}

function focusOut(fixture: ComponentFixture<DatePicker>, relatedTarget: Node | null): void {
  const host = fixture.nativeElement as HTMLElement;
  host.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
}

function isExpanded(fixture: ComponentFixture<DatePicker>): boolean {
  return fixture.nativeElement.querySelector('button')?.getAttribute('aria-expanded') === 'true';
}

async function yearHeading(fixture: ComponentFixture<DatePicker>): Promise<HTMLButtonElement> {
  await vi.waitFor(() => {
    expect(yearHeadingSync(fixture)).toBeTruthy();
  });
  return yearHeadingSync(fixture);
}

function yearHeadingSync(fixture: ComponentFixture<DatePicker>): HTMLButtonElement {
  const heading = fixture.nativeElement.querySelector('.date-picker__year');
  if (!(heading instanceof HTMLButtonElement)) {
    throw new Error('Missing year heading');
  }
  return heading;
}

function yearOptions(fixture: ComponentFixture<DatePicker>): HTMLButtonElement[] {
  return [...fixture.nativeElement.querySelectorAll('.date-picker__year-option')].filter(
    (button): button is HTMLButtonElement => button instanceof HTMLButtonElement,
  );
}

function focusedDate(fixture: ComponentFixture<DatePicker>): string {
  const calendar = fixture.nativeElement.querySelector('calendar-date') as
    (HTMLElement & { focusedDate?: unknown }) | null;
  const value = calendar?.focusedDate;
  return typeof value === 'string' ? value : String(value ?? '');
}
