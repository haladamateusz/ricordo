import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, Service, effect, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

import { setCaptionLocale } from '../editor/date-picker';
import {
  dateLocales,
  readStoredLanguage,
  storeLanguage,
  type LanguageId,
} from './languages';

@Service()
export class AppLanguage {
  private readonly transloco = inject(TranslocoService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly id = signal<LanguageId>(this.isBrowser ? readStoredLanguage() : 'en');

  constructor() {
    this.apply(this.id());
    effect(() => this.apply(this.id()));
  }

  private apply(id: LanguageId): void {
    this.transloco.setActiveLang(id);
    setCaptionLocale(dateLocales[id]);
    if (!this.isBrowser) {
      return;
    }

    document.documentElement.lang = id;
    storeLanguage(id);
  }

  select(id: LanguageId): void {
    this.id.set(id);
  }
}
