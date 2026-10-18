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
| 1 | Рубашка «Бордо» | `public/assets/cards/back-bordeaux.png` | `single vertical playing card back, deep burgundy, ornate gold filigree, diamond center, damask pattern, flat vector, no text` (полный промпт — в истории генерации 2026-10-18) | выбрана пользователем, вариант 2/2 | ✅ в игре |
| 1a | Рубашка «Солнце» | `public/assets/cards/back-travel.png` | `single vertical playing card back, emerald green, golden sun and sea waves medallion, olive branches, flat vector, no text` (первая пара отвергнута, выбрана вторая генерация, вариант 1/2) | выбрана пользователем | ✅ в игре |
| 1b | Рубашка «Сакура» | `public/assets/cards/back-sakura.png` | `single vertical playing card back, dark navy, pink sakura branches, seigaiha waves, golden circle, flat vector, no text` | выбрана пользователем, вариант 1/2 | ✅ в игре |
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

> 2026-10-18: три рубашки выше сгенерированы, выбраны пользователем из пар вариантов,
> обрезаны под карту и уменьшены до 256×368 (~200 КБ каждая) — `public/assets/cards/`.
> В игре переключаются кнопками «Бордо / Солнце / Сакура», выбор хранится в localStorage.
> Лица карт намеренно рисует код (крупные ранги, читаемость 45+), а не генератор.

| 11 | Карта путешествия | `public/assets/bg/map-journey.jpg` | яркая мультяшная карта мира, маршрут пинами, достопримечательности (стиль выбран пользователем после отклонения винтажных вариантов) | выбрана, вариант 1/2 | ✅ фон экрана карты |
| 12 | Фон: Башня над водопадом (бывш. «Средиземноморье») | `public/assets/bg/bg-mediterranean.jpg` | яркий мультяшный берег, домики и оливы по краям, пустой зелёный центр | выбрана, вариант 1/2 | ✅ фон локации |
| 13 | Фон: Пагода у осенней горы | `public/assets/bg/bg-japan.jpg` (+портретный кроп) | Фудзи, сакура, пагода по краям, пустой тёмно-синий центр | выбрана, вариант 1/2 | ✅ фон локации |
| 14 | Фон: Зелёные горы и озеро | `public/assets/bg/bg-europe.jpg` (+портретный кроп) | горы, река, холмы по краям, пустой бордовый центр | выбрана, вариант 2/2 | ✅ фон локации |
> Все фоны ужаты до 720×1080 JPG (~120–220 КБ).
| 15 | Открытка победы | `public/assets/bg/postcard-win.jpg` | праздничная сцена: кубок, карты, конфетти, берег; нижняя половина — пустой крем (первая пара «шаблон открытки» отвергнута, выбрана эта, вариант 2/2) | выбрана пользователем | ✅ экран победы целиком |
| 16 | Карта мира (рабочая) | `public/assets/bg/map-world.jpg` | светлая пергаментная карта, 4 острова, без маршрута и пинов — маршрут рисует код (первая пара отвергнута, выбрана эта, вариант 2/2) | выбрана пользователем | ✅ фон рабочей карты |
> Старая `map-journey.jpg` удалена: её нарисованный маршрут не совпадал с реальным движением игрока.
| 17 | Фон: Пустыня с пирамидами | `public/assets/bg/bg-desert.jpg` | яркая мультяшная пустыня, пирамиды и пальмы по краям, пустой тёплый центр | сгенерирована без выбора пары | ✅ фон локации |
