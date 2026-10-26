"""Upscale the official logo mark 3x without redrawing it: premultiplied Lanczos + crisp alpha edge."""
import pathlib
import numpy as np
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
src = Image.open(root / "assets/img/logo-mark.png").convert("RGBA")
a = np.asarray(src).astype(np.float64) / 255
rgb, al = a[..., :3], a[..., 3:4]
pre = np.concatenate([rgb * al, al], axis=2)
S = 3
big = [np.asarray(Image.fromarray((pre[..., c] * 255).astype(np.uint8)).resize((src.width * S, src.height * S), Image.LANCZOS)).astype(np.float64) / 255 for c in range(4)]
big = np.stack(big, axis=2)
alpha = big[..., 3]
crisp = np.clip((alpha - 0.5) * 2.4 + 0.5, 0, 1)          # tighten the soft upscaled edge
color = big[..., :3] / np.maximum(alpha[..., None], 1e-4)
out = np.concatenate([np.clip(color, 0, 1), crisp[..., None]], axis=2)
Image.fromarray((out * 255).round().astype(np.uint8)).save(root / "assets/img/logo-mark@3x.png")
print("saved", src.width * S, src.height * S)
