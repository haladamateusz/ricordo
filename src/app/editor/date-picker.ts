import { isPlatformBrowser } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  PLATFORM_ID,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

interface CalendarDateElement extends HTMLElement {
  value: string;
  focusedDate: string;
  focus(options?: FocusOptions & { target?: 'day' | 'next' | 'previous' }): void;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

const earliestYear = 2017;
const yearColumns = 5;

export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function selectableYears(latestYear: number): number[] {
  const end = Math.max(latestYear, earliestYear);
  return Array.from({ length: end - earliestYear + 1 }, (_, index) => earliestYear + index);
}

const captionLocale = signal('en-GB');
const captionFormats = new Map<string, Intl.DateTimeFormat>();

export function setCaptionLocale(locale: string): void {
  captionLocale.set(locale);
}

export function captionLocaleId(): string {
  return captionLocale();
}

export function formatCaptionDate(value: string): string {
  const date = parseLocalDateValue(value);

  if (!date) {
    return '';
  }

  return captionFormat(captionLocale()).format(date);
}

function captionFormat(locale: string): Intl.DateTimeFormat {
  const existing = captionFormats.get(locale);
  if (existing) {
    return existing;
  }

  const format = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  captionFormats.set(locale, format);
  return format;
}

export function captionDateTime(value: string): number | null {
  return parseLocalDateValue(value)?.getTime() ?? null;
}

export function keepCaptionTime(nextDate: string, current: string): string {
  const time = captionClock(current);
  return time ? `${nextDate}T${time}` : nextDate;
}

export function longestCaptionDate(): string {
  return formatCaptionDate('2025-10-31');
}

function parseLocalDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const clock = captionClock(value);
  const hours = clock ? Number(match[4]) : 0;
  const minutes = clock ? Number(match[5]) : 0;
  const seconds = clock ? Number(match[6]) : 0;
  const date = new Date(year, month - 1, day, hours, minutes, seconds);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function focusedParts(value: unknown): CalendarDay | null {
  if (typeof value === 'string') {
    const date = parseLocalDateValue(value);
    if (!date) {
      return null;
    }
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const year = record['year'];
  const month = record['month'];
  const day = record['day'];
  if (typeof year !== 'number' || typeof month !== 'number' || typeof day !== 'number') {
    return null;
  }

  return { year, month, day };
}

function clampDate(date: Date, min: Date, max: Date): Date {
  if (date.getTime() < min.getTime()) {
    return min;
  }
  if (date.getTime() > max.getTime()) {
    return max;
  }
  return date;
}

function captionClock(value: string): string | null {
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }

  return `${match[1]}:${match[2]}:${match[3]}`;
}

@Component({
  selector: 'app-date-picker',
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.css',
  imports: [TranslocoPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:pointerup)': 'onDocumentPointerUp()',
    '(document:wheel)': 'onDocumentScrollIntent($event)',
    '(document:touchmove)': 'onDocumentScrollIntent($event)',
    '(window:scroll)': 'onWindowScroll()',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class DatePicker implements FormValueControl<string> {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transloco = inject(TranslocoService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly yearButton = viewChild<ElementRef<HTMLButtonElement>>('yearButton');
  private readonly yearOptions = viewChildren<ElementRef<HTMLButtonElement>>('yearOption');
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly calendar = viewChild<ElementRef<CalendarDateElement>>('calendar');
  private pointerInside = false;
  private visibleMonth = new Date().getMonth() + 1;
  private visibleDay = new Date().getDate();
  private pendingYearFocus: number | null = null;

  readonly value = model.required<string>();
  readonly disabled = model(false);
  readonly controlId = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly touch = output<void>();

  protected readonly earliestDate = `${earliestYear}-01-01`;
  protected readonly isOpen = signal(false);
  protected readonly isCalendarReady = signal(false);
  protected readonly pickingYear = signal(false);
  protected readonly maxDate = signal(toLocalIsoDate(new Date()));
  protected readonly visibleYear = signal(new Date().getFullYear());
  protected readonly activeYear = signal(new Date().getFullYear());
  protected readonly calendarWidth = signal(0);
  protected readonly calendarHeight = signal(0);
  protected readonly panelId = computed(() => `${this.controlId()}-dialog`);
  protected readonly yearsId = computed(() => `${this.controlId()}-years`);
  protected readonly calendarLocale = computed(() => captionLocaleId());
  protected readonly years = computed(() => selectableYears(Number(this.maxDate().slice(0, 4))));
  protected readonly todayYear = computed(() => Number(this.maxDate().slice(0, 4)));
  protected readonly chooseYearLabel = computed(() => {
    this.transloco.activeLang();
    return this.transloco.translate('date.chooseYear', { year: this.visibleYear() });
  });
  protected readonly displayValue = computed(
    () => formatCaptionDate(this.value()) || this.placeholder(),
  );
  protected readonly calendarDate = computed(() => {
    const date = parseLocalDateValue(this.value());
    return date ? toLocalIsoDate(date) : '';
  });

  constructor() {
    effect(() => {
      if (this.disabled()) {
        this.isOpen.set(false);
      }
    });

    if (this.isBrowser) {
      void import('cally').then(() => {
        this.isCalendarReady.set(true);
        this.focusCalendar();
      });
    }

    afterRenderEffect((onCleanup) => {
      const lang = this.transloco.activeLang();
      const calendar = this.calendar()?.nativeElement;
      if (!calendar) {
        return;
      }

      let frame = 0;
      let attempts = 0;
      const apply = (): void => {
        if (this.transloco.getActiveLang() !== lang || this.labelCalendar(calendar)) {
          return;
        }
        if (attempts >= 8) {
          return;
        }
        attempts += 1;
        frame = requestAnimationFrame(apply);
      };
      apply();
      onCleanup(() => cancelAnimationFrame(frame));
    });

    afterRenderEffect(() => {
      const picking = this.pickingYear();
      const options = this.yearOptions();
      const year = this.pendingYearFocus;
      if (!picking || year === null) {
        return;
      }
      const button = options.find(
        (option) => option.nativeElement.dataset['year'] === String(year),
      );
      if (!button) {
        return;
      }
      this.pendingYearFocus = null;
      button.nativeElement.focus();
    });
  }

  private labelCalendar(calendar: HTMLElement): boolean {
    const root = calendar.shadowRoot;
    const previous = root?.querySelector('button[part~="previous"]');
    const next = root?.querySelector('button[part~="next"]');
    if (!previous || !next) {
      return false;
    }

    previous.setAttribute('aria-label', this.transloco.translate('date.previous'));
    next.setAttribute('aria-label', this.transloco.translate('date.next'));
    return true;
  }

  protected toggle(): void {
    if (this.isOpen()) {
      this.close();
      return;
    }

    this.open();
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.open();
        break;
      case 'Escape':
        if (this.isOpen()) {
          event.preventDefault();
          this.close();
        }
        break;
    }
  }

  protected selectDate(event: Event): void {
    const nextValue = (event.target as CalendarDateElement).value;

    if (!nextValue) {
      return;
    }

    this.value.set(keepCaptionTime(nextValue, this.value()));
    this.touch.emit();
    this.close();
    this.focus();
  }

  protected onDocumentPointerDown(event: PointerEvent): void {
    this.pointerInside = this.containsEventTarget(event.target);

    if (!this.pointerInside) {
      this.close();
    }
  }

  protected onDocumentPointerUp(): void {
    window.setTimeout(() => {
      this.pointerInside = false;
    });
  }

  protected onDocumentScrollIntent(event: Event): void {
    if (this.containsEventTarget(event.target)) {
      return;
    }

    if (event.type === 'touchmove' && this.pointerInside) {
      return;
    }

    this.close();
  }

  protected onWindowScroll(): void {
    if (this.pointerInside || this.focusIsInside() || this.isCoarsePointer()) {
      return;
    }

    this.close();
  }

  protected onFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && this.elementRef.nativeElement.contains(nextTarget)) {
      return;
    }

    // Month buttons live in the calendar shadow tree. WebKit reports that
    // focus move with a null relatedTarget, which used to dismiss the dialog
    // before the month could change.
    if (nextTarget === null && this.containsEventTarget(event.target)) {
      return;
    }

    this.close();
    this.touch.emit();
  }

  focus(options?: FocusOptions): void {
    this.trigger()?.nativeElement.focus(options);
  }

  protected close(): void {
    this.isOpen.set(false);
    this.pickingYear.set(false);
  }

  protected syncVisibleYear(): void {
    this.remember(this.readVisibleDay());
  }

  protected toggleYears(): void {
    if (this.pickingYear()) {
      this.closeYears();
      return;
    }

    const width = this.calendar()?.nativeElement.getBoundingClientRect().width ?? 0;
    const height = this.dialog()?.nativeElement.getBoundingClientRect().height ?? 0;
    if (width > 0) {
      this.calendarWidth.set(Math.ceil(width));
    }
    if (height > 0) {
      this.calendarHeight.set(Math.ceil(height));
    }
    this.remember(this.readVisibleDay());
    this.activeYear.set(this.visibleYear());
    this.pendingYearFocus = this.visibleYear();
    this.pickingYear.set(true);
  }

  protected chooseYear(year: number): void {
    const min = parseLocalDateValue(this.earliestDate) ?? new Date(earliestYear, 0, 1);
    const max = parseLocalDateValue(this.maxDate()) ?? new Date();
    const monthIndex = this.visibleMonth - 1;
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const target = clampDate(
      new Date(year, monthIndex, Math.min(this.visibleDay, lastDay)),
      min,
      max,
    );
    const calendar = this.calendar()?.nativeElement;
    if (calendar) {
      calendar.focusedDate = toLocalIsoDate(target);
    }
    this.remember({
      year: target.getFullYear(),
      month: target.getMonth() + 1,
      day: target.getDate(),
    });
    this.pickingYear.set(false);
    this.focusCalendar();
  }

  protected onYearKey(event: KeyboardEvent, year: number): void {
    const years = this.years();
    const index = years.indexOf(year);
    if (index < 0) {
      return;
    }

    let next = index;
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(years.length - 1, index + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, index - 1);
        break;
      case 'ArrowDown':
        next = Math.min(years.length - 1, index + yearColumns);
        break;
      case 'ArrowUp':
        next = Math.max(0, index - yearColumns);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = years.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.closeYears();
        return;
      default:
        return;
    }

    event.preventDefault();
    const target = years[next];
    if (target === undefined) {
      return;
    }
    this.activeYear.set(target);
    this.yearOptions()
      .find((option) => option.nativeElement.dataset['year'] === String(target))
      ?.nativeElement.focus();
  }

