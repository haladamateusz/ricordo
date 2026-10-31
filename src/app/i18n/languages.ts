export const languageIds = ['pl', 'it', 'de', 'en', 'rm'] as const;

export type LanguageId = (typeof languageIds)[number];

export const languages = [
  { id: 'pl', code: 'PL', label: 'Polski' },
  { id: 'it', code: 'IT', label: 'Italiano' },
  { id: 'de', code: 'DE', label: 'Deutsch' },
  { id: 'en', code: 'EN', label: 'English' },
  { id: 'rm', code: 'RM', label: 'Rumantsch' },
] as const;

export const dateLocales: Record<LanguageId, string> = {
  pl: 'pl',
  it: 'it',
  de: 'de',
  en: 'en-GB',
  rm: 'rm',
};

const storageKey = 'ricordo.language';

export function isLanguageId(value: string): value is LanguageId {
  return languageIds.some((id) => id === value);
}

export function readStoredLanguage(): LanguageId {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && isLanguageId(stored)) {
      return stored;
    }
  } catch {
    // Storage can be blocked. English remains the default.
  }

  return 'en';
}

export function storeLanguage(id: LanguageId): void {
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // The choice still applies for this visit.
  }
}

export function pluralForm(language: string, count: number): 'one' | 'few' | 'other' {
  if (language !== 'pl') {
    return count === 1 ? 'one' : 'other';
  }

  const mod10 = count % 10;
  const mod100 = count % 100;
  if (count === 1) {
    return 'one';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'few';
  }
  return 'other';
}
