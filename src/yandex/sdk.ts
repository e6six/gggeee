/**
 * Обёртка над Яндекс Games SDK.
 *
 * Принципы (см. docs/yandex-requirements-checklist.md):
 * - Игра НЕ должна падать без SDK: локально / в превью YaGames отсутствует,
 *   тогда используются моки и игра работает на localStorage.
 * - LoadingAPI.ready() вызывается ровно один раз, когда игра готова
 *   принимать ввод (не раньше).
 * - Авторизация — только по явному нажатию кнопки игроком, всегда
 *   доступен гостевой вход.
 * - Язык определяется через SDK (features / i18n), а не по navigator.
 */

// Минимальные типы используемой части SDK (полные типы платформа не поставляет).
interface YandexPlayer {
  getMode(): string;
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
  getName(): string;
  getUniqueID(): string;
}

interface YandexSDK {
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  adv: {
    showFullscreenAdv(opts?: {
      callbacks?: { onClose?: () => void; onError?: () => void };
    }): void;
    showRewardedVideo(opts?: {
      callbacks?: {
        onOpen?: () => void;
        onRewarded?: () => void;
        onClose?: () => void;
        onError?: () => void;
      };
    }): void;
  };
  getPlayer(opts?: { scopes?: boolean }): Promise<YandexPlayer>;
  payments?: unknown;
  environment: {
    i18n: { lang: string; tld: string };
    app: { id: string };
    browser: { lang: string };
    payload?: string;
  };
  deviceInfo: {
    isMobile(): boolean;
    isDesktop(): boolean;
    isTablet(): boolean;
    isTV(): boolean;
  };
}

declare global {
  interface Window {
    YaGames?: {
      init(): Promise<YandexSDK>;
    };
  }
}

export type SupportedLang = 'ru' | 'en';

let sdk: YandexSDK | null = null;
let readyCalled = false;

/** Доступен ли настоящий SDK (false = локальная разработка на моках). */
export function isSdkAvailable(): boolean {
  return sdk !== null;
}

/** Инициализация SDK. Безопасно вызывать при отсутствии YaGames. */
export async function initSdk(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.YaGames) {
    console.info('[yandex] YaGames не найден — режим локальных моков');
    return false;
  }
  try {
    sdk = await window.YaGames.init();
    return true;
  } catch (err) {
    console.warn('[yandex] Ошибка инициализации SDK, работаем на моках', err);
    sdk = null;
    return false;
  }
}

/**
 * LoadingAPI.ready() — сообщить платформе, что игра загрузилась и готова.
 * Вызывать один раз из BootScene после загрузки ассетов.
 */
export function gameReady(): void {
  if (readyCalled) return;
  readyCalled = true;
  sdk?.features.LoadingAPI?.ready();
}

/** Начало/конец геймплея для аналитики платформы. */
export function gameplayStart(): void {
  sdk?.features.GameplayAPI?.start();
}

export function gameplayStop(): void {
  sdk?.features.GameplayAPI?.stop();
}

/** Язык из SDK → поддерживаемый игрой. Fallback: 'ru'. */
export function detectLang(): SupportedLang {
  const lang = sdk?.environment.i18n.lang ?? '';
  return lang.toLowerCase().startsWith('en') ? 'en' : 'ru';
}

/**
 * Полноэкранная реклама. Игра и звук должны быть на паузе на время показа —
 * паузу ставит вызывающий код (см. GameScene / Audio manager, этап 4).
 * Возвращает Promise, который резолвится при закрытии или ошибке показа.
 */
export function showFullscreenAd(): Promise<void> {
  return new Promise((resolve) => {
    if (!sdk) {
      console.info('[yandex:mock] fullscreen adv');
      resolve();
      return;
    }
    sdk.adv.showFullscreenAdv({
      callbacks: { onClose: () => resolve(), onError: () => resolve() },
    });
  });
}

/**
 * Rewarded video. Вознаграждение — ТОЛЬКО бонус (п. требований 4.5.2):
 * +5 карт, отмена хода, удвоение монет. Никогда — условие продолжения.
 * Резолвится true, только если награда действительно заработана.
 */
export function showRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!sdk) {
      console.info('[yandex:mock] rewarded adv -> reward granted (mock)');
      resolve(true);
      return;
    }
    let rewarded = false;
    sdk.adv.showRewardedVideo({
      callbacks: {
        onRewarded: () => {
          rewarded = true;
        },
        onClose: () => resolve(rewarded),
        onError: () => resolve(false),
      },
    });
  });
}

// --- Сохранения ------------------------------------------------------------

const LS_KEY = 'solitaire-journey.save.v1';

/**
 * Загрузка прогресса: player.getData() при авторизации, иначе localStorage.
 * Прогресс не должен теряться после перезагрузки (требование платформы).
 */
export async function loadSave<T>(fallback: T): Promise<T> {
  if (sdk) {
    try {
      const player = await sdk.getPlayer({ scopes: false });
      const data = await player.getData(['save']);
      if (data && typeof data === 'object' && 'save' in data) {
        return data.save as T;
      }
    } catch {
      /* гость или SDK недоступен — падаем на localStorage */
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* повреждённый сейв — начинаем с fallback */
  }
  return fallback;
}

/** Сохранение прогресса: дублируем в localStorage как офлайн-кэш. */
export async function storeSave(save: unknown): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(save));
  } catch {
    /* переполнен/недоступен localStorage — не критично */
  }
  if (sdk) {
    try {
      const player = await sdk.getPlayer({ scopes: false });
      await player.setData({ save }, true);
    } catch {
      /* гостевой режим: остаёмся на localStorage */
    }
  }
}
