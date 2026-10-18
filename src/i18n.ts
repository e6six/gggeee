import type { SupportedLang } from './yandex/sdk';

/** Строки интерфейса. Этап 4: вынести в JSON и подключить все экраны. */
export const STRINGS = {
  ru: {
    title: 'Пасьянс-путешествие',
    subtitle: 'TriPeaks · этап 0: скелет проекта',
    tapToStart: 'Нажмите, чтобы начать',
    mockNote: 'SDK не найден: локальный режим (моки рекламы и сохранений)',
  },
  en: {
    title: 'Solitaire Journey',
    subtitle: 'TriPeaks · stage 0: project skeleton',
    tapToStart: 'Tap to start',
    mockNote: 'SDK not found: local mode (mocked ads & saves)',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['ru'];

let current: SupportedLang = 'ru';

export function setLang(lang: SupportedLang): void {
  current = lang;
}

export function t(key: StringKey): string {
  return STRINGS[current][key];
}
