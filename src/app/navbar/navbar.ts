import { Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

import { EditDrawer } from '../editor/edit-drawer';
import { LanguageMenu } from './language-menu';

@Component({
  imports: [RouterLink, LanguageMenu, TranslocoPipe],
  selector: 'app-navbar',
  styleUrl: './navbar.css',
  templateUrl: './navbar.html',
  host: {
    '[class.is-language-open]': 'languageSheetOpen()',
  },
})
export class Navbar {
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly languageMenu = viewChild(LanguageMenu);
  private wasOpen = false;

  protected readonly drawer = inject(EditDrawer);
  protected readonly languageSheetOpen = computed(() => this.languageMenu()?.sheetOpen() ?? false);

  constructor() {
    effect(() => {
      const open = this.drawer.open();
      if (this.wasOpen && !open) {
        this.menuButton()?.nativeElement.focus();
      }
      this.wasOpen = open;
    });
  }
}
