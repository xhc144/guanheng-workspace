"""Copy and resize source images from the company materials into assets/img."""
import pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
company = root.parent.parent  # E:/项目/05_关衡公司
media = company / "关衡官网/关衡新网站-交付包/new-website/media"
brand = company / "关衡品牌宣传片/guanheng-video/public/assets/brand/official"
out = root / "assets/img"; out.mkdir(parents=True, exist_ok=True)

jobs = {
    "earth.jpg": media / "hero/hero-products.jpg",
    "port.jpg": media / "industry/trade.jpg",
    "warehouse.jpg": media / "industry/logistics.jpg",
    "hq.jpg": media / "culture/about-img1.jpg",
    "electronics.jpg": media / "industry/electronics.jpg",
    "auto.jpg": media / "industry/manufacturing.jpg",
    "sys-dashboard.png": media / "system/dashboard.png",
    "sys-bi.png": media / "system/bi.png",
    "sys-risk.png": media / "system/risk.png",
    "sys-overview.png": media / "system/overview.png",
    "sys-tradedb.png": media / "system/trade-db.png",
    "logo.png": brand / "guanheng-group-horizontal-transparent.png",
}
for name, src in jobs.items():
    im = Image.open(src)
    print(name, im.size, im.mode)
    if name.endswith(".jpg"):
        im = im.convert("RGB")
        if im.width > 2400:
            im = im.resize((2400, round(im.height * 2400 / im.width)), Image.LANCZOS)
        if im.width < 1920:  # upscale small photos once so the browser isn't doing it per frame
            s = 2200 / im.width
            im = im.resize((2200, round(im.height * s)), Image.LANCZOS)
        im.save(out / name, quality=92)
    elif name.startswith("sys-"):
        im = im.convert("RGB")
        if im.width > 2000:
            im = im.resize((2000, round(im.height * 2000 / im.width)), Image.LANCZOS)
        im.save(out / name.replace(".png", ".jpg"), quality=92)
    else:
        im.save(out / name)

# Logo mark only (left part of horizontal logo, before the wordmark)
logo = Image.open(brand / "guanheng-group-horizontal-transparent.png").convert("RGBA")
a = logo.getchannel("A")
cols = [any(a.getpixel((x, y)) > 10 for y in range(logo.height)) for x in range(logo.width)]
# find first gap of empty columns after the mark
x = 0
while x < len(cols) and not cols[x]: x += 1
start = x
while x < len(cols) and cols[x]: x += 1
gap_start = x
mark = logo.crop((start, 0, gap_start, logo.height))
bbox = mark.getbbox(); mark = mark.crop(bbox)
mark.save(out / "logo-mark.png"); print("logo-mark", mark.size, "wordmark starts at", gap_start)
