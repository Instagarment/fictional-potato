import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, dst = sys.argv[1], sys.argv[2]
min_v = float(sys.argv[3]) if len(sys.argv) > 3 else 60
a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
v = a.mean(axis=2)
spread = a.max(axis=2) - a.min(axis=2)
# background + drop shadow: neutral grey/white pixels reachable from the image border
cand = (spread <= 6) & (v >= min_v)
lab, _ = ndimage.label(cand)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
outside = np.isin(lab, list(edge))
# deck = biggest solid shape that's left, holes filled, edges smoothed
lab2, n = ndimage.label(~outside)
sizes = ndimage.sum(np.ones_like(v), lab2, range(1, n + 1))
deck = lab2 == (1 + int(np.argmax(sizes)))
deck = ndimage.binary_fill_holes(deck)
deck = ndimage.binary_opening(deck, structure=np.ones((3, 3)), iterations=2)
deck = ndimage.binary_fill_holes(deck)
soft = np.clip(ndimage.gaussian_filter(deck.astype(np.float32), 0.8) * 1.6 - 0.3, 0, 1)
# shadow everywhere off the deck: black at the opacity that reproduces it on white
shadow_a = np.clip((255 - v) / 255.0, 0, 1) * ~deck
shadow_a = ndimage.gaussian_filter(shadow_a, 1.0)
alpha = soft + (1 - soft) * shadow_a
w = (soft / np.maximum(alpha, 1e-4))[..., None]          # share of deck colour in each pixel
rgb = a * w
out = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")
bbox = Image.fromarray(((alpha > 0.03) * 255).astype(np.uint8)).getbbox()
out = out.crop(bbox)
W, H = out.size
s = max(W, H) + 40
canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
canvas.paste(out, ((s - W) // 2, (s - H) // 2))
canvas.save(dst, optimize=True)
print(dst, "deck px", int(deck.sum()), "size", canvas.size)
