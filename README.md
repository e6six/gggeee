# Пасьянс-путешествие (рабочее название)

TriPeaks-пасьянс с картой путешествия для **Яндекс Игр**: процедурные гарантированно проходимые уровни, звёзды и регионы, гибридная монетизация (rewarded только бонусами + инапы). Аудитория — 45+, управление одним тапом.

**Стек:** Phaser 4.2.1 + TypeScript + Vite (~500 КБ фреймворк — быстрая первая загрузка).

## Быстрый старт

```bash
npm install
npm run dev          # http://localhost:5173 — игра стартует на моках SDK
npm run build        # проверка типов + сборка в dist/
npm run check:size   # требования архива: index.html в корне, ≤100 МБ, имена без пробелов/кириллицы
```

Локальная разработка «как на платформе» — через официальный dev-proxy Яндекса (реклама, авторизация и сохранения подменяются):

```bash
npm run dev:yandex   # @yandex-games/sdk-dev-proxy --dev-mode=true
```

## Как устроен запуск

- `index.html` (корень проекта) подключает `/sdk.js`; при публикации его отдаёт платформа, локально — dev-proxy.
- В обычном `npm run dev` SDK отсутствует, и `src/yandex/sdk.ts` работает на моках: игра не падает без `YaGames`, сохранения идут в localStorage, rewarded «выдаёт» награду в консоль.
- `dist/` после `npm run build` — это и есть архив для загрузки в консоль Яндекс Игр: `index.html` в корне, пути относительные (`base: './'`).

> Про `public/index.html`: у Vite входной `index.html` живёт в корне проекта, а в архив попадает его собранная версия `dist/index.html`. Каталог `public/` не используется намеренно — всё, что нужно платформе, генерирует сборка, и `check:size` это проверяет.

## Документация

| Документ | Содержание |
|---|---|
| [docs/market-research.md](docs/market-research.md) | Исследование рынка Яндекс Игр (окт. 2026): аудитория, правило 2.13, жанры, доход, источники |
| [docs/gdd.md](docs/gdd.md) | Дизайн-документ: цикл TriPeaks, генератор уровней, мета, экономика, онбординг |
| [docs/roadmap.md](docs/roadmap.md) | Дорожная карта по этапам 0–6 с чекбоксами |
| [docs/yandex-requirements-checklist.md](docs/yandex-requirements-checklist.md) | Все требования платформы как чек-лист к модерации |
| [docs/art/style-guide.md](docs/art/style-guide.md) | Стиль: палитра, читаемость карт для 45+, регионы |
| [docs/art/prompts.md](docs/art/prompts.md) | Каждый промпт генерации и полученный из него ассет |
| [docs/devlog/](docs/devlog/) | Журнал проекта по датам |

## Структура кода

```
index.html            вход Vite + подключение /sdk.js
src/main.ts           конфиг Phaser, пауза звука при потере фокуса
src/scenes/           BootScene (SDK init + LoadingAPI.ready), GameScene (заглушка TriPeaks)
src/yandex/sdk.ts     обёртка SDK: ready, реклама, сохранения, язык; моки без SDK
src/i18n.ts           строки ru/en (язык — через SDK)
scripts/check-dist.mjs  проверка архива на требования платформы
```

Текущий статус: **этап 0** — скелет собирается и запускается; ядро пасьянса — этап 1 (см. roadmap).
