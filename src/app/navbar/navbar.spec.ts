import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EditDrawer } from '../editor/edit-drawer';
import { ProjectActions } from '../editor/project-actions';
import { provideAppTranslations } from '../i18n/provide-app-translations';
import { Navbar } from './navbar';

describe('Navbar', () => {
  let component: Navbar;
  let fixture: ComponentFixture<Navbar>;

  beforeEach(async () => {
    localStorage.removeItem('ricordo.language');
    await TestBed.configureTestingModule({
      imports: [Navbar],
      providers: [provideRouter([]), provideAppTranslations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Navbar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the app name as the home link', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const home = compiled.querySelector('a');

    expect(compiled.querySelector('h1')?.textContent).toContain('ricordo');
    expect(home?.getAttribute('href')).toBe('/');
    expect(home?.getAttribute('aria-current')).toBe('page');
  });

  it('places the language control before the edits button', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const language = compiled.querySelector('app-language-menu');
    const menu = compiled.querySelector('.menu');

    expect(language?.nextElementSibling).toBe(menu);
  });

  it('keeps export disabled until there is a photo to save', () => {
    const exportProject = button(fixture, 'Export project');
    const openProject = button(fixture, 'Open project');

    const compiled = fixture.nativeElement as HTMLElement;
    const language = compiled.querySelector('app-language-menu');

    expect(exportProject.disabled).toBe(true);
    expect(openProject.disabled).toBe(false);
    expect(compiled.querySelector('.brand')?.nextElementSibling).toBe(openProject.parentElement);
    expect(
      openProject.compareDocumentPosition(exportProject) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(language).toBeTruthy();
    if (language) {
      expect(
        openProject.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('asks the editor to export and open a project', () => {
    const actions = TestBed.inject(ProjectActions);
    actions.canExport.set(true);
    fixture.detectChanges();

    button(fixture, 'Export project').click();
    button(fixture, 'Open project').click();

    expect(actions.exportRequest()).toBe(1);
    expect(actions.openRequest()).toBe(1);
  });

  it('opens the edits dialog from the menu button', () => {
    const drawer = TestBed.inject(EditDrawer);
    const menu = fixture.nativeElement.querySelector('.menu') as HTMLButtonElement;

    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe('edits-dialog');

    menu.click();
    fixture.detectChanges();

    expect(drawer.open()).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
  });
});

function button(fixture: ComponentFixture<Navbar>, name: string): HTMLButtonElement {
  const match = [...fixture.nativeElement.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === name,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${name} button`);
  }
  return match;
}
