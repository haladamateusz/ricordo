import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EditDrawer } from '../editor/edit-drawer';

@Component({
  imports: [RouterLink],
  selector: 'app-navbar',
  styleUrl: './navbar.css',
  templateUrl: './navbar.html',
})
export class Navbar {
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private wasOpen = false;

  protected readonly drawer = inject(EditDrawer);

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