  private closeYears(): void {
    this.pickingYear.set(false);
    this.yearButton()?.nativeElement.focus();
  }

  private open(): void {
    if (this.disabled()) {
      return;
    }

    const today = new Date();
    this.maxDate.set(toLocalIsoDate(today));
    this.remember(this.readVisibleDay());
    this.pickingYear.set(false);
    this.isOpen.set(true);
    this.focusCalendar();
  }

  private readVisibleDay(): CalendarDay {
    const focused = focusedParts(this.calendar()?.nativeElement.focusedDate);
    if (focused) {
      return focused;
    }

    const selected = parseLocalDateValue(this.calendarDate());
    if (selected) {
      return {
        year: selected.getFullYear(),
        month: selected.getMonth() + 1,
        day: selected.getDate(),
      };
    }

    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
  }

  private remember(day: CalendarDay): void {
    this.visibleYear.set(day.year);
    this.visibleMonth = day.month;
    this.visibleDay = day.day;
  }

  private containsEventTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.elementRef.nativeElement.contains(target);
  }

  private focusIsInside(): boolean {
    return this.containsEventTarget(document.activeElement);
  }

  private isCoarsePointer(): boolean {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  }

  private focusCalendar(): void {
    if (!this.isBrowser || !this.isOpen()) {
      return;
    }

    window.requestAnimationFrame(() => {
      this.calendar()?.nativeElement.focus({ target: 'day', preventScroll: true });
    });
  }
}
