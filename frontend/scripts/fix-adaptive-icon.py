"""
Rebuild assets/images/adaptive-icon.png for Android adaptive icons.

Why: the source artwork is an OPAQUE 1024x1024 square (white background) with a
logo sitting at ~54% width inside it. An adaptive-icon foreground is masked to a
circle and only the central 66% (683px of 1024) is guaranteed visible.

Scaling the whole 1024 canvas down shrinks the logo twice over (once for the
canvas padding, once for the logo's own internal margin) and leaves a visible
square patch whose corners the circle clips.

So instead: keep the logo at full fidelity, drop the baked background, and scale
the LOGO so its diagonal fills the safe circle to LOGO_FILL of its diameter.
Sizing by diagonal (not width/height) is what matters here -- a wide rectangle
leaves a circular mask at its corners first.
"""
from PIL import Image
from collections import deque

BASE = r"/app/frontend/assets/images/"
SRC = BASE + r"\_backup_originals\adaptive-icon.png"
OUT = BASE + r"\adaptive-icon.png"

CANVAS = 1024
SAFE_DIAMETER = CANVAS * 0.6667   # 683px - Android's guaranteed-visible circle
LOGO_FILL = 0.97                  # fraction of that circle the logo should span
BG_TOLERANCE = 60                 # colour distance that counts as "background"
CROP_PAD = 6                      # px of slack so soft/antialiased edges survive

src = Image.open(SRC).convert("RGBA")
w, h = src.size
px = src.load()


def is_bg(x, y):
    r, g, b, a = px[x, y]
    if a < 128:
        return True
    return abs(r - bg[0]) <= BG_TOLERANCE and abs(g - bg[1]) <= BG_TOLERANCE and abs(b - bg[2]) <= BG_TOLERANCE


# 1. Identify the baked background from the corners, then find the logo as
#    everything that differs from it.
corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
print(f"canvas           : {w}x{h}")
print(f"detected bg      : rgb{bg}")

minx, miny, maxx, maxy = w, h, -1, -1
for y in range(h):
    for x in range(w):
        if not is_bg(x, y):
            if x < minx: minx = x
            if y < miny: miny = y
            if x > maxx: maxx = x
            if y > maxy: maxy = y

if maxx < 0:
    raise SystemExit("could not separate logo from background - aborting")

minx = max(0, minx - CROP_PAD)
miny = max(0, miny - CROP_PAD)
maxx = min(w - 1, maxx + CROP_PAD)
maxy = min(h - 1, maxy + CROP_PAD)
logo = src.crop((minx, miny, maxx + 1, maxy + 1))
lw, lh = logo.size
print(f"logo bbox        : {lw} x {lh}  (was {100*lw/w:.1f}% x {100*lh/h:.1f}% of the 1024 canvas)")

# 1b. Knock the baked background out of the crop with a flood fill from the
#     edges. A plain "make white transparent" would also punch holes in any
#     white detail enclosed by the logo; flood fill only removes the region
#     actually connected to the border, so the backdrop is gone and interior
#     whites survive.
lpx = logo.load()
visited = bytearray(lw * lh)
queue = deque()


def seed(x, y):
    i = y * lw + x
    if not visited[i] and is_bg(minx + x, miny + y):
        visited[i] = 1
        queue.append((x, y))


for x in range(lw):
    seed(x, 0)
    seed(x, lh - 1)
for y in range(lh):
    seed(0, y)
    seed(lw - 1, y)

cleared = 0
while queue:
    x, y = queue.popleft()
    lpx[x, y] = (0, 0, 0, 0)
    cleared += 1
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < lw and 0 <= ny < lh:
            i = ny * lw + nx
            if not visited[i] and is_bg(minx + nx, miny + ny):
                visited[i] = 1
                queue.append((nx, ny))

print(f"flood-filled     : {cleared} bg px cleared ({100*cleared/(lw*lh):.1f}% of crop)")

# 2. Scale so the logo's DIAGONAL spans LOGO_FILL of the safe circle.
import math
diag = math.hypot(lw, lh)
target = SAFE_DIAMETER * LOGO_FILL
scale = target / diag
nw, nh = max(1, round(lw * scale)), max(1, round(lh * scale))
logo = logo.resize((nw, nh), Image.LANCZOS)
print(f"scale factor     : {scale:.3f}")
print(f"logo after scale : {nw} x {nh}  ({100*nw/CANVAS:.1f}% x {100*nh/CANVAS:.1f}% of canvas)")

# 3. Composite onto a fully transparent canvas, centred. The background is now
#    supplied by adaptiveIcon.backgroundColor, so no square patch shows through
#    the circular mask.
out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
out.alpha_composite(logo, ((CANVAS - nw) // 2, (CANVAS - nh) // 2))
out.save(OUT, "PNG")

# 4. Verify what we just wrote.
chk = Image.open(OUT).convert("RGBA")
a = chk.getchannel("A")
bbox = a.getbbox()
aw, ah = bbox[2] - bbox[0], bbox[3] - bbox[1]
clear = a.histogram()[0]
print()
print(f"written          : {OUT}")
print(f"  canvas         : {CANVAS}x{CANVAS}, {100*clear/(CANVAS*CANVAS):.1f}% transparent")
print(f"  art bbox       : {aw} x {ah} @ {bbox[0]},{bbox[1]}")
print(f"  art centre     : ({bbox[0]+aw/2:.0f},{bbox[1]+ah/2:.0f})  canvas centre ({CANVAS/2:.0f},{CANVAS/2:.0f})")
print(f"  art diagonal   : {math.hypot(aw, ah):.0f}px  vs safe circle {SAFE_DIAMETER:.0f}px")
print(f"  -> diagonal is {100*math.hypot(aw,ah)/SAFE_DIAMETER:.0f}% of the safe circle")
