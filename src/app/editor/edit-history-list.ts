import {
  afterRenderEffect,
  Component,
  DestroyRef,
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
    '(document:pointermove)': 'onReorderPointerMove($event)',
    '(document:pointerup)': 'onReorderPointerUp($event)',
    '(document:pointercancel)': 'onReorderPointerUp($event)',
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
  readonly reordered = output<void>();

  protected readonly tab = signal<'history' | 'current'>('history');
  protected readonly switching = signal(false);
  protected readonly drawer = inject(EditDrawer);
  protected readonly history = inject(EditHistory);
  protected readonly session = inject(CurrentSession);
  protected readonly formatDate = formatCaptionDate;
  protected readonly failedThumbs = signal<ReadonlySet<string>>(new Set());
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly draggingId = signal<string | null>(null);
  protected readonly draggingIds = signal<readonly string[]>([]);
  protected readonly reorderStatus = signal('');
  private readonly dragTop = signal<number | null>(null);
  private reorder: ReorderDrag | null = null;
  private clickStop: ((event: Event) => void) | null = null;
  private clickTimer = 0;
  private scrollFrame = 0;
  private pointerY = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.scrollFrame);
      this.clearSwallowedClick();
    });
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

  protected sortOldest(): void {
    const scroll = this.currentScroll()?.nativeElement;
    const changed = this.session.sortByDate();
    if (scroll && changed) {
      scroll.scrollTop = 0;
    }
    this.reorderStatus.set(
      changed
        ? 'Current edits sorted from oldest to newest.'
        : 'Current edits are already oldest first.',
    );
    if (changed) {
      this.reordered.emit();
    }
  }

  protected choose(edit: StoredEdit): void {
    this.selected.emit(edit);
    this.drawer.close();
  }

  protected chooseCurrent(event: MouseEvent, edit: CurrentEdit): void {
    if (this.modifierSelect(event, edit)) {
      return;
    }
    this.picked.set(new Set());
    this.currentSelected.emit(edit);
    this.drawer.close();
  }

  protected onGripClick(event: MouseEvent, edit: CurrentEdit): void {
    this.modifierSelect(event, edit);
  }

  protected isPicked(id: string): boolean {
    return this.picked().has(id);
  }

  protected isDragged(id: string): boolean {
    return this.draggingIds().includes(id);
  }

  protected pickedLabel(edit: CurrentEdit): string {
    return this.isPicked(edit.id) ? `${this.rowLabel(edit)}, selected` : this.rowLabel(edit);
  }

  protected currentKey(index: number): string {
    return this.session.edits()[index]?.id ?? String(index);
  }

  protected currentTransform(start: number, id: string): string {
    const ids = this.draggingIds();
    const index = ids.indexOf(id);
    const top = this.dragTop();
    if (index >= 0 && top !== null) {
      const anchor = ids.indexOf(this.draggingId() ?? '');
      const offset = (index - (anchor < 0 ? 0 : anchor)) * historyRowHeight;
      return `translateY(${top + offset}px)`;
    }
    return `translateY(${start}px)`;
  }

  protected onReorderPointerDown(event: PointerEvent, edit: CurrentEdit): void {
    if (event.button !== 0 || this.reorder || this.session.edits().length < 2) {
      return;
    }
    const row = event.currentTarget;
    if (!(row instanceof HTMLElement)) {
      return;
    }

    this.reorder = {
      id: edit.id,
      ids: [edit.id],
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabOffset: event.clientY - row.getBoundingClientRect().top,
      moved: false,
      changed: false,
    };
  }

  protected onReorderPointerMove(event: PointerEvent): void {
    const drag = this.reorder;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) {
      return;
    }

    if (!drag.moved) {
      drag.ids = this.dragIds(drag.id);
      this.draggingIds.set(drag.ids);
    }
    drag.moved = true;
    if (event.cancelable) {
      event.preventDefault();
    }
    this.draggingId.set(drag.id);
    this.pointerY = event.clientY;
    this.placeDragged(event.clientY);
    this.queueEdgeScroll();
  }

  protected onReorderPointerUp(event: PointerEvent): void {
    const drag = this.reorder;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    if (drag.moved) {
      this.swallowFollowingClick();
      if (drag.changed) {
        this.announceMove(drag.ids);
        this.reordered.emit();
      }
    }
    this.finishReorder();
  }

  protected onReorderKey(event: KeyboardEvent, edit: CurrentEdit): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    const ids = this.dragIds(edit.id);
    const index = this.session.edits().findIndex((item) => item.id === edit.id);
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    const moved =
      ids.length > 1
        ? this.session.moveGroup(ids, edit.id, target)
        : this.session.move(edit.id, target);
    if (!moved) {
      return;
    }
    this.announceMove(ids);
    this.reordered.emit();
  }

  private placeDragged(clientY: number): void {
    const drag = this.reorder;
    const scroll = this.currentScroll()?.nativeElement;
    if (!drag || !scroll) {
      return;
    }

    const contentY = clientY - scroll.getBoundingClientRect().top + scroll.scrollTop;
    const top = contentY - drag.grabOffset;
    this.dragTop.set(top);
    const count = this.session.edits().length;
    const target = Math.min(
      count - 1,
      Math.max(0, Math.floor((top + historyRowHeight / 2) / historyRowHeight)),
    );
    const moved =
      drag.ids.length > 1
        ? this.session.moveGroup(drag.ids, drag.id, target)
        : this.session.move(drag.id, target);
    if (moved) {
      drag.changed = true;
    }
  }

  private queueEdgeScroll(): void {
    if (this.scrollFrame) {
      return;
    }
    const tick = (): void => {
      this.scrollFrame = 0;
      const drag = this.reorder;
      const scroll = this.currentScroll()?.nativeElement;
      if (!drag?.moved || !scroll) {
        return;
      }
      const rect = scroll.getBoundingClientRect();
      const edge = 28;
      if (rect.height < edge * 2) {
        return;
      }
      const delta =
        this.pointerY < rect.top + edge ? -12 : this.pointerY > rect.bottom - edge ? 12 : 0;
      if (delta === 0 || scroll.scrollHeight <= scroll.clientHeight) {
        return;
      }
      scroll.scrollTop += delta;
      this.placeDragged(this.pointerY);
      this.scrollFrame = requestAnimationFrame(tick);
    };
    this.scrollFrame = requestAnimationFrame(tick);
  }

  private dragIds(anchorId: string): readonly string[] {
    const picked = this.session
      .edits()
      .filter((edit) => this.picked().has(edit.id))
      .map((edit) => edit.id);
    return picked.includes(anchorId) && picked.length > 1 ? picked : [anchorId];
  }

  private modifierSelect(event: MouseEvent, edit: CurrentEdit): boolean {
    if (!event.metaKey && !event.ctrlKey) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    this.togglePicked(edit.id);
    return true;
  }

  private togglePicked(id: string): void {
    const edit = this.session.find(id);
    if (!edit) {
      return;
    }
    const activeId = this.session.activeId();
    const next = new Set(this.picked());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    const others = [...next].some((pickedId) => pickedId !== activeId);
    if (activeId && others) {
      next.add(activeId);
    } else if (activeId && id !== activeId) {
      next.delete(activeId);
    }
    this.picked.set(next);
    const label = this.rowLabel(edit);
    const status = next.has(id)
      ? `${label} selected. ${next.size} selected.`
      : `${label} unselected. ${next.size} selected.`;
    this.reorderStatus.set(status);
  }

  private announceMove(ids: readonly string[]): void {
    const edits = this.session.edits();
    if (ids.length > 1) {
      const indexes = ids
        .map((id) => edits.findIndex((edit) => edit.id === id))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right);
      const first = indexes[0];
      const last = indexes[indexes.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      this.reorderStatus.set(
        `${ids.length} edits moved together to positions ${first + 1} through ${last + 1}.`,
      );
      return;
    }

    const index = edits.findIndex((edit) => edit.id === ids[0]);
    const edit = edits[index];
    if (!edit) {
      return;
    }
    this.reorderStatus.set(
      `${this.rowLabel(edit)} moved to position ${index + 1} of ${edits.length}.`,
    );
  }

  private swallowFollowingClick(): void {
    this.clearSwallowedClick();
    const stopClick = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      this.clearSwallowedClick();
    };
    this.clickStop = stopClick;
    this.host.nativeElement.addEventListener('click', stopClick, true);
    this.clickTimer = window.setTimeout(() => this.clearSwallowedClick(), 0);
  }

  private clearSwallowedClick(): void {
    window.clearTimeout(this.clickTimer);
    this.clickTimer = 0;
    if (!this.clickStop) {
      return;
    }
    this.host.nativeElement.removeEventListener('click', this.clickStop, true);
    this.clickStop = null;
  }

  private finishReorder(): void {
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    this.reorder = null;
    this.draggingId.set(null);
    this.draggingIds.set([]);
    this.dragTop.set(null);
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
      if (this.reorder?.changed) {
        this.reordered.emit();
      }
      this.finishReorder();
      this.drawer.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const focusable = [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>('button, a[href], input'),
    ].filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
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

interface ReorderDrag {
  id: string;
  ids: readonly string[];
  pointerId: number;
  startX: number;
  startY: number;
  grabOffset: number;
  moved: boolean;
  changed: boolean;
}
