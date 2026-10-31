import {
  EnvironmentProviders,
  Injectable,
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { provideTransloco, TranslocoLoader, TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';

import { AppLanguage } from './app-language';
import { catalog } from './catalog';
import { languageIds, type LanguageId } from './languages';

@Injectable()
class InlineTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string) {
    return of(catalog[lang as LanguageId] ?? catalog.en);
  }
}

export function provideAppTranslations(): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...provideTransloco({
      config: {
        availableLangs: [...languageIds],
        defaultLang: 'en',
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: {
          logMissingKey: false,
          useFallbackTranslation: true,
        },
      },
      loader: InlineTranslocoLoader,
    }),
    provideAppInitializer(() => {
      const transloco = inject(TranslocoService);
      for (const id of languageIds) {
        transloco.setTranslation(catalog[id], id);
      }
      inject(AppLanguage);
    }),
  ]);
}
