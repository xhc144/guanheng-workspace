from pathlib import Path
from collections import deque

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets/brand/official/guanheng-group-horizontal.jpg"
OUTPUT = ROOT / "public/assets/brand/official/guanheng-group-horizontal-transparent.png"
DELIVERY = ROOT / "output/guanheng-group-official-transparent.png"
QA_DIR = ROOT / "output/qa/logo-transparent"


def smoothstep(value: np.ndarray, low: float, high: float) -> np.ndarray:
    scaled = np.clip((value - low) / (high - low), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def composite(foreground: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    background = Image.new("RGBA", foreground.size, (*color, 255))
    background.alpha_composite(foreground)
    return background.convert("RGB")


rgb_image = Image.open(SOURCE).convert("RGB")
rgb = np.asarray(rgb_image).astype(np.float32)
red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]

# JPEG white is not perfectly uniform. Combine darkness and blue chroma so the
# blue gradient remains opaque while near-white antialiasing receives soft alpha.
darkness = np.maximum.reduce((255.0 - red, 255.0 - green, 255.0 - blue))
blue_chroma = np.maximum(blue - red, blue - green)
foreground_signal = np.maximum(darkness, blue_chroma * 3.2)

# Segment white regions as connected components. Border-connected components
# are the background. Enclosed components with a gradual surrounding ring are
# glossy highlights; enclosed components with a dark ring are glyph counters.
matte_threshold = 80.0
background_like = foreground_signal < matte_threshold
visited = np.zeros(background_like.shape, dtype=bool)
remove_matte = np.zeros(background_like.shape, dtype=bool)
height, width = background_like.shape
component_stats: list[tuple[int, bool, float, float]] = []

for start_y in range(height):
    for start_x in range(width):
        if visited[start_y, start_x] or not background_like[start_y, start_x]:
            continue
        queue = deque([(start_y, start_x)])
        visited[start_y, start_x] = True
        coords: list[tuple[int, int]] = []
        touches_border = False
        while queue:
            y, x = queue.popleft()
            coords.append((y, x))
            touches_border |= y == 0 or x == 0 or y == height - 1 or x == width - 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and background_like[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((ny, nx))

        ys = np.fromiter((item[0] for item in coords), dtype=np.int32)
        xs = np.fromiter((item[1] for item in coords), dtype=np.int32)
        ring_median = 255.0
        ring_p90 = 255.0
        if not touches_border:
            y0, y1 = max(0, int(ys.min()) - 4), min(height, int(ys.max()) + 5)
            x0, x1 = max(0, int(xs.min()) - 4), min(width, int(xs.max()) + 5)
            local = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
            local[ys - y0, xs - x0] = 255
            dilated = np.asarray(Image.fromarray(local).filter(ImageFilter.MaxFilter(9))) > 0
            ring = dilated & (local == 0)
            ring_values = foreground_signal[y0:y1, x0:x1][ring]
            if ring_values.size:
                ring_median = float(np.median(ring_values))
                ring_p90 = float(np.percentile(ring_values, 90))

        # Keep small, softly surrounded highlight components. Everything else
        # is white matte, including enclosed counters inside letters.
        preserve_highlight = (not touches_border) and len(coords) < 4000 and ring_median < 180
        if not preserve_highlight:
            remove_matte[ys, xs] = True
        component_stats.append((len(coords), touches_border, ring_median, ring_p90))

alpha = np.full(background_like.shape, 255, dtype=np.uint8)
soft_alpha = (smoothstep(foreground_signal, 2.5, matte_threshold) * 255.0).astype(np.uint8)
alpha[remove_matte] = soft_alpha[remove_matte]
alpha = np.minimum(alpha, np.asarray(Image.fromarray(alpha).filter(ImageFilter.MinFilter(3))))

# Replace the RGB values of semi-transparent antialiased pixels with nearby
# opaque logo colors. This removes the white JPEG matte without hardening alpha.
edge_rgb = rgb.copy()
known = foreground_signal >= matte_threshold
for _ in range(10):
    color_sum = np.zeros_like(edge_rgb)
    neighbor_count = np.zeros(alpha.shape, dtype=np.float32)
    for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
        shifted_known = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
        shifted_rgb = np.roll(np.roll(edge_rgb, dy, axis=0), dx, axis=1)
        if dy == -1:
            shifted_known[-1, :] = False
        elif dy == 1:
            shifted_known[0, :] = False
        if dx == -1:
            shifted_known[:, -1] = False
        elif dx == 1:
            shifted_known[:, 0] = False
        color_sum += shifted_rgb * shifted_known[..., None]
        neighbor_count += shifted_known
    newly_known = (~known) & (neighbor_count > 0)
    edge_rgb[newly_known] = color_sum[newly_known] / neighbor_count[newly_known, None]
    known |= newly_known

semi_transparent = remove_matte & (alpha > 0) & (alpha < 255)
rgb_clean = rgb.copy()
rgb_clean[semi_transparent] = edge_rgb[semi_transparent]
rgba = np.dstack((np.clip(rgb_clean, 0, 255).astype(np.uint8), alpha))
transparent = Image.fromarray(rgba, mode="RGBA")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
DELIVERY.parent.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)
transparent.save(OUTPUT, "PNG", optimize=True)
transparent.save(DELIVERY, "PNG", optimize=True)
composite(transparent, (245, 247, 250)).save(QA_DIR / "on-light-gray.png", "PNG", optimize=True)
composite(transparent, (17, 82, 180)).save(QA_DIR / "on-cobalt-blue.png", "PNG", optimize=True)

print(f"saved={OUTPUT}")
print(f"delivery={DELIVERY}")
print(f"size={transparent.width}x{transparent.height}")
print(f"alpha_min={alpha.min()} alpha_max={alpha.max()} transparent={(alpha == 0).sum()}")
for size, border, median, p90 in sorted(component_stats, reverse=True)[:12]:
    print(f"component size={size} border={border} ring_median={median:.1f} ring_p90={p90:.1f}")
