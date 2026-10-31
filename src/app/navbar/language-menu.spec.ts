import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditDrawer } from '../editor/edit-drawer';
import { provideAppTranslations } from '../i18n/provide-app-translations';
import { LanguageMenu } from './language-menu';

describe('LanguageMenu', () => {
  describe('on a desktop', () => {
    let fixture: ComponentFixture<LanguageMenu>;

    beforeEach(async () => {
      mockMatchMedia(false);
      localStorage.removeItem('ricordo.language');
      await TestBed.configureTestingModule({
        imports: [LanguageMenu],
        providers: [provideAppTranslations()],
      }).compileComponents();

      fixture = TestBed.createComponent(LanguageMenu);
      TestBed.inject(EditDrawer).close();
      await fixture.whenStable();
    });

    it('shows English as the current language', () => {
      expect(trigger(fixture).textContent).toContain('EN');
      expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
      expect(trigger(fixture).getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger(fixture).getAttribute('aria-label')).toBe('Choose language, English');
      expect(panel(fixture)).toBeNull();
    });

    it('opens a menu of the five languages', async () => {
      await openMenu(fixture);

      expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
      expect(options(fixture).map((option) => option.textContent?.trim())).toEqual([
        'Polski',
        'Italiano',
        'Deutsch',
        'English',
        'Rumantsch',
      ]);
      expect(options(fixture)[3]?.getAttribute('aria-checked')).toBe('true');
      expect(options(fixture)[3]?.getAttribute('lang')).toBe('en');
      expect(document.activeElement).toBe(options(fixture)[3]);
    });

    it('updates the button when a language is chosen', async () => {
      await openMenu(fixture);
      options(fixture)[1]?.click();
      fixture.detectChanges();

      expect(panel(fixture)).toBeNull();
      expect(trigger(fixture).textContent).toContain('IT');
      expect(trigger(fixture).getAttribute('aria-label')).toBe('Scegli la lingua, Italiano');
      expect(document.activeElement).toBe(trigger(fixture));

      await openMenu(fixture);
      expect(options(fixture)[1]?.getAttribute('aria-checked')).toBe('true');
      expect(options(fixture)[1]?.getAttribute('lang')).toBe('it');
    });

    it('closes from the keyboard and from a click outside', async () => {
      await openMenu(fixture);
      options(fixture)[3]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      expect(document.activeElement).toBe(options(fixture)[4]);

      options(fixture)[4]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();

      expect(panel(fixture)).toBeNull();
      expect(document.activeElement).toBe(trigger(fixture));

      await openMenu(fixture);
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      fixture.detectChanges();

      expect(panel(fixture)).toBeNull();
    });
  });

  describe('on a phone', () => {
    let fixture: ComponentFixture<LanguageMenu>;

    beforeEach(async () => {
      mockMatchMedia(true);
      localStorage.removeItem('ricordo.language');
      await TestBed.configureTestingModule({
        imports: [LanguageMenu],
        providers: [provideAppTranslations()],
      }).compileComponents();

      fixture = TestBed.createComponent(LanguageMenu);
      TestBed.inject(EditDrawer).close();
      await fixture.whenStable();
    });

    it('keeps a hidden sheet ready behind the button', () => {
      expect(trigger(fixture).getAttribute('aria-haspopup')).toBe('dialog');
      expect(panel(fixture)?.classList.contains('is-open')).toBe(false);
      expect(panel(fixture)?.getAttribute('aria-hidden')).toBe('true');
      expect(panel(fixture)?.getAttribute('role')).toBeNull();
    });

    it('opens the same full-screen sheet as edits', async () => {
      await openMenu(fixture);

      expect(panel(fixture)?.getAttribute('role')).toBe('dialog');
      expect(panel(fixture)?.getAttribute('aria-modal')).toBe('true');
      expect(panel(fixture)?.classList.contains('is-open')).toBe(true);
      expect(fixture.nativeElement.querySelector('.title')?.textContent).toBe('Language');
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.close'));
      expect(options(fixture).map((option) => option.getAttribute('role'))).toEqual([
        'option',
        'option',
        'option',
        'option',
        'option',
      ]);
      expect(options(fixture)[3]?.getAttribute('aria-selected')).toBe('true');
    });

    it('closes the edits sheet before showing languages', async () => {
      const drawer = TestBed.inject(EditDrawer);
      drawer.show();

      await openMenu(fixture);

      expect(drawer.open()).toBe(false);
      expect(panel(fixture)?.classList.contains('is-open')).toBe(true);
    });

    it('closes from the close button, a choice, and escape', async () => {
      await openMenu(fixture);
      (fixture.nativeElement.querySelector('.close') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(panel(fixture)?.classList.contains('is-open')).toBe(false);
      expect(document.activeElement).toBe(trigger(fixture));

      await openMenu(fixture);
      options(fixture)[0]?.click();
      fixture.detectChanges();

      expect(panel(fixture)?.classList.contains('is-open')).toBe(false);
      expect(trigger(fixture).textContent).toContain('PL');

      await openMenu(fixture);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(panel(fixture)?.classList.contains('is-open')).toBe(false);
      expect(document.activeElement).toBe(trigger(fixture));
    });
  });
});

function trigger(fixture: ComponentFixture<LanguageMenu>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement;
}

function panel(fixture: ComponentFixture<LanguageMenu>): HTMLElement | null {
  return fixture.nativeElement.querySelector('.panel');
}

function options(fixture: ComponentFixture<LanguageMenu>): HTMLButtonElement[] {
  return [...fixture.nativeElement.querySelectorAll('.option')] as HTMLButtonElement[];
}

async function openMenu(fixture: ComponentFixture<LanguageMenu>): Promise<void> {
  trigger(fixture).click();
  fixture.detectChanges();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
