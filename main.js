/*
 * ASCII Christmas Tree — web port of python/christmas_tree.py
 * A rotating 3D particle Christmas tree drawn entirely with coloured ASCII
 * characters on a <canvas>. Plain JavaScript, no dependencies.
 *
 * Keys: Space pause   R restart   S screenshot
 * Touch: tap to pause/resume, on-screen buttons for restart and screenshot.
 * Debug: ?t=14 starts the timeline at 14 seconds.
 */
'use strict';

(() => {
  // ---------------------------------------------------------------- grid
  const COLS = 88, ROWS = 74;          // size of the character grid
  const CW = 8, CH = 12;               // reference cell size (simulation space, px)
  const W = COLS * CW, H = ROWS * CH;
  const FONT = 'Consolas, Menlo, "DejaVu Sans Mono", "Cascadia Mono", "Roboto Mono", "Courier New", monospace';
  const MESSAGE = 'MERRY CHRISTMAS 2026';
  const LOOP = false;                  // true = start over automatically

  // ---------------------------------------------------------------- colours
  const BG = [6, 8, 14];
  const DIM = [38, 46, 70];
  const WHITE = [235, 242, 255];
  const GOLD = [255, 196, 64];
  const WARM = [255, 222, 150];
  const RED = [232, 46, 50];
  const GREEN = [46, 190, 84];
  const GREEN_BOX = [34, 150, 70];
  const BLUE = [58, 108, 255];
  const DEEP = [20, 100, 48];
  const LEAF = [84, 225, 110];
  const TRUNK = [124, 76, 40];
  const HUD = [96, 104, 122];
  const ACCENT = [255, 196, 90];

  // ---------------------------------------------------------------- timeline (seconds)
  const T_GROW = [0.3, 6.0];
  const T_TINSEL = [5.8, 8.0];
  const T_BALLS = [7.4, 9.4];
  const T_LIGHTS = [8.6, 11.0];
  const T_GIFTS = [10.2, 12.0];
  const T_STAR = 12.4;
  const T_MSG = 13.4;
  const T_END = 24.0;
  const SPIN = 18 * Math.PI / 180;     // rad/s

  // ---------------------------------------------------------------- 3D world
  const TAU = 2 * Math.PI;
  const GROUND = -1.0;
  const Y0 = -0.80, Y1 = 1.22;
  const CAM_D = 5.0;
  const TILT = 0.10;
  const LIGHT_DIR = (() => {
    const v = [-0.45, 0.55, 0.70], l = Math.hypot(...v);
    return v.map((x) => x / l);
  })();

  const NEEDLE = 0, SNOW = 1, INNER = 2, TRUNK_K = 3, TINSEL = 4, BAUBLE = 5, LIGHT = 6, GIFT = 7;
  const LEVELS = 16;
  const CHARSETS = [           // dark -> bright, indexed by kind
    '.-~^*+=vx%&#W',
    '.,:*+',
    '.,-~^',
    '.:=#H',
    '-~=*@',
    '.:o0%@',
    'oO0@',
    '.:%#X',
  ];

  // glyph table: printable ASCII + degree sign
  const GLYPHS = [];
  for (let c = 32; c < 127; c++) GLYPHS.push(String.fromCharCode(c));
  GLYPHS.push('°');
  const GI = new Map(GLYPHS.map((g, i) => [g, i]));
  const SPACE = GI.get(' ');

  const LUT = new Uint8Array(CHARSETS.length * LEVELS);
  CHARSETS.forEach((cs, k) => {
    for (let j = 0; j < LEVELS; j++) {
      LUT[k * LEVELS + j] = GI.get(cs[Math.min(cs.length - 1, Math.floor(j * cs.length / LEVELS))]);
    }
  });

  // ================================================================ helpers
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Rng {
    constructor(seed) { this.next = mulberry32(seed); this.spare = null; }
    random() { return this.next(); }
    uniform(a, b) { return a + (b - a) * this.next(); }
    int(n) { return Math.floor(this.next() * n); }
    normal() {                                   // Box–Muller
      if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
      let u = 0;
      while (u === 0) u = this.next();
      const v = this.next();
      const m = Math.sqrt(-2 * Math.log(u));
      this.spare = m * Math.sin(TAU * v);
      return m * Math.cos(TAU * v);
    }
    sample(n, k) {                               // k distinct indices out of n
      const a = Array.from({ length: n }, (_, i) => i);
      for (let i = 0; i < k; i++) {
        const j = i + this.int(n - i);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, k);
    }
  }

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

  function easeOutBack(x) {
    const c = 1.7;
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
  }

  function cone(y) {                             // smooth outline of the tree
    const u = clamp((y - Y0) / (Y1 - Y0), 0, 1);
    return 1.08 * (1 - u) ** 1.05;
  }

  function envelope(y) {                         // outline with tiers
    const u = clamp((y - Y0) / (Y1 - Y0), 0, 1);
    const tiers = 1 - ((u * 6) % 1);
    return cone(y) * (0.80 + 0.20 * tiers);
  }

  function growTime(y) {
    const u = clamp((y - GROUND) / (Y1 - GROUND), 0, 1);
    return T_GROW[0] + (T_GROW[1] - T_GROW[0]) * u;
  }

  function fibSphere(n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const i = k + 0.5;
      const phi = Math.acos(1 - 2 * i / n);
      const th = Math.PI * (1 + Math.sqrt(5)) * i;
      out.push([Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi)]);
    }
    return out;
  }

  function insidePolygon(x, y, poly) {           // even-odd test
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ================================================================ scene
  /** Every particle of the tree, stored in flat typed arrays. */
  class Scene {
    constructor(seed = 7) {
      const rng = new Rng(seed);
      this.tmp = { anchor: [], off: [], normal: [], color: [], kind: [], t0: [], bias: [], pop: [], flash: [] };
      const branches = this.needles(rng);
      this.inner(rng);
      this.trunk(rng);
      this.tinsel(rng);
      this.baubles(rng, branches);
      this.lights(rng, branches);
      this.gifts(rng);

      const T = this.tmp;
      const n = T.kind.length;
      this.n = n;
      this.anchor = Float32Array.from(T.anchor);
      this.off = Float32Array.from(T.off);
      this.normal = Float32Array.from(T.normal);
      this.color = Float32Array.from(T.color);
      this.kind = Uint8Array.from(T.kind);
      this.t0 = Float32Array.from(T.t0);
      this.bias = Float32Array.from(T.bias);
      this.pop = Float32Array.from(T.pop);
      this.flash = Float32Array.from(T.flash);
      this.phase = new Float32Array(n);
      this.rate = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        this.phase[i] = rng.uniform(0, TAU);
        this.rate[i] = rng.uniform(1.5, 4.5);
      }
      this.tmp = null;
    }

    /** Add one particle. `normal` null = radial normal with an upward tilt. */
    add(anchor, off, normal, color, kind, t0, bias = 0, pop = 0.01, flash = 0) {
      const T = this.tmp;
      if (!normal) {
        const px = anchor[0] + off[0], pz = anchor[2] + off[2];
        const r = Math.hypot(px, pz) + 1e-6;
        normal = [px / r, 0.4, pz / r];
      }
      const l = Math.hypot(normal[0], normal[1], normal[2]) || 1;
      T.anchor.push(anchor[0], anchor[1], anchor[2]);
      T.off.push(off[0], off[1], off[2]);
      T.normal.push(normal[0] / l, normal[1] / l, normal[2] / l);
      T.color.push(color[0], color[1], color[2]);
      T.kind.push(kind);
      T.t0.push(t0);
      T.bias.push(bias);
      T.pop.push(pop);
      T.flash.push(flash);
    }

    // needles: whorls of drooping branches, denser and longer at the bottom
    needles(rng) {
      const branches = [];
      const Z = [0, 0, 0];
      const whorls = 28, ya = Y0 + 0.02, yb = Y1 - 0.06;
      for (let i = 0; i < whorls; i++) {
        const y = ya + (yb - ya) * i / (whorls - 1);
        const u = (y - Y0) / (Y1 - Y0);
        const R = envelope(y) + 0.05;
        const nb = Math.floor(6 + 12 * (1 - u));
        const droop = 0.08 + 0.12 * (1 - u);
        for (let b = 0; b < nb; b++) {
          const a = TAU * (b + 0.5 * rng.random()) / nb + i * 0.77;
          const L = R * rng.uniform(0.85, 1.0);
          const n = Math.floor(24 + 130 * L);
          const dx = Math.cos(a), dz = Math.sin(a);
          for (let j = 0; j < n; j++) {
            const s = rng.random() ** 0.65;
            const side = rng.normal() * (0.02 + 0.07 * s);
            const lift = rng.normal() * (0.01 + 0.025 * s);
            const r = L * s;
            const p = [dx * r - dz * side, y - droop * s * s + lift, dz * r + dx * side];
            const t0 = growTime(p[1]) + rng.random() * 0.12;
            if (s > 0.6 && rng.random() < 0.03) {
              this.add(p, Z, null, mix(WHITE, [190, 205, 225], rng.random()), SNOW, t0, 0, 0.01, 0.5);
            } else {
              const col = mix(DEEP, LEAF, rng.random() ** 0.7 * (0.45 + 0.55 * s));
              this.add(p, Z, null, col, NEEDLE, t0, 0, 0.01, 0.5);
            }
          }
          branches.push({ dx, dz, L, y, droop });
        }
      }
      return branches;
    }

    // dark inner cone so nothing shows through the branches
    inner(rng) {
      const Z = [0, 0, 0];
      for (let i = 0; i < 6000; i++) {
        const y = Y0 + (Y1 - Y0) * rng.random();
        const r = envelope(y) * 0.8 * Math.sqrt(rng.random());
        const phi = rng.uniform(0, TAU);
        const col = mix([6, 34, 18], [12, 58, 28], rng.random());
        this.add([Math.cos(phi) * r, y, Math.sin(phi) * r], Z, null, col, INNER, growTime(y), 0, 0.01, 0.3);
      }
    }

    trunk(rng) {
      const Z = [0, 0, 0];
      for (let i = 0; i < 1500; i++) {
        const y = rng.uniform(GROUND, Y0 + 0.25);
        const phi = rng.uniform(0, TAU);
        const c = Math.cos(phi), s = Math.sin(phi);
        const col = mix(TRUNK, [80, 46, 24], rng.random());
        this.add([c * 0.075, y, s * 0.075], Z, [c, 0, s], col, TRUNK_K, growTime(y), 0, 0.01, 0.4);
      }
    }

    // tinsel garland: a gold spiral drooping in swags between hanging points
    tinsel(rng) {
      const Z = [0, 0, 0];
      const n = 1600, turns = 3.6;
      for (let i = 0; i < n; i++) {
        const s = i / (n - 1);
        const yg = Y0 + 0.12 + (Y1 - Y0 - 0.42) * s;
        const ag = TAU * turns * s;
        const swag = -0.06 * Math.abs(Math.sin(ag * 2.5));
        const rg = cone(yg) * 0.95 + 0.05;
        const p = [
          Math.cos(ag) * rg + rng.normal() * 0.012,
          yg + swag + rng.normal() * 0.012,
          Math.sin(ag) * rg + rng.normal() * 0.012,
        ];
        const col = mix(GOLD, [255, 240, 190], rng.random() * 0.6);
        const t0 = T_TINSEL[0] + s * (T_TINSEL[1] - T_TINSEL[0]);
        this.add(p, Z, null, col, TINSEL, t0, 0.04, 0.01, 0.6);
      }
    }

    baubles(rng, branches) {
      const cand = branches.filter((b) => b.y < Y1 - 0.25);
      const pick = rng.sample(cand.length, 34).map((k) => cand[k]);
      pick.sort((a, b) => a.y - b.y);                          // bottom first
      const times = pick.map(() => rng.uniform(T_BALLS[0], T_BALLS[1])).sort((a, b) => a - b);
      const sphere = fibSphere(90);
      const colors = [RED, RED, RED, GOLD, GOLD, [215, 225, 240], BLUE];
      pick.forEach((br, idx) => {
        const s = rng.uniform(0.7, 0.95);
        const centre = [br.dx * br.L * s, br.y - br.droop * s * s - 0.05, br.dz * br.L * s];
        const rad = rng.uniform(0.045, 0.07);
        const col = colors[rng.int(colors.length)];
        for (const q of sphere) {
          this.add(centre, [q[0] * rad, q[1] * rad, q[2] * rad], q, col, BAUBLE, times[idx], 0.02, 0.35, 0.3);
        }
      });
    }

    // fairy lights on the branch tips
    lights(rng, branches) {
      const n = 170;
      const idx = branches.length >= n
        ? rng.sample(branches.length, n)
        : Array.from({ length: n }, () => rng.int(branches.length));
      const palette = [...Array(12).fill(WARM), GOLD, GOLD, GOLD, RED, RED, BLUE, WHITE];
      const t0 = Array.from({ length: n }, () => T_LIGHTS[0] + rng.random() * (T_LIGHTS[1] - T_LIGHTS[0]))
        .sort((a, b) => a - b);
      const pts = idx.map((k) => {
        const br = branches[k];
        const s = rng.uniform(0.75, 1.0);
        return {
          p: [br.dx * br.L * s, br.y - br.droop * s * s, br.dz * br.L * s],
          col: palette[rng.int(palette.length)],
        };
      });
      pts.sort((a, b) => a.p[1] - b.p[1]);                    // switch on bottom -> top
      const Z = [0, 0, 0];
      pts.forEach((q, i) => this.add(q.p, Z, null, q.col, LIGHT, t0[i], 0.06, 0.01, 0.25));
    }

    // presents: boxes with a crossed ribbon and a bow
    gifts(rng) {
      const gifts = [ // angle, distance, w, d, h, rotation, body, ribbon
        [0.3, 1.10, 0.24, 0.20, 0.22, 0.4, RED, GOLD],
        [1.5, 1.16, 0.22, 0.22, 0.18, 1.1, BLUE, GOLD],
        [2.6, 1.08, 0.28, 0.16, 0.20, 0.2, GOLD, RED],
        [3.7, 1.14, 0.22, 0.22, 0.26, 0.7, RED, WHITE],
        [4.7, 1.10, 0.24, 0.18, 0.24, 0.1, GREEN_BOX, RED],
        [5.6, 1.18, 0.20, 0.20, 0.16, 0.9, [220, 228, 240], RED],
      ];
      gifts.forEach(([a, dist, w, d, h, rot, body, ribbon], gi) => {
        const t0 = T_GIFTS[0] + (T_GIFTS[1] - T_GIFTS[0]) * gi / (gifts.length - 1);
        const c = Math.cos(rot), s = Math.sin(rot);
        const base = [Math.cos(a) * dist, GROUND, Math.sin(a) * dist];
        const emit = (p, nr, col) => {
          this.add(base,
            [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]],
            [c * nr[0] + s * nr[2], nr[1], -s * nr[0] + c * nr[2]],
            col, GIFT, t0, 0, 0.4, 0.25);
        };

        const areas = [w * d, d * h, d * h, w * h, w * h];
        const total = areas.reduce((x, y) => x + y, 0);
        const n = Math.floor(total * 7000);
        const rw = 0.018;
        for (let j = 0; j < n; j++) {
          let face = 0, acc = 0;
          const pick = rng.random() * total;
          for (face = 0; face < 4; face++) { acc += areas[face]; if (pick < acc) break; }
          const u = rng.random() - 0.5, v = rng.random();
          let p, nr;
          if (face === 0) { p = [u * w, h, (v - 0.5) * d]; nr = [0, 1, 0]; }
          else if (face <= 2) { const sx = face === 1 ? 1 : -1; p = [sx * w / 2, v * h, u * d]; nr = [sx, 0, 0]; }
          else { const sz = face === 3 ? 1 : -1; p = [u * w, v * h, sz * d / 2]; nr = [0, 0, sz]; }
          const isRib = Math.abs(p[0]) < rw || Math.abs(p[2]) < rw;
          const k = rng.uniform(0.85, 1.0);
          const src = isRib ? ribbon : body;
          emit(p, nr, [src[0] * k, src[1] * k, src[2] * k]);
        }
        // bow: two loops on top
        for (let j = 0; j < 360; j++) {
          const th = rng.uniform(0, TAU);
          const sgn = j % 2 === 0 ? 1 : -1;
          const p = [sgn * (0.045 + 0.045 * Math.cos(th)), h + 0.03 + 0.03 * Math.sin(th), rng.normal() * 0.008];
          emit(p, [Math.cos(th) * sgn, Math.sin(th), 0], ribbon);
        }
      });
    }
  }

  // ================================================================ renderer
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.scene = new Scene();

      this.unit = H * 0.27;                    // reference px per world unit at the axis
      this.focal = this.unit * CAM_D;
      this.cx = W / 2;
      this.cy = H * 0.43;

      const N = ROWS * COLS;
      this.chars = new Uint8Array(N);
      this.cols = new Uint8Array(N * 3);
      this.glow = new Float32Array(N * 3);
      this.depth = new Float32Array(N);
      this.win = new Int32Array(N);
      this.dens = new Uint16Array(N);

      // faint dashed backdrop
      const rng = new Rng(3);
      this.bgChar = new Uint8Array(N);
      this.bgCol = new Uint8Array(N * 3);
      for (let i = 0; i < N; i++) {
        const r = rng.random();
        this.bgChar[i] = r < 0.33 ? GI.get('-') : r < 0.58 ? GI.get('.') : SPACE;
        const k = rng.uniform(0.55, 1.0);
        for (let ch = 0; ch < 3; ch++) this.bgCol[i * 3 + ch] = Math.floor(DIM[ch] * k);
      }

      // small offscreen canvases: per-cell colours, glow and half-res glow
      this.colorCv = makeCanvas(COLS, ROWS);
      this.glowCv = makeCanvas(COLS, ROWS);
      this.halfCv = makeCanvas(COLS / 2, ROWS / 2);
      this.colorImg = this.colorCv.ctx.createImageData(COLS, ROWS);
      this.glowImg = this.glowCv.ctx.createImageData(COLS, ROWS);
      this.halfImg = this.halfCv.ctx.createImageData(COLS / 2, ROWS / 2);
      this.maskCv = makeCanvas(1, 1);

      this.hint = 'Space pause   R restart   S screenshot';
      this.reset();
    }

    reset() {
      const n = 150;
      this.flakes = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        v: 14 + Math.random() * 32, ph: Math.random() * TAU, size: Math.random(),
      }));
    }

    /** Size the canvas to the given device-pixel cell size and rebuild the glyph atlas. */
    resize(cwD, chD, dpr) {
      this.cwD = cwD;
      this.chD = chD;
      this.canvas.width = COLS * cwD;
      this.canvas.height = ROWS * chD;
      // explicit CSS width, height follows the canvas aspect ratio; CSS max-width
      // keeps it on screen even if the viewport size was misreported
      this.canvas.style.width = `${(COLS * cwD) / dpr}px`;
      this.canvas.style.height = 'auto';
      this.maskCv.cv.width = COLS * cwD;
      this.maskCv.cv.height = ROWS * chD;
      this.atlas = buildAtlas(cwD, chD);
    }

    project(x, y, z) {
      const ct = Math.cos(TILT), st = Math.sin(TILT);
      const yt = y * ct - z * st, zt = y * st + z * ct;
      const k = this.focal / (CAM_D - zt);
      return [this.cx + x * k, this.cy - yt * k, zt];
    }

    // ------------------------------------------------------------ frame
    draw(t, dt, paused) {
      this.chars.set(this.bgChar);
      this.cols.set(this.bgCol);
      this.glow.fill(0);

      this.snow(t, dt);
      const [lit, count] = this.tree(t);
      this.star(t);
      this.message(t);

      const deg = ((SPIN * t * 180) / Math.PI) % 360;
      this.text(ROWS - 7, 2, 'christmas_tree.py', [150, 130, 80]);
      this.text(ROWS - 6, 2, `rotation ${deg.toFixed(2).padStart(6, '0')}°`, HUD);
      this.text(ROWS - 6, 28, `lights ${String(lit).padStart(3, ' ')}`, HUD);
      this.text(ROWS - 5, 2, `particles ${count.toLocaleString('en-US')}`, HUD);
      this.text(ROWS - 2, 2, this.hint, [66, 72, 92]);
      if (paused) this.text(ROWS - 7, COLS - 10, 'PAUSED', ACCENT);
      this.blit();
    }

    snow(t, dt) {
      const dot = GI.get('.'), plus = GI.get('+'), star = GI.get('*');
      for (const f of this.flakes) {
        if (dt > 0) {
          f.y = (f.y + f.v * dt) % H;
          f.x = (((f.x + Math.sin(t * 0.7 + f.ph) * 10 * dt) % W) + W) % W;
        }
        const c = Math.floor(f.x / CW), r = Math.floor(f.y / CH);
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        const i = r * COLS + c;
        this.chars[i] = f.size < 0.55 ? dot : f.size < 0.85 ? plus : star;
        const k = 0.45 + 0.55 * f.size;
        this.cols[i * 3] = WHITE[0] * k;
        this.cols[i * 3 + 1] = WHITE[1] * k;
        this.cols[i * 3 + 2] = WHITE[2] * k;
      }
    }

    tree(t) {
      const S = this.scene;
      const { depth, win, dens, chars, cols, glow } = this;
      depth.fill(-Infinity);
      win.fill(-1);
      dens.fill(0);

      const a = SPIN * t, c = Math.cos(a), s = Math.sin(a);
      const ct = Math.cos(TILT), st = Math.sin(TILT);
      const { focal, cx, cy } = this;
      const A = S.anchor, O = S.off, T0 = S.t0, POP = S.pop, BIAS = S.bias, KIND = S.kind;
      let lit = 0, count = 0;

      // pass 1: animate, rotate, project; keep the particle nearest to the camera per cell
      for (let i = 0; i < S.n; i++) {
        const t0 = T0[i];
        if (t0 > t) continue;
        if (KIND[i] === LIGHT) lit++;
        const age = t - t0;
        const pop = POP[i];
        const g = age >= pop ? 1 : easeOutBack(age / pop);
        const j = i * 3;
        const x0 = A[j] + O[j] * g, y0 = A[j + 1] + O[j + 1] * g, z0 = A[j + 2] + O[j + 2] * g;
        const x = x0 * c + z0 * s;
        const zr = -x0 * s + z0 * c;
        const yt = y0 * ct - zr * st, zt = y0 * st + zr * ct;
        const k = focal / (CAM_D - zt);
        const cc = Math.floor((cx + x * k) / CW);
        const rr = Math.floor((cy - yt * k) / CH);
        if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
        count++;
        const cell = rr * COLS + cc;
        dens[cell]++;
        const key = zt + BIAS[i];
        if (key > depth[cell]) { depth[cell] = key; win[cell] = i; }
      }

      // pass 2: shade the winner of every cell
      const NR = S.normal, COL = S.color, FL = S.flash, PH = S.phase, RT = S.rate;
      const [lx, ly, lz] = LIGHT_DIR;
      for (let cell = 0; cell < ROWS * COLS; cell++) {
        const i = win[cell];
        if (i < 0) continue;
        const kind = KIND[i];
        const j = i * 3;
        const nx0 = NR[j], ny0 = NR[j + 1], nz0 = NR[j + 2];
        const nx = nx0 * c + nz0 * s;
        const nzr = -nx0 * s + nz0 * c;
        const ny = ny0 * ct - nzr * st, nz = ny0 * st + nzr * ct;
        const shade = clamp(nx * lx + ny * ly + nz * lz, 0, 1);
        let lum = 0.28 + 0.50 * shade + 0.25 * clamp(nz, 0, 1);
        lum *= 0.75 + 0.25 * Math.min(dens[cell] / 5, 1);

        const isLight = kind === LIGHT;
        const tw = (0.5 + 0.5 * Math.sin(t * RT[i] + PH[i])) ** 1.5;
        if (isLight) lum = 0.35 + 0.65 * tw;
        else if (kind === TINSEL) lum *= 0.75 + 0.35 * Math.sin(t * 6 + PH[i] * 3);
        else if (kind === INNER) lum *= 0.6;

        const m = isLight ? 0.45 + 0.75 * tw : 0.40 + 0.80 * lum;
        let r = COL[j] * m, gg = COL[j + 1] * m, b = COL[j + 2] * m;

        const fl = FL[i];
        const age = t - T0[i];
        const f = fl > 0 ? clamp(1 - age / Math.max(fl, 1e-3), 0, 1) ** 1.5 : 0;
        r += (WHITE[0] - r) * f; gg += (WHITE[1] - gg) * f; b += (WHITE[2] - b) * f;
        if (f > lum) lum = f;
        r = clamp(r, 0, 255); gg = clamp(gg, 0, 255); b = clamp(b, 0, 255);

        const lvl = clamp(Math.floor(lum * LEVELS), 0, LEVELS - 1);
        chars[cell] = LUT[kind * LEVELS + lvl];
        const q = cell * 3;
        cols[q] = r; cols[q + 1] = gg; cols[q + 2] = b;

        const gw = (isLight ? 0.9 * tw : kind === TINSEL ? 0.05 : kind === BAUBLE ? 0.08 : 0) + 0.35 * f;
        if (gw > 0) { glow[q] += r * gw; glow[q + 1] += gg * gw; glow[q + 2] += b * gw; }
      }
      return [lit, count];
    }

    put(r, c, ch, color) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
      const g = GI.get(ch);
      if (g === undefined) return false;
      const i = r * COLS + c;
      this.chars[i] = g;
      this.cols[i * 3] = clamp(color[0], 0, 255);
      this.cols[i * 3 + 1] = clamp(color[1], 0, 255);
      this.cols[i * 3 + 2] = clamp(color[2], 0, 255);
      return true;
    }

    addGlow(r, c, color, k) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
      const q = (r * COLS + c) * 3;
      this.glow[q] += color[0] * k;
      this.glow[q + 1] += color[1] * k;
      this.glow[q + 2] += color[2] * k;
    }

    text(r, c, str, color) {
      for (let i = 0; i < str.length; i++) {
        if (str[i] !== ' ') this.put(r, c + i, str[i], color);
      }
    }

    // star: thin rays first, then a filled five-pointed star that bursts white and settles to gold
    star(t) {
      const age = t - T_STAR;
      if (age < -0.6) return;
      const [sx, sy] = this.project(0, Y1 + 0.07, 0);
      const R = 0.15 * this.unit;
      const flash = age >= 0 ? clamp(1 - age / 1.2, 0, 1) ** 2 : 0;
      const base = mix(GOLD, WHITE, flash);

      let rayLen, rayB;
      if (age < 0) { rayLen = R * 2.5 * (age + 0.6) / 0.6; rayB = 0.5; }
      else { rayLen = R * (0.6 + 4.5 * flash) + R * 0.3 * (1 + Math.sin(t * 3)); rayB = 0.35 + 0.65 * flash; }
      const step = Math.min(CW, CH) * 0.5;
      for (let k = 0; k < 8; k++) {
        const ang = k * Math.PI / 4;
        const length = rayLen * (k % 2 === 0 ? 1.0 : 0.6);
        const sym = k % 4 === 0 ? '-' : k % 4 === 2 ? '|' : (k === 1 || k === 5 ? '\\' : '/');
        for (let d = R * 0.9; d < R * 0.9 + length; d += step) {
          const fade = 1 - (d - R * 0.9) / (length + 1e-6);
          const m = rayB * (0.4 + 0.6 * fade);
          const col = [base[0] * m, base[1] * m, base[2] * m];
          const c = Math.floor((sx + Math.cos(ang) * d) / CW);
          const r = Math.floor((sy + Math.sin(ang) * d) / CH);
          if (this.put(r, c, sym, col)) this.addGlow(r, c, col, 0.4);
        }
      }

      if (age < 0) return;
      const Rg = R * easeOutBack(Math.min(1, age / 0.35));
      const poly = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? Rg : 0.45 * Rg;
        const an = -Math.PI / 2 + i * Math.PI / 5;
        poly.push([Math.cos(an) * rad, Math.sin(an) * rad]);
      }
      const twinkle = 0.85 + 0.15 * Math.sin(t * 2.5);
      const c0 = Math.floor((sx - Rg) / CW) - 1, c1 = Math.floor((sx + Rg) / CW) + 1;
      const r0 = Math.floor((sy - Rg) / CH) - 1, r1 = Math.floor((sy + Rg) / CH) + 1;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * CW - sx, dy = (r + 0.5) * CH - sy;
          if (!insidePolygon(dx, dy, poly)) continue;
          const dn = Math.hypot(dx, dy) / Math.max(Rg, 1e-6);
          const sym = dn < 0.3 ? '@' : dn < 0.65 ? '#' : '*';
          const fcol = mix(GOLD, WHITE, Math.max(flash, 0.3 * (1 - dn)));
          const col = [fcol[0] * twinkle, fcol[1] * twinkle, fcol[2] * twinkle];
          if (this.put(r, c, sym, col)) this.addGlow(r, c, col, 0.6);
        }
      }
    }

    message(t) {
      if (t < T_MSG) return;
      const text = MESSAGE.split('').join(' ');
      const speed = 14;
      const shown = Math.min(text.length, Math.floor((t - T_MSG) * speed));
      const row = ROWS - 11;
      const c0 = Math.floor((COLS - text.length) / 2);
      const palette = [RED, GOLD, GREEN];
      for (let i = 0; i < shown; i++) {
        if (text[i] === ' ') continue;
        const age = t - T_MSG - i / speed;
        const f = clamp(1 - age / 0.5, 0, 1) ** 2;
        const tint = palette[(Math.floor(i / 2) + Math.floor(t * 1.5)) % 3];
        const k = 0.85 + 0.15 * Math.sin(t * 4 + i);
        const m = mix(tint, WHITE, f);
        const col = [m[0] * k, m[1] * k, m[2] * k];
        if (this.put(row, c0 + i, text[i], col)) this.addGlow(row, c0 + i, col, 0.45);
      }
    }

    // ------------------------------------------------------------ pixels
    blit() {
      const { ctx, cwD, chD, chars, cols, glow } = this;
      const Wd = COLS * cwD, Hd = ROWS * chD;
      const N = ROWS * COLS;

      // 1) glyph brightness masks: white characters on black
      const mctx = this.maskCv.ctx;
      mctx.globalCompositeOperation = 'source-over';
      mctx.fillStyle = '#000';
      mctx.fillRect(0, 0, Wd, Hd);
      const atlas = this.atlas;
      for (let r = 0, i = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++, i++) {
          const g = chars[i];
          if (g !== SPACE) mctx.drawImage(atlas, g * cwD, 0, cwD, chD, c * cwD, r * chD, cwD, chD);
        }
      }

      // 2) cell colours, scaled up so every cell is a solid block of its colour
      const cd = this.colorImg.data;
      const gd = this.glowImg.data;
      for (let i = 0; i < N; i++) {
        const p = i * 4, q = i * 3;
        cd[p] = cols[q]; cd[p + 1] = cols[q + 1]; cd[p + 2] = cols[q + 2]; cd[p + 3] = 255;
        gd[p] = glow[q] + BG[0]; gd[p + 1] = glow[q + 1] + BG[1]; gd[p + 2] = glow[q + 2] + BG[2]; gd[p + 3] = 255;
      }
      // half-resolution glow (2x2 average, gain 1.3) for the wide bloom
      const hd = this.halfImg.data, HC = COLS / 2, HR = ROWS / 2;
      for (let r = 0; r < HR; r++) {
        for (let c = 0; c < HC; c++) {
          const a = ((2 * r) * COLS + 2 * c) * 3, b = a + COLS * 3;
          const p = (r * HC + c) * 4;
          for (let ch = 0; ch < 3; ch++) {
            hd[p + ch] = (glow[a + ch] + glow[a + 3 + ch] + glow[b + ch] + glow[b + 3 + ch]) * 0.25 * 1.3;
          }
          hd[p + 3] = 255;
        }
      }
      this.colorCv.ctx.putImageData(this.colorImg, 0, 0);
      this.glowCv.ctx.putImageData(this.glowImg, 0, 0);
      this.halfCv.ctx.putImageData(this.halfImg, 0, 0);

      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.colorCv.cv, 0, 0, Wd, Hd);
      // 3) colour x mask = coloured characters
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.maskCv.cv, 0, 0);
      // 4) soft bloom around lights, star and letters (+ background tint)
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.glowCv.cv, 0, 0, Wd, Hd);
      ctx.drawImage(this.halfCv.cv, 0, 0, Wd, Hd);
      ctx.restore();
    }
  }

  function makeCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    return { cv, ctx: cv.getContext('2d') };
  }

  /** Pre-render every glyph once, white on transparent, one cell each in a row. */
  function buildAtlas(cw, ch) {
    const cv = document.createElement('canvas');
    cv.width = cw * GLYPHS.length;
    cv.height = ch;
    const g = cv.getContext('2d');
    let size = ch + 4;
    while (size > 6) {
      g.font = `${size}px ${FONT}`;
      if (g.measureText('W').width <= cw + 1 && size * 1.17 <= ch + 4) break;
      size--;
    }
    g.font = `${size}px ${FONT}`;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    // centre the font's full line box in the cell (like pygame), then nudge any
    // glyph that would be clipped (e.g. '_') back inside the cell
    const fm = g.measureText('Hg');
    const asc = fm.fontBoundingBoxAscent || size * 0.8;
    const desc = fm.fontBoundingBoxDescent || size * 0.2;
    const baseline = ch / 2 + (asc - desc) / 2;
    GLYPHS.forEach((ch_, i) => {
      const m = g.measureText(ch_);
      let y = baseline;
      if (ch_ === '_' && y + m.actualBoundingBoxDescent > ch) y = ch - m.actualBoundingBoxDescent;
      g.save();
      g.beginPath();
      g.rect(i * cw, 0, cw, ch);
      g.clip();
      g.fillText(ch_, i * cw + cw / 2, Math.round(y));
      g.restore();
    });
    return cv;
  }

  // ================================================================ app
  const canvas = document.getElementById('tree');
  const renderer = new Renderer(canvas);
  const params = new URLSearchParams(location.search);
  const startT = Math.max(0, parseFloat(params.get('t')) || 0);
  // the timeline waits at t=0 behind the start screen until the first tap/key
  let t = 0, paused = false, started = false, last = performance.now(), lastDraw = 0;

  const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (touch) renderer.hint = 'Tap pause   buttons: restart, screenshot';

  /** Largest device-pixel cell size whose grid fits in vw x vh CSS px. */
  function cellSize(vw, vh, dpr) {
    const ratio = CW / CH;
    const chD = Math.max(6, Math.floor(Math.min((vh * dpr) / ROWS, (vw * dpr) / (COLS * ratio))));
    const cwD = Math.max(4, Math.round(chD * ratio));
    return { chD, cwD, cssW: (COLS * cwD) / dpr };
  }

  const musicCard = document.getElementById('music-card');
  const CARD_W = 300;                           // matches .music-card width in style.css

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vv = window.visualViewport;
    const fullW = vv ? vv.width : window.innerWidth;
    const fullH = vv ? vv.height : window.innerHeight;
    const vw = fullW - 16, vh = fullH - 16;
    let size = cellSize(vw, vh, dpr);
    if (!musicCard.hidden) {
      // dock the player beside the tree if it fits there, otherwise put it
      // below the canvas and shrink the tree so nothing is covered
      const dock = (fullW - size.cssW) / 2 >= CARD_W + 24;
      musicCard.classList.toggle('docked', dock);
      if (!dock) size = cellSize(vw, vh - musicCard.offsetHeight - 12, dpr);
    }
    const { chD, cwD } = size;
    if (chD !== renderer.chD || cwD !== renderer.cwD || dpr !== renderer.dpr) {
      renderer.dpr = dpr;
      renderer.resize(cwD, chD, dpr);
      renderer.draw(t, 0, paused);
    }
  }

  function restart() {
    t = 0;
    renderer.reset();
  }

  function togglePause() {
    paused = !paused;
  }

  function screenshot() {
    renderer.draw(t, 0, false);                 // capture without the PAUSED label
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `christmas_tree_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!started) {                             // any key starts; it does nothing else
      if (e.key === 'Tab' || e.key === 'Shift') return;
      e.preventDefault();
      start();
      return;
    }
    // a focused button would also react to Space; the keys belong to the tree
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'r' || e.key === 'R') restart();
    else if (e.key === 's' || e.key === 'S') screenshot();
  });
  canvas.addEventListener('click', togglePause);
  document.getElementById('btn-restart').addEventListener('click', (e) => { e.stopPropagation(); restart(); e.currentTarget.blur(); });
  document.getElementById('btn-shot').addEventListener('click', (e) => { e.stopPropagation(); screenshot(); e.currentTarget.blur(); });
  window.addEventListener('resize', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);

  // ================================================================ music
  // Wham! - Last Christmas, streamed through the official YouTube IFrame
  // Player API (nothing is downloaded or hosted). The player is created behind
  // the start screen, so the start tap can call playVideo() directly; browsers
  // only allow sound to start from a user gesture like that one.
  const VIDEO_ID = 'E8gmARGvPlI';
  const muteBtn = document.getElementById('btn-mute');
  const musicBody = musicCard.querySelector('.music-body');
  const musicFallback = musicCard.querySelector('.music-fallback');
  let player = null, playerReady = false, musicFailed = false, wantPlay = false, muted = false, apiTimer = 0;

  function setMuted(on) {
    muted = on;
    muteBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Unmute music' : 'Mute music';
    muteBtn.title = label;
    muteBtn.setAttribute('aria-label', label);
  }

  function showCard(show) {
    musicCard.hidden = !show;
    fit();
  }

  function musicFail() {
    if (musicFailed) return;
    musicFailed = true;
    wantPlay = false;
    clearTimeout(apiTimer);
    try { if (player && player.destroy) player.destroy(); } catch (_) { /* already gone */ }
    player = null;
    musicBody.hidden = true;
    musicFallback.hidden = false;
    muteBtn.hidden = true;
    showCard(true);
  }

  function playMusic() {
    wantPlay = true;
    if (!playerReady) return;                   // onReady starts it
    if (!muted) player.unMute();
    player.playVideo();
  }

  function createPlayer() {
    clearTimeout(apiTimer);
    apiTimer = setTimeout(() => { if (!playerReady) musicFail(); }, 20000);
    const vars = { autoplay: 0, loop: 1, playlist: VIDEO_ID, playsinline: 1, rel: 0 };
    if (location.protocol.startsWith('http')) vars.origin = location.origin;
    player = new YT.Player('yt-player', {
      width: '100%',
      height: '100%',
      videoId: VIDEO_ID,
      playerVars: vars,
      events: {
        onReady() {
          playerReady = true;
          clearTimeout(apiTimer);
          if (wantPlay) playMusic();            // the start tap came before the player was ready
        },
        onStateChange(e) {
          const S = YT.PlayerState;
          musicCard.dataset.state = e.data === S.PLAYING ? 'playing' : e.data === S.BUFFERING ? 'buffering'
            : e.data === S.PAUSED ? 'paused' : 'idle';
          if (e.data === S.ENDED) { e.target.seekTo(0, true); e.target.playVideo(); }   // loop
        },
        onError: musicFail,
      },
    });
  }

  function loadPlayer() {
    if (window.YT && window.YT.Player) { createPlayer(); return; }
    window.onYouTubeIframeAPIReady = createPlayer;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = musicFail;                      // blocked by an extension or offline
    document.head.appendChild(s);
    apiTimer = setTimeout(() => { if (!playerReady) musicFail(); }, 20000);
  }

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.blur();
    if (musicFailed) return;
    if (musicCard.hidden) {                     // player was closed: bring it back with sound
      setMuted(false);
      showCard(true);
      playMusic();
      return;
    }
    setMuted(!muted);
    if (!playerReady) return;
    if (muted) player.mute();
    else { player.unMute(); if (player.getPlayerState() !== YT.PlayerState.PLAYING) player.playVideo(); }
  });

  document.getElementById('music-close').addEventListener('click', (e) => {
    e.stopPropagation();
    wantPlay = false;
    if (playerReady) player.pauseVideo();       // never play while hidden
    setMuted(true);
    showCard(false);
  });

  // clicking inside the YouTube iframe moves keyboard focus into it; hand it
  // back so Space / R / S keep controlling the tree
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const el = document.activeElement;
      if (el && el.tagName === 'IFRAME') el.blur();
    }, 0);
  });

  // ================================================================ start screen
  // One tap (or any key) starts the tree from t=0 and the song together.
  const startScreen = document.getElementById('start');

  function start() {
    if (started) return;
    started = true;
    t = startT;
    paused = false;
    renderer.reset();
    last = performance.now();
    playMusic();                                // inside the user gesture
    startScreen.classList.add('leaving');
    setTimeout(() => { startScreen.hidden = true; }, 400);
  }

  startScreen.addEventListener('click', (e) => { e.stopPropagation(); start(); });
  startScreen.focus({ preventScroll: true });
  loadPlayer();

  let lastFit = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastDraw < 15) return;          // cap at ~60 fps on high-refresh screens
    lastDraw = now;
    if (now - lastFit > 500) { lastFit = now; fit(); }   // catch missed resize / rotation events
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (started && !paused) {
      t += dt;
      if (LOOP && t > T_END) restart();
    }
    renderer.draw(t, paused ? 0 : dt, paused);
  }

  fit();
  requestAnimationFrame((now) => { last = now; frame(now); });
})();
