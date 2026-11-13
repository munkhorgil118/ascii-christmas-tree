"""
ASCII Christmas Tree
====================
A rotating 3D particle Christmas tree drawn entirely with coloured ASCII
characters: the tree grows from the bottom up, then the tinsel, baubles,
fairy lights, presents and star appear, and finally the greeting is typed out.

Install:  pip install pygame numpy
Run:      python christmas_tree.py          (optional: python christmas_tree.py 12  -> cell height in px)
Keys:     Space pause   R restart   S screenshot   Esc quit
"""
import math
import sys
import time

import numpy as np
import pygame

# ------------------------------------------------------------------ window
TITLE = "ASCII Christmas Tree"
COLS, ROWS = 88, 74                 # size of the character grid
FPS = 30
FONT_NAMES = "consolas,menlo,dejavusansmono,couriernew,monospace"
HINT = "Space pause   R restart   S screenshot   Esc quit"
MESSAGE = "MERRY CHRISTMAS 2026"
LOOP = False                         # True = start over automatically like the reel

# ------------------------------------------------------------------ colours
BG = (6, 8, 14)
DIM = (38, 46, 70)
WHITE = (235, 242, 255)
GOLD = (255, 196, 64)
WARM = (255, 222, 150)
RED = (232, 46, 50)
GREEN = (46, 190, 84)
GREEN_BOX = (34, 150, 70)
BLUE = (58, 108, 255)
DEEP = (20, 100, 48)
LEAF = (84, 225, 110)
TRUNK = (124, 76, 40)
HUD = (96, 104, 122)
ACCENT = (255, 196, 90)

# ------------------------------------------------------------------ timeline (seconds)
T_GROW = (0.3, 6.0)        # needles appear from the bottom up
T_TINSEL = (5.8, 8.0)
T_BALLS = (7.4, 9.4)
T_LIGHTS = (8.6, 11.0)
T_GIFTS = (10.2, 12.0)
T_STAR = 12.4
T_MSG = 13.4
T_END = 24.0               # only used when LOOP = True
SPIN = math.radians(18)    # rotation speed, rad/s

# ------------------------------------------------------------------ 3D world
TAU = 2 * math.pi
GROUND = -1.0
Y0, Y1 = -0.80, 1.22       # bottom and top of the branches
CAM_D = 5.0                # camera distance
TILT = 0.10                # camera looks slightly down
LIGHT_DIR = np.array([-0.45, 0.55, 0.70]) / np.linalg.norm([-0.45, 0.55, 0.70])

NEEDLE, SNOW, INNER, TRUNK_K, TINSEL, BAUBLE, LIGHT, GIFT = range(8)
LEVELS = 16
CHARSETS = {               # dark -> bright
    NEEDLE: ".-~^*+=vx%&#W",
    SNOW: ".,:*+",
    INNER: ".,-~^",
    TRUNK_K: ".:=#H",
    TINSEL: "-~=*@",
    BAUBLE: ".:o0%@",
    LIGHT: "oO0@",
    GIFT: ".:%#X",
}


# ================================================================== helpers
def mix(a, b, f):
    """Linear blend between colours a and b (f may be an array)."""
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    f = np.asarray(f, np.float32)
    if f.ndim == 1:
        f = f[:, None]
    return a + (b - a) * f


def ease_out_back(x):
    c = 1.7
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


def fib_sphere(n):
    """n points spread evenly over a unit sphere."""
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = math.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)


def cone(y):
    """Smooth outline of the tree (radius at height y)."""
    u = np.clip((y - Y0) / (Y1 - Y0), 0, 1)
    return 1.08 * (1 - u) ** 1.05


def envelope(y):
    """Outline with tiers: every tier flares out at its bottom."""
    u = np.clip((y - Y0) / (Y1 - Y0), 0, 1)
    tiers = 1 - (u * 6) % 1
    return cone(y) * (0.80 + 0.20 * tiers)


def grow_time(y):
    u = np.clip((np.asarray(y) - GROUND) / (Y1 - GROUND), 0, 1)
    return T_GROW[0] + (T_GROW[1] - T_GROW[0]) * u


def radial_normals(p, up=0.4):
    r = np.hypot(p[:, 0], p[:, 2]) + 1e-6
    n = np.stack([p[:, 0] / r, np.full(len(p), up), p[:, 2] / r], 1)
    return n / np.linalg.norm(n, axis=1, keepdims=True)


