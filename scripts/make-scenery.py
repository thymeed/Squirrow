"""Generates src/ui/scenery-light.svg and scenery-dark.svg (pixel art on a 320x180 grid).
Run from the repo root: python scripts/make-scenery.py"""
import math
import random

W, H = 320, 180

SPRITES = {
    'bot': ["....oo....", "....ee....", "..oooooo..", ".oBBBBBBo.", ".oBkBBkBo.", ".oBBBBBBo.", ".oBmmmmBo.", "..oooooo..", ".oBo..oBo.", "..oo..oo.."],
    'cat': [".o......o.", "oBo....oBo", "oBBooooBBo", "oBBBBBBBBo", "oBkBBBBkBo", "oBBBmmBBBo", ".oBBBBBBo.", "..oBBBBo..", "..oo..oo.."],
    'orb': ["...oooo...", "..oBBBBo..", ".oBWWBBBo.", "oBWBBBBBBo", "oBBBkBkBBo", "oBBBBBBBBo", "oBBBmmBBBo", ".oBBBBBBo.", "..oBBBBo..", "...oooo..."],
    'tall': ["..oooooo..", "..oBBBBo..", "..oBkkBo..", "..oBBBBo..", ".oooooooo.", "oBBBBBBBBo", "oBBoBBoBBo", ".oBBBBBBo.", ".oBo..oBo.", ".ooo..ooo."],
    'ghost': ["...oooo...", "..oBBBBo..", ".oBBBBBBo.", "oBBkBBkBBo", "oBBBBBBBBo", "oBBBmmBBBo", "oBBBBBBBBo", "oBBBBBBBBo", "oBoBBBBoBo", ".o.oooo.o."],
    'bunny': ["oo......oo", "oBo....oBo", "oBo....oBo", "oBBooooBBo", "oBBBBBBBBo", "oBkBBBBkBo", "oBBBmmBBBo", ".oBBBBBBo.", "..oBBBBo..", "..oo..oo.."],
}
# name, body, highlight
ROBOTS = [
    ('ghost', '#f4f4ff', '#ffffff'), ('bot', '#6ea8ff', '#cfe3ff'), ('cat', '#ffb86b', '#ffe2c0'),
    ('orb', '#a98bff', '#e0d4ff'), ('bunny', '#ff8fb8', '#ffd0e2'), ('tall', '#5fd18a', '#c9f5da'),
]
POS = [4, 26, 47, 252, 274, 296]

CSS = """<style>
@keyframes tw{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes drift{from{transform:translateX(-5px)}to{transform:translateX(5px)}}
@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes shootL{0%{opacity:0;transform:translate(0,0)}2%{opacity:1}12%{opacity:0;transform:translate(44px,26px)}100%{opacity:0;transform:translate(44px,26px)}}
@keyframes shootR{0%{opacity:0;transform:translate(0,0)}2%{opacity:1}12%{opacity:0;transform:translate(-44px,26px)}100%{opacity:0;transform:translate(-44px,26px)}}
.tw{animation:tw 3s steps(2,end) infinite}
.cloud{animation:drift 14s ease-in-out infinite alternate}
.hop{animation:hop .9s steps(1,end) infinite}
.shootL{animation:shootL 11s linear infinite 2s backwards}
.shootR{animation:shootR 13s linear infinite 7s backwards}
@media (prefers-reduced-motion:reduce){.tw,.cloud,.hop,.shootL,.shootR{animation:none}}
</style>"""


def sprite(name, x, y, body, hi, scale=2, out='#1f2540'):
    pal = {'o': out, 'B': body, 'W': hi, 'k': out, 'm': out, 'e': '#ffd23f'}
    return [(x + i * scale, y + j * scale, scale, scale, pal[c])
            for j, row in enumerate(SPRITES[name]) for i, c in enumerate(row) if c in pal]


def rects(items):
    return ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{c}"/>' for x, y, w, h, c in items)


