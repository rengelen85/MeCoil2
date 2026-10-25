// Procedurally paints the AR zombie sprites (walker, runner, brute, two walk
// frames each) as transparent PNGs. No dependencies: shapes are signed distance
// fields shaded per pixel, then written with a tiny PNG encoder.
//
//   node scripts/gen-zombies.mjs
//
// Output goes to client/src/assets/zombies and mobile/src/assets/zombies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIRS = ['client/src/assets/zombies', 'mobile/src/assets/zombies'];

// Design space is 240x360; rendered at 2x.
const W = 240;
const H = 360;
const S = 2;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mul = (c, k) => c.map((v) => v * k);

function hash(x, y, seed) {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x, y, seed) =>
  noise(x, y, seed) * 0.6 + noise(x * 2.3, y * 2.3, seed + 7) * 0.4;

// Signed distance shapes (negative inside).
const ellipse = (cx, cy, rx, ry) => (x, y) =>
  (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);

const capsule =
  (ax, ay, bx, by, r0, r1 = r0) =>
  (x, y) => {
    const pax = x - ax;
    const pay = y - ay;
    const bax = bx - ax;
    const bay = by - ay;
    const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
    return Math.hypot(pax - bax * h, pay - bay * h) - (r0 + (r1 - r0) * h);
  };

const rbox = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
};

const union =
  (...fs) =>
  (x, y) =>
    Math.min(...fs.map((f) => f(x, y)));
const intersect = (f, g) => (x, y) => Math.max(f(x, y), g(x, y));

const OUTLINE = [12, 16, 10];

class Canvas {
  constructor() {
    this.w = W * S;
    this.h = H * S;
    this.px = new Float32Array(this.w * this.h * 4); // premultiplied RGBA
  }

  blend(i, c, a) {
    const p = this.px;
    const k = 1 - a;
    p[i] = c[0] * a + p[i] * k;
    p[i + 1] = c[1] * a + p[i + 1] * k;
    p[i + 2] = c[2] * a + p[i + 2] * k;
    p[i + 3] = a + p[i + 3] * k;
  }

  // shade(x, y, d) returns [r, g, b] or [r, g, b, alpha]; coordinates are design units.
  paint(sdf, shade, { outline = 2.4 } = {}) {
    for (let py = 0; py < this.h; py++) {
      const y = (py + 0.5) / S;
      for (let px = 0; px < this.w; px++) {
        const x = (px + 0.5) / S;
        const d = sdf(x, y);
        const i = (py * this.w + px) * 4;
        if (outline > 0 && d < outline + 1) {
          const oc = clamp((outline - d) * S + 0.5);
          if (oc > 0) this.blend(i, OUTLINE, oc);
        }
        const cov = clamp(0.5 - d * S);
        if (cov <= 0) continue;
        const c = shade(x, y, d);
        this.blend(i, c, cov * (c[3] ?? 1));
      }
    }
  }

  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        const a = this.px[i + 3];
        const o = y * (this.w * 4 + 1) + 1 + x * 4;
        for (let k = 0; k < 3; k++)
          raw[o + k] =
            a > 0 ? Math.round(clamp(this.px[i + k] / a, 0, 255)) : 0;
        raw[o + 3] = Math.round(clamp(a) * 255);
      }
    }
    return encodePng(this.w, this.h, raw);
  }
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Lit-from-top-left body shader: darker toward the silhouette edge and on the
// lower-right, with grime noise and optional blood stains.
function body(
  sdf,
  base,
  { seed = 1, blood = 0.25, grime = 0.22, bloodColor = [110, 14, 18] } = {},
) {
  return (x, y, d) => {
    const depth = clamp(-d / 11);
    const g = (sdf(x + 3, y + 3) - sdf(x - 3, y - 3)) / 6;
    const edge = Math.exp(Math.min(0, d) / 9);
    let light = 0.62 + 0.38 * depth - 0.2 * g * edge;
    light *= 1 - grime * fbm(x / 5, y / 5, seed);
    let c = mul(base, light);
    const b = fbm(x / 13, y / 13, seed + 31);
    if (blood > 0 && b > 1 - blood)
      c = mix(
        c,
        mul(bloodColor, 0.6 + 0.5 * light),
        clamp((b - (1 - blood)) * 14) * 0.85,
      );
    return c;
  };
}

