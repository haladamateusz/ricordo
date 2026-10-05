import {
  afterRenderEffect,
  Component,
  ElementRef,
  inject,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { injectVirtualizer } from '@tanstack/angular-virtual';

import { CurrentSession, type CurrentEdit } from './current-session';
import { formatCaptionDate } from './date-picker';
import { EditDrawer } from './edit-drawer';
import { EditHistory, type StoredEdit } from './edit-history';

export const historyRowHeight = 88;

@Component({
  selector: 'app-edit-history-list',
  templateUrl: './edit-history-list.html',
  styleUrl: './edit-history-list.css',
  host: {
    id: 'edits-dialog',
    'aria-label': 'Edits',
    '[attr.role]': 'drawer.open() ? "dialog" : "region"',
    '[attr.aria-modal]': 'drawer.open() ? "true" : null',
    '[class.is-switching]': 'switching()',
    '[class.is-open]': 'drawer.open()',
    '(click)': 'onBackdrop($event)',
    '(document:keydown)': 'onDialogKey($event)',
  },
})
export class EditHistoryList {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly historyScroll = viewChild<ElementRef<HTMLDivElement>>('historyScroll');
  private readonly currentScroll = viewChild<ElementRef<HTMLDivElement>>('currentScroll');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  readonly selected = output<StoredEdit>();
  readonly currentSelected = output<CurrentEdit>();

  protected readonly tab = signal<'history' | 'current'>('history');
  protected readonly switching = signal(false);
  protected readonly drawer = inject(EditDrawer);
  protected readonly history = inject(EditHistory);
  protected readonly session = inject(CurrentSession);
  protected readonly formatDate = formatCaptionDate;
  protected readonly failedThumbs = signal<ReadonlySet<string>>(new Set());

  constructor() {
    afterRenderEffect(() => {
      const id = this.session.activeId();
      if (this.tab() !== 'current' || !id) {
        return;
      }
      untracked(() => {
        const scroll = this.currentScroll()?.nativeElement;
        if (scroll && this.session.edits()[0]?.id === id) {
          scroll.scrollTop = 0;
        }
      });
    });

    afterRenderEffect(() => {
      if (!this.drawer.open()) {
        return;
      }
      untracked(() => this.closeButton()?.nativeElement.focus());
    });
  }

  protected readonly historyVirtualizer = injectVirtualizer(() => ({
    scrollElement: this.historyScroll(),
    count: this.history.edits().length,
    estimateSize: () => historyRowHeight,
    overscan: 4,
  }));

  protected readonly currentVirtualizer = injectVirtualizer(() => ({
    scrollElement: this.currentScroll(),
    count: this.session.edits().length,
    estimateSize: () => historyRowHeight,
    overscan: 4,
  }));

  protected captionPreview(caption: string): string {
    const previewLength = 20;
    if (caption.length <= previewLength) {
      return caption;
    }
    return `${caption.slice(0, previewLength)}...`;
  }

  protected rowLabel(edit: { rightCaption: string; date: string }): string {
    const caption = edit.rightCaption.trim() || 'No caption';
    const date = this.formatDate(edit.date) || 'No date';
    return `${caption}, ${date}`;
  }

  showCurrent(): void {
    this.show('current');
  }

  protected show(tab: 'history' | 'current'): void {
    if (tab === this.tab()) {
      return;
    }
    this.switching.set(true);
    this.tab.set(tab);
  }

  protected onTabKey(event: KeyboardEvent): void {
    const tabs = ['history', 'current'] as const;
    const index = this.tab() === 'history' ? 0 : 1;
    const nextIndex =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (nextIndex < 0) {
      return;
    }
    event.preventDefault();
    this.show(tabs[nextIndex]);
    this.tabButtons()[nextIndex]?.nativeElement.focus();
  }

  protected choose(edit: StoredEdit): void {
    this.selected.emit(edit);
    this.drawer.close();
  }

  protected chooseCurrent(edit: CurrentEdit): void {
    this.currentSelected.emit(edit);
    this.drawer.close();
  }

  protected onBackdrop(event: Event): void {
    if (event.target === event.currentTarget) {
      this.drawer.close();
    }
  }

  protected onDialogKey(event: KeyboardEvent): void {
    if (!this.drawer.open()) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.drawer.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const focusable = [...this.host.nativeElement.querySelectorAll<HTMLElement>('button, a[href], input')].filter(
      (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.host.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected hideThumb(id: string): void {
    this.failedThumbs.update((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }
}
