import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';

import { TranslocoPipe } from '@jsverse/transloco';

import { EditDrawer } from '../editor/edit-drawer';
import { AppLanguage } from '../i18n/app-language';
import { languages, type LanguageId } from '../i18n/languages';

const phoneQuery = '(max-width: 640px)';

@Component({
  selector: 'app-language-menu',
  imports: [TranslocoPipe],
  templateUrl: './language-menu.html',
  styleUrl: './language-menu.css',
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class LanguageMenu {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly drawer = inject(EditDrawer);
  protected readonly appLanguage = inject(AppLanguage);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly options = viewChildren<ElementRef<HTMLButtonElement>>('option');

  protected readonly languages = languages;
  protected readonly isOpen = signal(false);
  protected readonly compact = signal(false);
  protected readonly current = computed(
    () =>
      this.languages.find((language) => language.id === this.appLanguage.id()) ?? this.languages[3],
  );
  readonly sheetOpen = computed(() => this.compact() && this.isOpen());

  constructor() {
    effect(() => {
      if (this.drawer.open()) {
        this.close();
      }
    });

    afterRenderEffect(() => {
      if (!this.isOpen()) {
        return;
      }

      untracked(() => this.focusOpened());
    });

    if (!this.isBrowser || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia(phoneQuery);
    this.compact.set(query.matches);
    const onChange = () => this.compact.set(query.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }

  protected toggle(): void {
    if (this.isOpen()) {
      this.close();
      return;
    }

    this.open();
  }

  protected dismiss(): void {
    this.close();
    this.focusTrigger();
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.open();
        break;
      case 'Escape':
        if (this.isOpen()) {
          event.preventDefault();
          this.dismiss();
        }
        break;
    }
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = this.options();
    const current = items.findIndex((item) => item.nativeElement === document.activeElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusOption(items, current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusOption(items, current - 1);
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.nativeElement.focus();
        break;
      case 'End':
        event.preventDefault();
        items.at(-1)?.nativeElement.focus();
        break;
      case 'Escape':
        event.preventDefault();
        this.dismiss();
        break;
      case 'Tab':
        if (this.compact()) {
          return;
        }
        event.preventDefault();
        this.dismiss();
        break;
    }
  }

  protected select(id: LanguageId): void {
    this.appLanguage.select(id);
    this.dismiss();
  }

  protected onDocumentPointerDown(event: PointerEvent): void {
    if (!this.isOpen() || this.compact()) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && this.elementRef.nativeElement.contains(target)) {
      return;
    }

    this.close();
  }

  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.isOpen()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismiss();
      return;
    }

    if (!this.compact() || event.key !== 'Tab') {
      return;
    }

    const panel = this.panel()?.nativeElement;
    if (!panel) {
      return;
    }

    const focusable = [...panel.querySelectorAll<HTMLElement>('button')].filter(
      (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }

    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private open(): void {
    if (this.compact()) {
      this.drawer.close();
    }

    this.isOpen.set(true);
  }

  private close(): void {
    this.isOpen.set(false);
  }

  private focusOpened(): void {
    if (!this.isOpen()) {
      return;
    }

    if (this.compact()) {
      this.closeButton()?.nativeElement.focus();
      return;
    }

      const selected = this.options().find(
        (option) => option.nativeElement.dataset['lang'] === this.appLanguage.id(),
      );
    (selected ?? this.options()[0])?.nativeElement.focus();
  }

  private focusTrigger(): void {
    this.trigger()?.nativeElement.focus();
  }

  private focusOption(items: readonly ElementRef<HTMLButtonElement>[], index: number): void {
    if (items.length === 0) {
      return;
    }

    const next = (index + items.length) % items.length;
    items[next]?.nativeElement.focus();
  }
}
