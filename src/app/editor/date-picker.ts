import { isPlatformBrowser } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';

interface CalendarDateElement extends HTMLElement {
  value: string;
  focus(options?: FocusOptions & { target?: 'day' | 'next' | 'previous' }): void;
}

const earliestYear = 2017;

export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function selectableYearCount(latestYear: number): number {
  return Math.max(latestYear - earliestYear, 0) * 2 + 1;
}

const captionDateFormat = new Intl.DateTimeFormat('pl', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatCaptionDate(value: string): string {
  const date = parseLocalDateValue(value);

  if (!date) {
    return '';
  }

  return captionDateFormat.format(date);
}

export function captionDateTime(value: string): number | null {
  return parseLocalDateValue(value)?.getTime() ?? null;
}

export function keepCaptionTime(nextDate: string, current: string): string {
  const time = captionClock(current);
  return time ? `${nextDate}T${time}` : nextDate;
}

export const longestCaptionDate = formatCaptionDate('2025-10-31');

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
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly calendar = viewChild<ElementRef<CalendarDateElement>>('calendar');
  private pointerInside = false;

  readonly value = model.required<string>();
  readonly disabled = model(false);
  readonly controlId = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly touch = output<void>();

  protected readonly earliestDate = `${earliestYear}-01-01`;
  protected readonly isOpen = signal(false);
  protected readonly isCalendarReady = signal(false);
  protected readonly maxDate = signal(toLocalIsoDate(new Date()));
  protected readonly yearCount = signal(selectableYearCount(new Date().getFullYear()));
  protected readonly panelId = computed(() => `${this.controlId()}-dialog`);
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

    // Month buttons and the year menu live in the calendar shadow tree.
    // WebKit reports that focus move with a null relatedTarget, which used
    // to dismiss the dialog before the month or year could change.
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
  }

  private open(): void {
    if (this.disabled()) {
      return;
    }

    const today = new Date();
    this.maxDate.set(toLocalIsoDate(today));
    this.yearCount.set(selectableYearCount(today.getFullYear()));
    this.isOpen.set(true);
    this.focusCalendar();
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
