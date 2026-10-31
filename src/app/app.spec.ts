import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideAppTranslations } from './i18n/provide-app-translations';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.removeItem('ricordo.language');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideAppTranslations()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show the photo picker', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('ricordo');
    expect(compiled.textContent).toContain('Choose a photo');
    expect(compiled.textContent).toContain('Download');
  });
});
