"""Превращает растровый логотип ГУИМЦ в настоящий SVG в неоновых цветах.

Синие части (ухо и надпись «ГУИМЦ») -> голубой #00ffff,
золотая звезда -> золотой #ffd54a.

Запуск:  .venv/Scripts/python scripts/vectorize_logo.py
Нужны пакеты: pillow, numpy, potracer.
"""
from pathlib import Path

import numpy as np
import potrace
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "interface" / "logo_guimc.png"
DST = ROOT / "app" / "static" / "img" / "logo.svg"

TARGET_HEIGHT = 1200  # исходник 7719 px — для обводки столько не нужно
CYAN = "#00ffff"
GOLD = "#ffd54a"


def load_rgb(path: Path) -> np.ndarray:
    img = Image.open(path).convert("RGBA")
    scale = TARGET_HEIGHT / img.height
    img = img.resize((round(img.width * scale), TARGET_HEIGHT), Image.LANCZOS)
    # Прозрачные пиксели считаем белым фоном.
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.alpha_composite(img)
    return np.asarray(bg.convert("RGB")).astype(int)


def fmt(p) -> str:
    x, y = (p.x, p.y) if hasattr(p, "x") else p
    return f"{x:.1f},{y:.1f}".replace(".0,", ",").removesuffix(".0")


def trace(mask: np.ndarray) -> str:
    # potracer обводит пиксели со значением False, поэтому маску инвертируем.
    path = potrace.Bitmap(~mask).trace(turdsize=8, alphamax=1.0, opticurve=True, opttolerance=0.4)
    parts = []
    for curve in path:
        parts.append(f"M{fmt(curve.start_point)}")
        for seg in curve.segments:
            if seg.is_corner:
                parts.append(f"L{fmt(seg.c)}L{fmt(seg.end_point)}")
            else:
                parts.append(f"C{fmt(seg.c1)} {fmt(seg.c2)} {fmt(seg.end_point)}")
        parts.append("Z")
    return "".join(parts)


def main() -> None:
    rgb = load_rgb(SRC)
    r, b = rgb[..., 0], rgb[..., 2]
    blue = (b - r) > 60   # #154ea0 и похожие
    gold = (r - b) > 60   # #d6b25a и похожие

    # Обрезаем пустые поля вокруг рисунка.
    ys, xs = np.nonzero(blue | gold)
    pad = 4
    y0, y1 = max(ys.min() - pad, 0), ys.max() + pad
    x0, x1 = max(xs.min() - pad, 0), xs.max() + pad
    blue, gold = blue[y0:y1, x0:x1], gold[y0:y1, x0:x1]
    h, w = blue.shape

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="Логотип ГУИМЦ">'
        f'<path fill="{CYAN}" fill-rule="evenodd" d="{trace(blue)}"/>'
        f'<path fill="{GOLD}" fill-rule="evenodd" d="{trace(gold)}"/>'
        f"</svg>\n"
    )
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(svg, encoding="utf-8")
    print(f"{DST.relative_to(ROOT)}: {w}x{h}, {DST.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