def inside_polygon(x, y, poly):
    """Even-odd test for one point."""
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# ================================================================== scene
class Scene:
    """Every particle of the tree, stored as flat numpy arrays."""

    def __init__(self, seed=7):
        rng = np.random.default_rng(seed)
        self.chunks = []
        branches = self._needles(rng)
        self._inner(rng)
        self._trunk(rng)
        self._tinsel(rng)
        self._baubles(rng, branches)
        self._lights(rng, branches)
        self._gifts(rng)

        keys = self.chunks[0].keys()
        for k in keys:
            setattr(self, k, np.concatenate([c[k] for c in self.chunks]))
        del self.chunks
        n = len(self.t0)
        self.phase = rng.uniform(0, TAU, n).astype(np.float32)
        self.rate = rng.uniform(1.5, 4.5, n).astype(np.float32)
        self.n_lights = int((self.kind == LIGHT).sum())

    def add(self, anchor, kind, color, t0, off=None, normal=None, bias=0.0, pop=0.01, flash=0.0):
        anchor = np.asarray(anchor, np.float32).reshape(-1, 3)
        n = len(anchor)
        if n == 0:
            return
        if off is None:
            off = np.zeros((n, 3), np.float32)
        if normal is None:
            normal = radial_normals(anchor + off)
        self.chunks.append(dict(
            anchor=anchor,
            off=np.asarray(off, np.float32).reshape(n, 3),
            normal=np.asarray(normal, np.float32).reshape(n, 3),
            kind=np.full(n, kind, np.int8),
            color=np.broadcast_to(np.asarray(color, np.float32), (n, 3)).copy(),
            t0=np.broadcast_to(np.asarray(t0, np.float32), (n,)).copy(),
            bias=np.full(n, bias, np.float32),
            pop=np.full(n, pop, np.float32),
            flash=np.full(n, flash, np.float32),
        ))

    # needles: whorls of drooping branches, denser and longer at the bottom
    def _needles(self, rng):
        branches = []
        for i, y in enumerate(np.linspace(Y0 + 0.02, Y1 - 0.06, 28)):
            u = (y - Y0) / (Y1 - Y0)
            R = float(envelope(y)) + 0.05
            nb = int(6 + 12 * (1 - u))
            droop = 0.08 + 0.12 * (1 - u)
            for b in range(nb):
                a = TAU * (b + 0.5 * rng.random()) / nb + i * 0.77
                L = R * rng.uniform(0.85, 1.0)
                n = int(24 + 130 * L)
                s = rng.random(n) ** 0.65
                dx, dz = math.cos(a), math.sin(a)
                side = rng.normal(0, 1, n) * (0.02 + 0.07 * s)
                lift = rng.normal(0, 1, n) * (0.01 + 0.025 * s)
                r = L * s
                p = np.stack([dx * r - dz * side, y - droop * s ** 2 + lift, dz * r + dx * side], 1)
                col = mix(DEEP, LEAF, (rng.random(n) ** 0.7) * (0.45 + 0.55 * s))
                t0 = grow_time(p[:, 1]) + rng.random(n) * 0.12
                snow = (s > 0.6) & (rng.random(n) < 0.03)
                self.add(p[~snow], NEEDLE, col[~snow], t0[~snow], flash=0.5)
                self.add(p[snow], SNOW, mix(WHITE, (190, 205, 225), rng.random(snow.sum())),
                         t0[snow], flash=0.5)
                branches.append((dx, dz, L, y, droop))
        return branches

    # dark inner cone so nothing shows through the branches
    def _inner(self, rng):
        m = 6000
        y = Y0 + (Y1 - Y0) * rng.random(m)
        r = envelope(y) * 0.8 * np.sqrt(rng.random(m))
        phi = rng.uniform(0, TAU, m)
        p = np.stack([np.cos(phi) * r, y, np.sin(phi) * r], 1)
        col = mix((6, 34, 18), (12, 58, 28), rng.random(m))
        self.add(p, INNER, col, grow_time(y), flash=0.3)

    def _trunk(self, rng):
        m = 1500
        y = rng.uniform(GROUND, Y0 + 0.25, m)
        phi = rng.uniform(0, TAU, m)
        p = np.stack([np.cos(phi) * 0.075, y, np.sin(phi) * 0.075], 1)
        col = mix(TRUNK, (80, 46, 24), rng.random(m))
        self.add(p, TRUNK_K, col, grow_time(y), normal=radial_normals(p, 0.0), flash=0.4)

    # tinsel garland: a gold spiral drooping in swags between hanging points
    def _tinsel(self, rng):
        n = 1600
        s = np.linspace(0, 1, n)
        turns = 3.6
        yg = Y0 + 0.12 + (Y1 - Y0 - 0.42) * s
        ag = TAU * turns * s
        swag = -0.06 * np.abs(np.sin(ag * 2.5))
        rg = cone(yg) * 0.95 + 0.05
        p = np.stack([np.cos(ag) * rg, yg + swag, np.sin(ag) * rg], 1)
        p += rng.normal(0, 0.012, (n, 3))
        col = mix(GOLD, (255, 240, 190), rng.random(n) * 0.6)
        t0 = T_TINSEL[0] + s * (T_TINSEL[1] - T_TINSEL[0])
        self.add(p, TINSEL, col, t0, bias=0.04, flash=0.6)

    def _baubles(self, rng, branches):
        cand = [b for b in branches if b[3] < Y1 - 0.25]
        pick = rng.choice(len(cand), 34, replace=False)
        sphere = fib_sphere(90)
        colors = [RED, RED, RED, GOLD, GOLD, (215, 225, 240), BLUE]
        times = np.sort(rng.uniform(*T_BALLS, len(pick)))
        order = np.argsort([cand[k][3] for k in pick])           # bottom first
        for t0, k in zip(times, pick[order]):
            dx, dz, L, y, droop = cand[k]
            s = rng.uniform(0.7, 0.95)
            centre = np.array([dx * L * s, y - droop * s ** 2 - 0.05, dz * L * s])
            rad = rng.uniform(0.045, 0.07)
            col = colors[rng.integers(len(colors))]
            n = len(sphere)
            self.add(np.repeat(centre[None], n, 0), BAUBLE, col, t0, off=sphere * rad,
                     normal=sphere, bias=0.02, pop=0.35, flash=0.3)

    # fairy lights on the branch tips
    def _lights(self, rng, branches):
        n = 170
        pick = rng.choice(len(branches), n, replace=len(branches) < n)
        palette = [WARM] * 12 + [GOLD] * 3 + [RED] * 2 + [BLUE, WHITE]
        t0 = np.sort(T_LIGHTS[0] + rng.random(n) * (T_LIGHTS[1] - T_LIGHTS[0]))
        pts, cols = [], []
        for k in pick:
            dx, dz, L, y, droop = branches[k]
            s = rng.uniform(0.75, 1.0)
            pts.append([dx * L * s, y - droop * s ** 2, dz * L * s])
            cols.append(palette[rng.integers(len(palette))])
        pts = np.array(pts)
        pts = pts[np.argsort(pts[:, 1])]                          # switch on bottom -> top
        self.add(pts, LIGHT, np.array(cols, np.float32), t0, bias=0.06, flash=0.25)

    # presents: boxes with a crossed ribbon and a bow
    def _gifts(self, rng):
        gifts = [  # angle, distance, w, d, h, rotation, body, ribbon
            (0.3, 1.10, 0.24, 0.20, 0.22, 0.4, RED, GOLD),
            (1.5, 1.16, 0.22, 0.22, 0.18, 1.1, BLUE, GOLD),
            (2.6, 1.08, 0.28, 0.16, 0.20, 0.2, GOLD, RED),
            (3.7, 1.14, 0.22, 0.22, 0.26, 0.7, RED, WHITE),
            (4.7, 1.10, 0.24, 0.18, 0.24, 0.1, GREEN_BOX, RED),
            (5.6, 1.18, 0.20, 0.20, 0.16, 0.9, (220, 228, 240), RED),
        ]
        times = np.linspace(*T_GIFTS, len(gifts))
        for (a, dist, w, d, h, rot, body, ribbon), t0 in zip(gifts, times):
            areas = np.array([w * d, d * h, d * h, w * h, w * h])
            n = int(areas.sum() * 7000)
            face = rng.choice(5, n, p=areas / areas.sum())
            u, v = rng.random(n) - 0.5, rng.random(n)
            p = np.zeros((n, 3))
            nr = np.zeros((n, 3))
            m = face == 0                                             # top
            p[m] = np.stack([u[m] * w, np.full(m.sum(), h), (v[m] - 0.5) * d], 1)
            nr[m] = [0, 1, 0]
            for f, sx in ((1, 1), (2, -1)):                           # x sides
                m = face == f
                p[m] = np.stack([np.full(m.sum(), sx * w / 2), v[m] * h, u[m] * d], 1)
                nr[m] = [sx, 0, 0]
            for f, sz in ((3, 1), (4, -1)):                           # z sides
                m = face == f
                p[m] = np.stack([u[m] * w, v[m] * h, np.full(m.sum(), sz * d / 2)], 1)
                nr[m] = [0, 0, sz]
            rw = 0.018
            is_rib = (np.abs(p[:, 0]) < rw) | (np.abs(p[:, 2]) < rw)
            col = np.where(is_rib[:, None], np.asarray(ribbon, np.float32), np.asarray(body, np.float32))
            col = col * rng.uniform(0.85, 1.0, (n, 1))
            # bow: two loops on top
            th = rng.uniform(0, TAU, 360)
            sgn = np.where(np.arange(360) % 2 == 0, 1, -1)
            bow = np.stack([sgn * (0.045 + 0.045 * np.cos(th)), h + 0.03 + 0.03 * np.sin(th),
                            rng.normal(0, 0.008, 360)], 1)
            bow_n = np.stack([np.cos(th) * sgn, np.sin(th), np.zeros(360)], 1)
            p = np.vstack([p, bow])
            nr = np.vstack([nr, bow_n])
            col = np.vstack([col, np.broadcast_to(np.asarray(ribbon, np.float32), (360, 3))])
            # rotate the box and move it next to the tree
            c, s = math.cos(rot), math.sin(rot)
            rotm = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
            p, nr = p @ rotm.T, nr @ rotm.T
            base = np.array([math.cos(a) * dist, GROUND, math.sin(a) * dist])
            self.add(np.repeat(base[None], len(p), 0), GIFT, col, t0, off=p, normal=nr,
                     bias=0.0, pop=0.4, flash=0.25)


