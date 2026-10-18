#!/usr/bin/env python3
"""Варианты фонов под разную форму экрана без обрезки декора.

Исходные фоны — портретные (720x1080 и т.п.). На широком экране cover-кроп
съедал верх/низ картинки, а contain давал «колонку» по центру с чужеродными
краями. Поэтому для каждого фона строим:
  *-wide.jpg (1920x1080) — оригинал по центру на всю высоту, слева/справа
             зеркальные продолжения (шов бесшовный: соседний пиксель — тот же);
  *-tall.jpg (1080x1920) — оригинал по центру на всю ширину, сверху/снизу
             зеркальные продолжения.
Игра выбирает вариант по форме экрана и показывает его cover-ом: резать
почти нечего, декор по краям сохраняется.

Запуск: python3 scripts/make-bg-variants.py (нужен Pillow).
"""
from pathlib import Path

from PIL import Image

BG_DIR = Path(__file__).resolve().parent.parent / "public" / "assets" / "bg"
NAMES = ["bg-desert", "bg-mediterranean", "bg-japan", "bg-europe"]


def mirror_fill(canvas: Image.Image, core: Image.Image, horizontal: bool) -> None:
    cw, ch = canvas.size
    w, h = core.size
    cx, cy = (cw - w) // 2, (ch - h) // 2
    if horizontal:
        # Тайлим отражённую картинку влево и вправо от оригинала.
        x = cx
        flip = False
        while x > 0:
            tile = core.transpose(Image.FLIP_LEFT_RIGHT) if not flip else core
            tw = min(w, x)
            canvas.paste(tile.crop((w - tw, 0, w, h)), (x - tw, cy))
            x -= tw
            flip = not flip
        x = cx + w
        flip = False
        while x < cw:
            tile = core.transpose(Image.FLIP_LEFT_RIGHT) if not flip else core
            tw = min(w, cw - x)
            canvas.paste(tile.crop((0, 0, tw, h)), (x, cy))
            x += tw
            flip = not flip
    else:
        y = cy
        flip = False
        while y > 0:
            tile = core.transpose(Image.FLIP_TOP_BOTTOM) if not flip else core
            th = min(h, y)
            canvas.paste(tile.crop((0, h - th, w, h)), (cx, y - th))
            y -= th
            flip = not flip
        y = cy + h
        flip = False
        while y < ch:
            tile = core.transpose(Image.FLIP_TOP_BOTTOM) if not flip else core
            th = min(h, ch - y)
            canvas.paste(tile.crop((0, 0, w, th)), (cx, y))
            y += th
            flip = not flip
    canvas.paste(core, (cx, cy))


def main() -> None:
    for name in NAMES:
        src = Image.open(BG_DIR / f"{name}.jpg").convert("RGB")

        wide_core = src.resize((round(src.width * 1080 / src.height), 1080), Image.LANCZOS)
        wide = Image.new("RGB", (1920, 1080))
        mirror_fill(wide, wide_core, horizontal=True)
        wide.save(BG_DIR / f"{name}-wide.jpg", quality=84)

        tall_core = src.resize((1080, round(src.height * 1080 / src.width)), Image.LANCZOS)
        tall = Image.new("RGB", (1080, 1920))
        mirror_fill(tall, tall_core, horizontal=False)
        tall.save(BG_DIR / f"{name}-tall.jpg", quality=84)

        print(f"{name}: wide {wide.size}, tall {tall.size}")


if __name__ == "__main__":
    main()
