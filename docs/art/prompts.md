# Промпты генерации ассетов

Правило проекта: **ни одного ассета без записи здесь** — промпт, модель, seed, полученный файл. Это и воспроизводимость стиля (`docs/art/style-guide.md`), и доказательство происхождения материалов: платформа допускает заранее сгенерированные ИИ-материалы, но запрещает интерактивный ИИ внутри игры.

Общие требования ко всем генерациям: без текста и букв в картинке (текст рисует код), без товарных знаков, файлы сохранять латиницей без пробелов (`assets/cards/back-mediterranean.png`).

## Базовый негативный промпт (для всех)

```
no text, no letters, no numbers, no watermark, no logo, no trademark,
no photorealistic hands, no cluttered center composition
```

## Запланированные ассеты (этап 2)

| # | Ассет | Файл | Промпт | Модель/seed | Статус |
|---|---|---|---|---|---|
| 1 | Рубашка карты | `assets/cards/card-back.png` | `playing card back design, deep burgundy #8f2f2f background, elegant thin gold border, vintage travel map compass rose ornament in center, symmetrical, flat vector illustration, clean, high contrast` | — | ⬜ запланировано |
| 2 | Лицо карты (фон) | `assets/cards/card-face.png` | `blank playing card face, warm ivory #f7f1de, subtle paper texture, thin dark green rounded border, completely empty center, flat vector, minimal` (ранги/масти рисует код поверх) | — | ⬜ |
| 3 | Фон стола: Средиземноморье | `assets/bg/bg-mediterranean.png` | `dark green felt card table background, Mediterranean travel theme ornaments only at edges: olive branches, sea waves, vintage postcard stamps in corners, empty dark center, flat vector illustration, muted warm colors` | — | ⬜ |
| 4 | Фон стола: Япония | `assets/bg/bg-japan.png` | `dark green felt card table background, Japanese travel theme ornaments only at edges: sakura branches, seigaiha waves, red sun stamp in corner, empty dark center, flat vector illustration, muted warm colors` | — | ⬜ |
| 5 | Фон стола: Скандинавия | `assets/bg/bg-scandinavia.png` | `dark green felt card table background, Scandinavian travel theme ornaments only at edges: pine branches, aurora ribbons, rune stone stamp in corner, empty dark center, flat vector illustration, muted cool colors` | — | ⬜ |
| 6 | Иконка игры | `assets/icon/icon-512.png` | `mobile game icon, three overlapping playing cards fanned like mountain peaks over a vintage world map, gold star above, deep green and burgundy palette, flat vector, bold readable shapes, no text` | — | ⬜ |
| 7 | Иконка бустера «Отмена» | `assets/ui/booster-undo.png` | `single game icon, curved golden back arrow over a playing card, deep green background circle, flat vector, bold, no text` | — | ⬜ |
| 8 | Иконка бустера «+5 карт» | `assets/ui/booster-plus5.png` | `single game icon, small stack of playing cards with a golden plus sign, deep green background circle, flat vector, bold, no text, no numbers` | — | ⬜ |
| 9 | Иконка бустера «Дикая карта» | `assets/ui/booster-wild.png` | `single game icon, playing card with a large golden star in center, deep green background circle, flat vector, bold, no text` | — | ⬜ |
| 10 | Открытка коллекции: Средиземноморье | `assets/collectibles/postcard-mediterranean.png` | `vintage travel postcard illustration, Mediterranean coastal town, olive trees and sea, warm sunset, postage stamp border, flat vector, no text` | — | ⬜ |

## Как заполнять при генерации

1. Сгенерировать 4 варианта, выбрать по стиль-гайду (читаемость, пустой центр, палитра).
2. Вписать модель и seed в таблицу, статус → ✅, имя файла — как в таблице.
3. Проверить на реальном телефоне: ранг поверх лица карты читается с 40 см.
4. `npm run check:size` не должен ругаться на имя файла.