# ================================================================== renderer
def build_atlas(cw, ch):
    """Pre-render every glyph once as a (ch, cw) brightness mask."""
    size, font = ch + 4, None
    while size > 6:
        font = pygame.font.SysFont(FONT_NAMES, size)
        if font.size("W")[0] <= cw + 1 and font.get_height() <= ch + 4:
            break
        size -= 1
    glyphs = [chr(c) for c in range(32, 127)] + ["°"]
    atlas = np.zeros((len(glyphs), ch, cw), np.uint8)
    cell = pygame.Surface((cw, ch))
    for i, g in enumerate(glyphs):
        s = font.render(g, True, (255, 255, 255), (0, 0, 0))
        cell.fill((0, 0, 0))
        cell.blit(s, ((cw - s.get_width()) // 2, (ch - s.get_height()) // 2))
        atlas[i] = pygame.surfarray.array3d(cell)[:, :, 0].T
    return atlas, {g: i for i, g in enumerate(glyphs)}


class Renderer:
    def __init__(self, cw, ch):
        self.cw, self.ch = cw, ch
        self.W, self.H = COLS * cw, ROWS * ch
        self.atlas, self.glyph = build_atlas(cw, ch)
        self.atlas_t = np.ascontiguousarray(self.atlas.transpose(0, 2, 1))   # (glyph, cw, ch)
        self.mask = pygame.display.get_surface().copy()
        self.small = pygame.Surface((COLS, ROWS), 0, pygame.display.get_surface())
        self.lut = np.zeros((len(CHARSETS), LEVELS), np.int16)
        for k, cs in CHARSETS.items():
            ids = [self.glyph[c] for c in cs]
            self.lut[k] = [ids[min(len(ids) - 1, j * len(ids) // LEVELS)] for j in range(LEVELS)]
        self.scene = Scene()

        self.unit = self.H * 0.27                  # pixels per world unit at the axis
        self.focal = self.unit * CAM_D
        self.cx, self.cy = self.W / 2, self.H * 0.43

        rng = np.random.default_rng(3)             # faint dashed backdrop
        r = rng.random((ROWS, COLS))
        g = self.glyph
        self.bg_char = np.where(r < 0.33, g["-"], np.where(r < 0.58, g["."], g[" "])).astype(np.int16)
        self.bg_col = (np.array(DIM) * rng.uniform(0.55, 1.0, (ROWS, COLS, 1))).astype(np.uint8)
        self.reset()

    def reset(self):
        rng = np.random.default_rng()
        n = 150
        self.flakes = np.stack([rng.uniform(0, self.W, n), rng.uniform(0, self.H, n),
                                rng.uniform(14, 46, n), rng.uniform(0, TAU, n), rng.random(n)], 1)

    # ---------------------------------------------------------- projection
    def project(self, x, y, z):
        ct, st = math.cos(TILT), math.sin(TILT)
        y, z = y * ct - z * st, y * st + z * ct
        k = self.focal / (CAM_D - z)
        return self.cx + x * k, self.cy - y * k, z

    # ---------------------------------------------------------- frame
    def draw(self, screen, t, dt, paused=False):
        chars = self.bg_char.copy()
        cols = self.bg_col.copy()
        glow = np.zeros((ROWS, COLS, 3), np.float32)

        self._snow(chars, cols, t, dt)
        lit, count = self._tree(chars, cols, glow, t)
        self._star(chars, cols, glow, t)
        self._message(chars, cols, glow, t)

        deg = math.degrees(SPIN * t) % 360
        self._text(chars, cols, ROWS - 7, 2, "christmas_tree.py", (150, 130, 80))
        self._text(chars, cols, ROWS - 6, 2, f"rotation {deg:06.2f}°", HUD)
        self._text(chars, cols, ROWS - 6, 28, f"lights {lit:3d}", HUD)
        self._text(chars, cols, ROWS - 5, 2, f"particles {count:,}", HUD)
        self._text(chars, cols, ROWS - 2, 2, HINT, (66, 72, 92))
        if paused:
            self._text(chars, cols, ROWS - 7, COLS - 10, "PAUSED", ACCENT)
        self._blit(screen, chars, cols, glow)

    def _snow(self, chars, cols, t, dt):
        f = self.flakes
        if dt > 0:
            f[:, 1] = (f[:, 1] + f[:, 2] * dt) % self.H
            f[:, 0] = (f[:, 0] + np.sin(t * 0.7 + f[:, 3]) * 10 * dt) % self.W
        c = (f[:, 0] // self.cw).astype(int)
        r = (f[:, 1] // self.ch).astype(int)
        size = f[:, 4]
        g = self.glyph
        chars[r, c] = np.where(size < 0.55, g["."], np.where(size < 0.85, g["+"], g["*"]))
        cols[r, c] = (np.array(WHITE) * (0.45 + 0.55 * size)[:, None]).astype(np.uint8)

    def _tree(self, chars, cols, glow, t):
        S = self.scene
        vis = np.nonzero(S.t0 <= t)[0]
        lit = int(((S.kind == LIGHT) & (S.t0 <= t)).sum())
        if len(vis) == 0:
            return lit, 0
        age = t - S.t0[vis]
        g = ease_out_back(np.clip(age / S.pop[vis], 0, 1))
        pos = S.anchor[vis] + S.off[vis] * g[:, None]
        nrm = S.normal[vis]

        a = SPIN * t
        c, s = math.cos(a), math.sin(a)
        x = pos[:, 0] * c + pos[:, 2] * s
        z = -pos[:, 0] * s + pos[:, 2] * c
        nx = nrm[:, 0] * c + nrm[:, 2] * s
        nz = -nrm[:, 0] * s + nrm[:, 2] * c
        ny = nrm[:, 1]
        ct, st = math.cos(TILT), math.sin(TILT)
        ny, nz = ny * ct - nz * st, ny * st + nz * ct
        px, py, z = self.project(x, pos[:, 1], z)

        cc = np.floor(px / self.cw).astype(np.int32)
        rr = np.floor(py / self.ch).astype(np.int32)
        ok = (cc >= 0) & (cc < COLS) & (rr >= 0) & (rr < ROWS)
        vis, age, cc, rr, z, nx, ny, nz = vis[ok], age[ok], cc[ok], rr[ok], z[ok], nx[ok], ny[ok], nz[ok]
        cell = rr * COLS + cc

        # keep only the particle nearest to the camera in every cell
        order = np.argsort(-(z + S.bias[vis]), kind="stable")
        cells, first = np.unique(cell[order], return_index=True)
        w = order[first]
        dens = np.bincount(cell, minlength=ROWS * COLS)[cells]

        idx = vis[w]
        kind = S.kind[idx]
        shade = np.clip(nx[w] * LIGHT_DIR[0] + ny[w] * LIGHT_DIR[1] + nz[w] * LIGHT_DIR[2], 0, 1)
        lum = 0.28 + 0.50 * shade + 0.25 * np.clip(nz[w], 0, 1)
        lum *= 0.75 + 0.25 * np.clip(dens / 5, 0, 1)

        is_light = kind == LIGHT
        tw = (0.5 + 0.5 * np.sin(t * S.rate[idx] + S.phase[idx])) ** 1.5
        lum = np.where(is_light, 0.35 + 0.65 * tw, lum)
        is_tinsel = kind == TINSEL
        lum = np.where(is_tinsel, lum * (0.75 + 0.35 * np.sin(t * 6 + S.phase[idx] * 3)), lum)
        lum = np.where(kind == INNER, lum * 0.6, lum)

        color = S.color[idx] * (0.40 + 0.80 * lum)[:, None]
        color = np.where(is_light[:, None], S.color[idx] * (0.45 + 0.75 * tw)[:, None], color)

        fl = S.flash[idx]
        f = np.clip(1 - age[w] / np.maximum(fl, 1e-3), 0, 1) ** 1.5 * (fl > 0)
        color = color + (np.array(WHITE, np.float32) - color) * f[:, None]
        lum = np.maximum(lum, f)
        color = np.clip(color, 0, 255)

        lvl = np.clip(lum * LEVELS, 0, LEVELS - 1).astype(np.int32)
        chars.reshape(-1)[cells] = self.lut[kind, lvl]
        cols.reshape(-1, 3)[cells] = color.astype(np.uint8)

        gw = np.select([is_light, is_tinsel, kind == BAUBLE], [0.9 * tw, 0.05, 0.08], 0.0) + 0.35 * f
        glow.reshape(-1, 3)[cells] += color * gw[:, None]
        return lit, len(vis)

    def _put(self, chars, cols, r, c, ch, color):
        if 0 <= r < ROWS and 0 <= c < COLS:
            chars[r, c] = self.glyph[ch]
            cols[r, c] = np.clip(color, 0, 255)

    def _text(self, chars, cols, r, c, text, color):
        for i, chh in enumerate(text):
            if chh != " ":
                self._put(chars, cols, r, c + i, chh, color)

    # star: thin rays first, then a filled five-pointed star that bursts white and settles to gold
    def _star(self, chars, cols, glow, t):
        age = t - T_STAR
        if age < -0.6:
            return
        sx, sy, _ = self.project(0.0, Y1 + 0.07, 0.0)
        R = 0.15 * self.unit
        flash = float(np.clip(1 - age / 1.2, 0, 1) ** 2) if age >= 0 else 0.0
        gold = np.array(GOLD, np.float32)
        white = np.array(WHITE, np.float32)

        if age < 0:
            ray_len, ray_b = R * 2.5 * (age + 0.6) / 0.6, 0.5
        else:
            ray_len = R * (0.6 + 4.5 * flash) + R * 0.3 * (1 + math.sin(t * 3))
            ray_b = 0.35 + 0.65 * flash
        step = min(self.cw, self.ch) * 0.5
        for k in range(8):
            ang = k * math.pi / 4
            length = ray_len * (1.0 if k % 2 == 0 else 0.6)
            sym = "-" if k % 4 == 0 else "|" if k % 4 == 2 else ("\\" if k in (1, 5) else "/")
            d = R * 0.9
            while d < R * 0.9 + length:
                fade = 1 - (d - R * 0.9) / (length + 1e-6)
                col = (gold + (white - gold) * flash) * ray_b * (0.4 + 0.6 * fade)
                c = int((sx + math.cos(ang) * d) // self.cw)
                r = int((sy + math.sin(ang) * d) // self.ch)
                self._put(chars, cols, r, c, sym, col)
                if 0 <= r < ROWS and 0 <= c < COLS:
                    glow[r, c] += col * 0.4
                d += step

        if age < 0:
            return
        Rg = R * float(ease_out_back(min(1.0, age / 0.35)))
        poly = [(math.cos(-math.pi / 2 + i * math.pi / 5) * (Rg if i % 2 == 0 else 0.45 * Rg),
                 math.sin(-math.pi / 2 + i * math.pi / 5) * (Rg if i % 2 == 0 else 0.45 * Rg))
                for i in range(10)]
        twinkle = 0.85 + 0.15 * math.sin(t * 2.5)
        c0, c1 = int((sx - Rg) // self.cw) - 1, int((sx + Rg) // self.cw) + 1
        r0, r1 = int((sy - Rg) // self.ch) - 1, int((sy + Rg) // self.ch) + 1
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                dx = (c + 0.5) * self.cw - sx
                dy = (r + 0.5) * self.ch - sy
                if not inside_polygon(dx, dy, poly):
                    continue
                dn = math.hypot(dx, dy) / max(Rg, 1e-6)
                sym = "@" if dn < 0.3 else "#" if dn < 0.65 else "*"
                col = (gold + (white - gold) * max(flash, 0.3 * (1 - dn))) * twinkle
                self._put(chars, cols, r, c, sym, col)
                if 0 <= r < ROWS and 0 <= c < COLS:
                    glow[r, c] += col * 0.6

    def _message(self, chars, cols, glow, t):
        if t < T_MSG:
            return
        text = " ".join(MESSAGE)
        speed = 14
        shown = min(len(text), int((t - T_MSG) * speed))
        row = ROWS - 11
        c0 = (COLS - len(text)) // 2
        palette = (RED, GOLD, GREEN)
        for i, chh in enumerate(text[:shown]):
            if chh == " ":
                continue
            age = t - T_MSG - i / speed
            f = float(np.clip(1 - age / 0.5, 0, 1) ** 2)
            tint = np.array(palette[(i // 2 + int(t * 1.5)) % 3], np.float32)
            col = (tint + (np.array(WHITE, np.float32) - tint) * f) * (0.85 + 0.15 * math.sin(t * 4 + i))
            self._put(chars, cols, row, c0 + i, chh, col)
            glow[row, c0 + i] += col * 0.45

    # ---------------------------------------------------------- pixels
    def _blit(self, screen, chars, cols, glow):
        # 1) glyph brightness masks laid out as one big grey image
        m = self.atlas_t[chars.T].transpose(0, 2, 1, 3).reshape(self.W, self.H)
        pygame.surfarray.blit_array(self.mask, m.astype(np.uint32) * 0x010101)
        # 2) cell colours, scaled up so every cell is a solid block of its colour
        pygame.surfarray.blit_array(self.small, cols.transpose(1, 0, 2))
        pygame.transform.scale(self.small, (self.W, self.H), screen)
        # 3) colour x mask = coloured characters
        screen.blit(self.mask, (0, 0), special_flags=pygame.BLEND_RGB_MULT)
        # 4) soft bloom around lights, star and letters (+ background tint)
        half = glow.reshape(ROWS // 2, 2, COLS // 2, 2, 3).mean((1, 3))
        for g, gain, bg in ((glow, 1.0, BG), (half, 1.3, (0, 0, 0))):
            arr = np.clip(g * gain + np.array(bg, np.float32), 0, 255).astype(np.uint8)
            surf = pygame.surfarray.make_surface(np.ascontiguousarray(arr.transpose(1, 0, 2)))
            screen.blit(pygame.transform.smoothscale(surf, (self.W, self.H)), (0, 0),
                        special_flags=pygame.BLEND_RGB_ADD)


# ================================================================== main
def pick_cell_height():
    if len(sys.argv) > 1:
        return int(sys.argv[1])
    try:
        desk_h = pygame.display.get_desktop_sizes()[0][1]
    except Exception:
        desk_h = pygame.display.Info().current_h
    return int(np.clip((desk_h - 140) // ROWS, 8, 14))


def main():
    pygame.init()
    ch = pick_cell_height()
    cw = max(5, round(ch * 0.64))
    screen = pygame.display.set_mode((COLS * cw, ROWS * ch))
    pygame.display.set_caption(TITLE)
    renderer = Renderer(cw, ch)
    clock = pygame.time.Clock()
    t, paused = 0.0, False

    while True:
        dt = min(clock.tick(FPS) / 1000, 0.1)
        for e in pygame.event.get():
            if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE):
                pygame.quit()
                return
            if e.type == pygame.KEYDOWN:
                if e.key == pygame.K_SPACE:
                    paused = not paused
                elif e.key == pygame.K_r:
                    t = 0.0
                    renderer.reset()
                elif e.key == pygame.K_s:
                    name = time.strftime("christmas_tree_%Y%m%d_%H%M%S.png")
                    pygame.image.save(screen, name)
                    print("saved", name)
        if not paused:
            t += dt
            if LOOP and t > T_END:
                t = 0.0
                renderer.reset()
        renderer.draw(screen, t, 0 if paused else dt, paused)
        pygame.display.flip()


if __name__ == "__main__":
    main()