const flat = (c) => () => c;

const KINDS = {
  walker: {
    skin: [132, 160, 112],
    shirt: [84, 108, 142],
    pants: [62, 56, 70],
    eye: [255, 232, 80],
    hair: [52, 40, 32],
    bw: 1,
    hs: 1,
    mouth: 1,
    lean: 0,
  },
  runner: {
    skin: [158, 176, 128],
    shirt: [152, 52, 50],
    pants: [38, 46, 72],
    eye: [255, 110, 40],
    hair: [30, 28, 28],
    bw: 0.84,
    hs: 0.96,
    mouth: 1.5,
    lean: 14,
  },
  brute: {
    skin: [98, 130, 94],
    shirt: [104, 80, 58],
    pants: [60, 62, 50],
    eye: [255, 40, 30],
    hair: null,
    bw: 1.5,
    hs: 0.92,
    mouth: 1.2,
    lean: 0,
  },
};

function drawZombie(kind, frame) {
  const k = KINDS[kind];
  const cv = new Canvas();
  const f = frame === 0 ? 1 : -1; // walk phase
  const seed = kind.length * 13 + 5;
  const bob = f * 2;
  const cx = 120;
  const bw = k.bw;
  const headX = cx + k.lean + f * 4;
  const headY = 78 + bob + (kind === 'runner' ? 6 : 0);
  const rootY = 160 + bob;

  // Ground shadow.
  cv.paint(
    ellipse(cx, 346, 62 * bw ** 0.6, 9),
    (x, y, d) => [0, 0, 0, 0.35 * clamp(-d / 8)],
    { outline: 0 },
  );

  // Legs: the foot of the stepping leg is lifted.
  const legW = kind === 'brute' ? 23 : 16;
  const legSpread = 22 * bw ** 0.7;
  for (const side of [-1, 1]) {
    const lift = side * f > 0 ? 12 : 0;
    const hipX = cx + side * legSpread * 0.7;
    const footX = cx + side * (legSpread + 4);
    const footY = 332 - lift;
    const leg = capsule(hipX, 228, footX, footY, legW, legW * 0.82);
    cv.paint(leg, body(leg, k.pants, { seed: seed + side, blood: 0.1 }));
    // Torn trouser cuff showing skin and a bare foot.
    const shin = capsule(footX, footY - 14, footX, footY, legW * 0.8);
    cv.paint(shin, body(shin, k.skin, { seed: seed + 9 + side, blood: 0.2 }), {
      outline: 1.8,
    });
    const foot = ellipse(footX + side * 3, footY + 6, legW * 1.1, 8);
    cv.paint(
      foot,
      body(foot, mul(k.skin, 0.85), { seed: seed + 4, blood: 0.15 }),
    );
  }

  // Hips and belly.
  const hips = rbox(cx, 232, 38 * bw, 26, 16);
  cv.paint(hips, body(hips, k.pants, { seed: seed + 2, blood: 0.1 }));
  const belly = ellipse(cx, rootY + 50, 28 * bw, 20);
  cv.paint(
    belly,
    body(belly, mul(k.skin, 0.95), { seed: seed + 3, blood: 0.35 }),
  );

  // Torso (shirt, or a vest for the brute) with a ragged hem.
  const hemY = rootY + 42;
  const torsoBase = rbox(cx + k.lean * 0.4, rootY - 4, 44 * bw, 66, 26);
  const torso = (x, y) =>
    Math.max(torsoBase(x, y), y - (hemY + 12 * fbm(x / 7, 3, seed)));
  cv.paint(
    torso,
    body(torso, k.shirt, { seed: seed + 5, blood: 0.32, grime: 0.3 }),
  );

  // Rips in the shirt showing skin and wounds.
  const rips = [
    [cx - 18 * bw, rootY + 6, 11, 15],
    [cx + 22 * bw, rootY - 22, 9, 12],
  ];
  for (const [rx, ry, a, b] of rips) {
    const rip = intersect(ellipse(rx, ry, a, b), torso);
    cv.paint(rip, body(rip, k.skin, { seed: seed + 8, blood: 0.55 }), {
      outline: 1.5,
    });
  }

  if (kind === 'brute') {
    // Open vest: dark chest, studs and a belt.
    const belt = rbox(cx, rootY + 38, 44 * bw, 6, 3);
    cv.paint(
      intersect(belt, torso),
      body(belt, [40, 32, 26], { seed: seed + 12, blood: 0, grime: 0.3 }),
      { outline: 1.5 },
    );
    for (let i = -3; i <= 3; i++) {
      const stud = ellipse(cx + i * 15, rootY + 38, 2.6, 2.6);
      cv.paint(stud, flat([190, 190, 180]), { outline: 0 });
    }
    for (const side of [-1, 1]) {
      const plate = ellipse(cx + side * (44 * bw + 4), rootY - 56, 24, 16);
      cv.paint(
        plate,
        body(plate, [120, 124, 128], {
          seed: seed + 20 + side,
          blood: 0.1,
          grime: 0.35,
          bloodColor: [90, 40, 20],
        }),
      );
    }
  } else {
    // Collar.
    const collar = ellipse(cx + k.lean * 0.5, rootY - 62, 26 * bw, 11);
    cv.paint(
      collar,
      body(collar, mul(k.shirt, 0.8), { seed: seed + 6, blood: 0.2 }),
      { outline: 1.8 },
    );
  }

  // Head.
  const hs = k.hs;
  const head = ellipse(headX, headY, 38 * hs, 44 * hs);
  cv.paint(
    head,
    body(head, k.skin, { seed: seed + 10, blood: 0.22, grime: 0.3 }),
  );

  if (k.hair) {
    const hairLine = (x) => headY - 20 * hs + 9 * fbm(x / 6, 1, seed + 3);
    const hair = (x, y) => Math.max(head(x, y), y - hairLine(x));
    cv.paint(
      hair,
      body(hair, k.hair, { seed: seed + 11, blood: 0, grime: 0.5 }),
      { outline: 1.5 },
    );
  }

  // Sunken eyes with a glow.
  const eyeY = headY + 2 * hs;
  for (const side of [-1, 1]) {
    const ex = headX + side * 15 * hs;
    const socket = ellipse(ex, eyeY, 11 * hs, 9.5 * hs);
    cv.paint(
      socket,
      (x, y, d) => mix([46, 20, 28], [12, 6, 10], clamp(-d / 7)),
      { outline: 1.2 },
    );
    const glow = ellipse(ex + side * -1, eyeY + 1, 15 * hs, 13 * hs);
    cv.paint(glow, (x, y, d) => [...k.eye, 0.28 * clamp(-d / 10)], {
      outline: 0,
    });
    const eye = ellipse(ex, eyeY + 1, 5 * hs, 5.6 * hs);
    cv.paint(eye, (x, y, d) => mix(k.eye, [255, 255, 230], clamp(-d / 4)), {
      outline: 0,
    });
    // Heavy brow.
    const brow = capsule(
      ex - 11 * hs,
      eyeY - 12 * hs - side * 3,
      ex + 11 * hs,
      eyeY - 12 * hs + side * 3,
      2.6,
    );
    cv.paint(brow, flat(mul(k.skin, 0.45)), { outline: 0 });
  }

  // Nose slits.
  for (const side of [-1, 1]) {
    const nose = capsule(
      headX + side * 4,
      headY + 18 * hs,
      headX + side * 5,
      headY + 24 * hs,
      1.9,
    );
    cv.paint(nose, flat([30, 14, 18]), { outline: 0 });
  }

  // Mouth: dark gape with uneven teeth.
  const my = headY + 34 * hs;
  const mw = 19 * hs;
  const mh = 8 * hs * k.mouth;
  const mouth = ellipse(headX, my, mw, mh);
  cv.paint(mouth, (x, y, d) => mix([60, 8, 14], [18, 2, 6], clamp(-d / 6)), {
    outline: 1.6,
  });
  for (let i = -3; i <= 3; i++) {
    const tx = headX + i * 5.4 * hs;
    if (hash(i, 1, seed) < 0.18) continue;
    const th = 3.5 + 3.5 * hash(i, 2, seed);
    const top = intersect(
      rbox(tx, my - mh + th * 0.5, 2.5, th * 0.5 + 1, 1),
      mouth,
    );
    cv.paint(top, flat([226, 218, 176]), { outline: 0.5 });
    if (hash(i, 3, seed) > 0.35) {
      const bh = 3 + 3 * hash(i, 4, seed);
      const bot = intersect(
        rbox(tx + 1.5, my + mh - bh * 0.5, 2.3, bh * 0.5 + 1, 1),
        mouth,
      );
      cv.paint(bot, flat([214, 206, 164]), { outline: 0.5 });
    }
  }
  // Blood dripping from the mouth.
  const drip = capsule(
    headX + 8 * hs,
    my + mh * 0.6,
    headX + 9 * hs,
    my + mh + 18 + 6 * f,
    2.4,
    1.6,
  );
  cv.paint(drip, flat([128, 12, 18]), { outline: 0 });

  // Head wound.
  const wound = ellipse(headX + 22 * hs, headY - 14 * hs, 9 * hs, 7 * hs);
  cv.paint(wound, (x, y, d) => mix([150, 30, 36], [60, 6, 12], clamp(-d / 6)), {
    outline: 1.4,
  });

  // Arms reaching up and out, alternating with the walk cycle.
  for (const side of [-1, 1]) {
    const raise = side * f > 0 ? -12 : 6;
    const shoulderX = cx + side * (44 * bw + 2);
    const shoulderY = rootY - 52;
    const elbowX = cx + side * (44 * bw + 34);
    const elbowY = rootY - 6 + raise * 0.4;
    const handX = cx + side * (44 * bw + 20) + k.lean * 0.3;
    const handY = rootY - 96 + raise;
    const upper = capsule(
      shoulderX,
      shoulderY,
      elbowX,
      elbowY,
      14 * bw ** 0.6,
      12 * bw ** 0.6,
    );
    const fore = capsule(
      elbowX,
      elbowY,
      handX,
      handY,
      12 * bw ** 0.6,
      10 * bw ** 0.6,
    );
    cv.paint(
      upper,
      body(upper, k.shirt, { seed: seed + 40 + side, blood: 0.2, grime: 0.3 }),
    );
    cv.paint(
      fore,
      body(fore, k.skin, { seed: seed + 50 + side, blood: 0.3, grime: 0.3 }),
    );
    // Torn sleeve edge.
    const cuff = capsule(
      elbowX - side * 2,
      elbowY - 2,
      elbowX + side * 3,
      elbowY + 3,
      13 * bw ** 0.6,
    );
    cv.paint(
      intersect(cuff, upper),
      body(upper, mul(k.shirt, 0.7), { seed: seed + 41, blood: 0.1 }),
      { outline: 0 },
    );
    // Hand: palm and curled fingers.
    const palm = ellipse(handX, handY - 4, 13 * bw ** 0.5, 12 * bw ** 0.5);
    cv.paint(palm, body(palm, k.skin, { seed: seed + 60 + side, blood: 0.25 }));
    for (let i = 0; i < 4; i++) {
      const a = (-0.55 + i * 0.37) * side + side * 0.1;
      const fx = handX + Math.sin(a) * 20 * bw ** 0.4;
      const fy = handY - 4 - Math.cos(a) * 20 * bw ** 0.4;
      const finger = capsule(
        handX + Math.sin(a) * 7,
        handY - 4 - Math.cos(a) * 7,
        fx,
        fy,
        3.6 * bw ** 0.4,
        2.8 * bw ** 0.4,
      );
      cv.paint(
        finger,
        body(finger, k.skin, { seed: seed + 70 + i, blood: 0.2 }),
        { outline: 1.4 },
      );
      const nail = ellipse(fx, fy, 2.4, 2.4);
      cv.paint(nail, flat([58, 44, 30]), { outline: 0 });
    }
  }

  return cv.png();
}

for (const dir of OUT_DIRS) mkdirSync(join(ROOT, dir), { recursive: true });
for (const kind of Object.keys(KINDS)) {
  for (const frame of [0, 1]) {
    const png = drawZombie(kind, frame);
    for (const dir of OUT_DIRS)
      writeFileSync(join(ROOT, dir, `${kind}-${frame + 1}.png`), png);
    console.log(`${kind}-${frame + 1}.png ${png.length} bytes`);
  }
}
