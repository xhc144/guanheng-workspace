"""Cut the logo mark out of the official horizontal logo and repair the keyed-out tips.

The official transparent PNG lost the white tips of the ribbon (white-on-white keying).
We only refill pixels that are fully enclosed by the ribbon's own rim + the image edge,
recolour grey keying residue, and never paint outside the original silhouette.
"""
import pathlib
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import ConvexHull
from PIL import ImageDraw

root = pathlib.Path(__file__).resolve().parent.parent
logo = np.asarray(Image.open(root / "assets/img/logo.png").convert("RGBA")).astype(np.float64)
mark = logo[:, :373].copy()          # wordmark starts at x=373
H, W = mark.shape[:2]
r, g, b, a = (mark[..., i] for i in range(4))

# 1. drop dark keying specks
mark[(np.maximum(np.maximum(r, g), b) < 110), 3] = 0

def inpaint(img, target, known, iters=40):
    """Fill target pixels with the average colour of known neighbours (normalised convolution)."""
    img = img.copy()
    known = known.copy()
    k = np.ones((5, 5))
    for _ in range(iters):
        todo = target & ~known
        if not todo.any():
            break
        w = ndimage.convolve(known.astype(float), k, mode="constant")
        for c in range(3):
            acc = ndimage.convolve(img[..., c] * known, k, mode="constant")
            ready = todo & (w > 0)
            img[ready, c] = acc[ready] / w[ready]
        known |= todo & (w > 0)
    return img


yy, xx = np.mgrid[0:H, 0:W]
for top in (True, False):
    box = (xx >= 290) & ((yy < 45) if top else (yy >= H - 45))
    a = mark[..., 3]
    blue = (mark[..., 2] - mark[..., 0] > 90) & (a > 128)
    solid = a > 128
    # close the image edge between the light surface and the rim, then fill what is enclosed
    rows = slice(0, 4) if top else slice(H - 4, H)
    rim_x = xx[rows][blue[rows]].max() if blue[rows].any() else W - 1
    closed = solid.copy()
    closed[rows, 300:rim_x + 1] = True
    hole = ndimage.binary_fill_holes(closed) & ~closed & box
    # notch still open to the edge: anything transparent inside the tip's convex hull
    pts = np.argwhere(solid & box)[:, ::-1]
    hull = pts[ConvexHull(pts).vertices]
    hm = Image.new("L", (W, H), 0)
    ImageDraw.Draw(hm).polygon([tuple(map(float, v)) for v in hull], fill=255)
    hole |= (np.asarray(hm) > 0) & ~solid & box
    # grey keying residue: not rim blue, darker than the light surface around it
    lum = mark[..., :3].mean(axis=2)
    residue = box & (a > 0) & ~blue & (lum < 225)
    residue &= ndimage.binary_dilation((lum > 225) & solid & box, iterations=3)
    target = hole | residue
    known = solid & ~target & ~blue & box
    known |= solid & ~box
    mark[..., :3] = inpaint(mark[..., :3], target, known)
    mark[target, 3] = 255
    print("tip", "top" if top else "bottom", "hole", int(hole.sum()), "residue", int(residue.sum()))

out = Image.fromarray(np.clip(mark, 0, 255).round().astype(np.uint8))
out = out.crop(out.getbbox())
out.save(root / "assets/img/logo-mark.png")
print("mark", out.size)
