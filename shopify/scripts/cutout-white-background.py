import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, dst = sys.argv[1], sys.argv[2]
a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
v = a.mean(axis=2)
spread = a.max(axis=2) - a.min(axis=2)
neutral_light = (spread <= 6) & (v >= 140)       # white background + grey drop shadow
lab, _ = ndimage.label(neutral_light)
edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
shadow = np.isin(lab, list(edge_labels))
# shadow/background pixels become black at an opacity that reproduces their darkness on white
sh_alpha = np.clip((255 - v) / 255.0, 0, 1)
alpha = np.where(shadow, sh_alpha, 1.0)
rgb = np.where(shadow[..., None], 0, a)
# 1px feather where the deck meets the shadow so the edge isn't jagged
boundary = ndimage.binary_dilation(shadow, iterations=1) & ~shadow
alpha = np.where(boundary, np.maximum(alpha * 0.85, sh_alpha), alpha)
out = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA")
bbox = Image.fromarray(((alpha > 0.04) * 255).astype(np.uint8)).getbbox()
out = out.crop(bbox)
w, h = out.size
s = max(w, h) + 40
canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
canvas.paste(out, ((s - w) // 2, (s - h) // 2))
canvas.save(dst, optimize=True)
print(dst, canvas.size)
