import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DatePicker, formatCaptionDate, selectableYearCount, toLocalIsoDate } from './date-picker';

describe('formatCaptionDate', () => {
  it('prints a selected date in Polish', () => {
    expect(formatCaptionDate('2026-09-12')).toBe('12 września 2026');
    expect(formatCaptionDate('1999-01-03')).toBe('3 stycznia 1999');
    expect(formatCaptionDate('2025-10-31')).toBe('31 października 2025');
  });

  it('prints nothing when no date is selected', () => {
    expect(formatCaptionDate('')).toBe('');
    expect(formatCaptionDate('2026-02-31')).toBe('');
  });
});

describe('DatePicker', () => {
  let fixture: ComponentFixture<DatePicker>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatePicker],
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
});

describe('selectable range', () => {
  it('uses the local calendar date as the latest day', () => {
    expect(toLocalIsoDate(new Date(2026, 8, 24))).toBe('2026-09-24');
  });

  it('keeps every year from 2017 through the current year in the menu', () => {
    expect(selectableYearCount(2026)).toBe(19);
    expect(selectableYearCount(2027)).toBe(21);
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
