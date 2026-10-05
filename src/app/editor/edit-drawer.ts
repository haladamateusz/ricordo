import { Service, signal } from '@angular/core';

const mobileEditsQuery = '(max-width: 640px)';

@Service()
export class EditDrawer {
  readonly open = signal(false);

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(mobileEditsQuery);
    query.addEventListener('change', () => {
      if (!query.matches) {
        this.open.set(false);
      }
    });
  }

  show(): void {
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }
}
