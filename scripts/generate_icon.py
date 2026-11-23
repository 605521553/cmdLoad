"""Generate the Pata Commands source icon.

The icon intentionally uses only geometric strokes so it remains legible at
16–32 px in the Windows tray and taskbar. Regenerate with:

    python scripts/generate_icon.py
    npx tauri icon assets/app-icon.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
MARGIN = 64
RADIUS = 228
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "app-icon.png"


def lerp(start: int, end: int, t: float) -> int:
    return round(start + (end - start) * t)


def gradient_background() -> Image.Image:
    gradient = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(gradient)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        # A soft diagonal light source keeps the flat icon from looking dead.
        light = round(10 * (1.0 - t))
        draw.line(
            [(0, y), (SIZE, y)],
            fill=(
                min(255, lerp(28, 11, t) + light),
                min(255, lerp(73, 38, t) + light + 6),
                min(255, lerp(65, 32, t) + light),
                255,
            ),
        )
    return gradient


def main() -> None:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    background = gradient_background()
    mask = Image.new("L", (SIZE, SIZE), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        (MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN),
        radius=RADIUS,
        fill=255,
    )
    canvas.paste(background, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    inset = (MARGIN + 14, MARGIN + 14, SIZE - MARGIN - 14, SIZE - MARGIN - 14)
    draw.rounded_rectangle(inset, radius=RADIUS - 14, outline=(255, 255, 255, 22), width=3)

    # Prompt chevron.
    stroke = 74
    chevron = [(350, 390), (494, 512), (350, 634)]
    draw.line(chevron, fill=(242, 193, 78, 255), width=stroke, joint="curve")
    for point in (chevron[0], chevron[-1]):
        draw.ellipse(
            (
                point[0] - stroke // 2,
                point[1] - stroke // 2,
                point[0] + stroke // 2,
                point[1] + stroke // 2,
            ),
            fill=(242, 193, 78, 255),
        )

    # Cursor underscore.
    draw.line(
        [(566, 642), (714, 642)],
        fill=(245, 240, 226, 255),
        width=stroke,
    )
    for x in (566, 714):
        draw.ellipse(
            (x - stroke // 2, 642 - stroke // 2, x + stroke // 2, 642 + stroke // 2),
            fill=(245, 240, 226, 255),
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, format="PNG", optimize=True)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