def build(dark, animated=True):
    P = dict(
        far='#5a6fa8' if dark else '#a9c8e8', mid='#3b4f86' if dark else '#7fb88a',
        near='#27385f' if dark else '#5a9a67', grass='#2f4a7a' if dark else '#6fb27a',
        cloud='#3a4a7a' if dark else '#ffffff', sun='#e8ecff' if dark else '#ffe27a',
        trunk='#1b2442' if dark else '#7a5a3a', leaf='#1f3a5c' if dark else '#2e7d4f',
        leaf2='#2a4a70' if dark else '#3f9a63',
    )
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMax slice">', CSS if animated else '']
    cx, cy, rad = 250, 34, 9
    out.append(rects([(x, y, 1, 1, P['sun']) for y in range(cy - rad, cy + rad + 1) for x in range(cx - rad, cx + rad + 1)
                      if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad]))
    if dark:
        rnd = random.Random(4)
        for n in range(45):
            x, y = rnd.randrange(4, W - 4), rnd.randrange(4, 95)
            items = [(x, y, 1, 1, '#ffffff')]
            if rnd.random() < .2:
                items += [(x - 1, y, 3, 1, '#ffffff'), (x, y - 1, 1, 3, '#ffffff')]
            out.append(f'<g class="tw" style="animation-delay:{(n % 7) * .43:.2f}s">{rects(items)}</g>')
        for cls, x, y, d in [('shootL', 6, 8, 1), ('shootR', 306, 14, -1)] if animated else []:
            tail = [(x - d * k, y - (k * 6 // 10), 1, 1, '#ffffff' if k < 2 else '#9fb3ff' if k < 5 else '#5a6fa8') for k in range(8)]
            out.append(f'<g class="{cls}">{rects(tail)}</g>')
    for n, (x, y, w) in enumerate([(30, 28, 26), (110, 50, 32), (190, 22, 22), (285, 64, 24)]):
        c = [(x, y + 4, w, 5, P['cloud']), (x + 4, y + 1, w - 10, 4, P['cloud']), (x + w // 3, y - 2, w // 3, 4, P['cloud'])]
        out.append(f'<g class="cloud" style="animation-duration:{12 + n * 3}s">{rects(c)}</g>')
    hills = []
    for base, amp, per, ph, col in [(112, 10, 23, .5, P['far']), (132, 9, 17, 2., P['mid']), (152, 5, 13, 4., P['near'])]:
        for x in range(W):
            h = int(base + amp * math.sin(x / per + ph))
            hills.append((x, h, 1, H - h, col))
    out.append(rects(hills))
    rnd = random.Random(7)
    out.append(rects([(rnd.randrange(W), rnd.randrange(156, H - 2), 1, 2, P['grass']) for _ in range(90)]))
    for x, y in [(70, 128), (84, 132), (236, 130), (224, 127), (106, 136), (300, 136)]:
        s = 2
        items = [(x + s, y + 4 * s, s, 2 * s, P['trunk'])]
        items += [(x - k * s + s, y + k * s, (2 * k + 1) * s, s, P['leaf'] if k % 2 else P['leaf2']) for k in range(4)]
        out.append(rects(items))
    for i, ((name, body, hi), x) in enumerate(zip(ROBOTS, POS)):
        hy = int(152 + 5 * math.sin(x / 13 + 4.))
        out.append(f'<g class="hop" style="animation-delay:{i * .27:.2f}s">{rects(sprite(name, x, hy - 14, body, hi))}</g>')
    out.append('</svg>')
    return '\n'.join(out)


# Still versions are swapped in by styles.scss under prefers-reduced-motion, because SVG images
# do not reliably honor that media query themselves.
for dark, name in [(False, 'light'), (True, 'dark')]:
    for animated, suffix in [(True, ''), (False, '-still')]:
        with open(f'src/ui/scenery-{name}{suffix}.svg', 'w', newline='\n') as f:
            f.write(build(dark, animated))
