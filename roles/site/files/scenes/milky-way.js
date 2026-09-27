window.DATA = {};
window.META = {"name": "milky way", "caption": "Our <a href=\"https://en.wikipedia.org/wiki/Milky_Way\" target=\"_blank\" rel=\"noopener\">galaxy</a> from outside, 100,000 light-years across. The spiral arms, bar and bulge follow published measurements (<a href=\"https://arxiv.org/abs/1910.03357\" target=\"_blank\" rel=\"noopener\">Reid et al. 2019</a>); the <a href=\"https://en.wikipedia.org/wiki/Magellanic_Clouds\" target=\"_blank\" rel=\"noopener\">Magellanic Clouds</a> and other satellite galaxies sit at their measured positions (<a href=\"https://arxiv.org/abs/1204.1562\" target=\"_blank\" rel=\"noopener\">McConnachie 2012</a>). The far side has never been observed and is extrapolated.", "notice": ""};
// The Milky Way from outside, 100,000 light-years across.
//
// The galactic model is the site's own: spiral arms from maser parallaxes (Reid et al.
// 2019), bar and bulge (Wegg & Gerhard 2015), disk (Bland-Hawthorn & Gerhard 2016),
// warp from Cepheids (Chen et al. 2019), and the satellite galaxies at their measured
// positions with points in proportion to luminosity (McConnachie 2012). The far side
// is extrapolated. The disks turn as disks -- the Milky Way about its pole, the LMC
// about its own axis -- the SMC and the dwarfs stay put. Now and then one star of the
// disk breathes, at the pace of a sleeping person's breath.
window.SCENE = (() => {
  let lmcC, lmcN;
  const MW_PERIOD = 480;                                // seconds per turn
  const BREATH = 4.3;                                   // seconds per breath
  let pulse = null, nextPulse = 6 + Math.random() * 6, deck = [], dealt = 0;
  const f3 = (v) => `vec3(${v.map((q) => q.toFixed(5)).join(", ")})`;
  const none = { uPulseIdx: -1, uPulse: 0 };
  return {
    view: { radius: 14.5, disk: true, el: 24, az: 118, roll: "diag", fov: 22, offset: [-0.12, 0.10], portraitYaw: 7 },
    ppkRef: 52, haze: 9, hazeFrac: 0.05, hazeSize: 0.9, hazeUnit: 1, hazeFlux: 1,
    timeScale: 1, spin: 0,
    bg: 45000, bgExposure: 1.4,
    get glsl() { return `
uniform float uPulseIdx, uPulse;
const float MW_OMEGA = ${(-2 * Math.PI / MW_PERIOD).toFixed(6)}, LMC_OMEGA = ${(0.8 * 2 * Math.PI / MW_PERIOD).toFixed(6)};
const vec3 LMC_C = ${f3(lmcC)}, LMC_N = ${f3(lmcN)};
vec3 rotz(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
vec3 rotAxis(vec3 v, vec3 n, float a) { return v * cos(a) + cross(n, v) * sin(a) + n * dot(n, v) * (1.0 - cos(a)); }
vec3 place(vec3 p, vec4 e, inout vec3 col, inout float flux) {
  float k = e.w;                                     // 0 Milky Way, 1 LMC, 2 at rest, 3 dust, 4 a breathing star
  if (k > 0.5 && k < 1.5) return LMC_C + rotAxis(p - LMC_C, LMC_N, LMC_OMEGA * uTime);
  if (k > 1.5 && k < 2.5) return p;
  vec3 w = rotz(p, MW_OMEGA * uTime);
  if (k > 2.5 && k < 3.5) flux *= smoothstep(-1.5, 2.0, dot(w, normalize(uCam)));   // only dust on the near side can hide anything
  if (k > 3.5) flux *= abs(e.x - uPulseIdx) < 0.5 ? uPulse : 0.0;
  return w;
}`; },
    build(ctx) {
      const { rnd, gauss, DEG, lite } = ctx;
      const N = lite ? 90000 : 200000;                 // Milky Way points; satellites add in proportion to luminosity
      this.exposure = 200000 / N;                      // fewer points on phones, same total light
      this.frontExposure = this.exposure;
      // ---------------------------------------------------------------- galactic model
      // Galactocentric frame, kpc: x from the Sun toward the centre, y toward l = 90° (direction of rotation), z toward the NGP.
      const R0 = 8.15;                        // Sun–centre distance (Reid et al. 2019)
      const SUN = [-R0, 0, 0.02];

      // Reid et al. 2019, Table 2: ln(R/Rk) = -(β - βk) tan ψ ; β = Galactocentric azimuth, 0 toward the Sun, increasing with l.
      // [name, βk, Rk, ψ<, ψ>, βmin, βmax (measured range), weight for old stars, weight for young stars]
      const ARMS = [
        ["Norma–Outer",      18, 4.46, -1.0, 19.5,  -15,  71, 0.35, 1.0],
        ["Scutum–Centaurus", 23, 4.91, 14.1, 12.1,    0, 104, 1.00, 1.0],
        ["Sagittarius–Car.", 24, 6.04, 17.1,  1.0,   -2,  97, 0.35, 1.0],
        ["Local",             9, 8.26, 11.4, 11.4,   -8,  34, 0.10, 0.45],
        ["Perseus",          40, 8.87, 10.3,  8.7,  -23, 115, 1.00, 1.0],
        ["Outer",            18, 12.24, 3.0,  9.4,  -16,  71, 0.30, 0.7],
      ];
      const PSI_EXT = 12 * DEG; // pitch used to continue an arm past its measured range (the far side is unobserved)

      function armR(a, bDeg) {
        const [, bk, Rk, pLo, pHi, bMin, bMax] = a;
        const f = (b) => Rk * Math.exp(-(b - bk) * DEG * Math.tan((b < bk ? pLo : pHi) * DEG));
        if (bDeg < bMin) return f(bMin) * Math.exp(-(bDeg - bMin) * DEG * Math.tan(PSI_EXT));
        if (bDeg > bMax) return f(bMax) * Math.exp(-(bDeg - bMax) * DEG * Math.tan(PSI_EXT));
        return f(bDeg);
      }
      function extentOf(a) {           // how far to extrapolate: short spur for Local, most of a turn for the rest
        return a[0] === "Local" ? [-40, 70] : [a[5] - 150, a[6] + 170];
      }

      // Warp (Chen et al. 2019): onset near 9 kpc, line of nodes ≈ 17.5° from the Sun direction, rising toward l ≈ 90°.
      function warpZ(x, y, R) {
        if (R < 9) return 0;
        const phi = Math.atan2(y, -x) - 17.5 * DEG;
        return 0.028 * (R - 9) * (R - 9) * Math.sin(phi);
      }
      function flare(R) { return 1 + Math.max(0, R - 9) * 0.12; }

      // Colours (linear-ish RGB)
      const C_BULGE = [1.00, 0.80, 0.58];
      const C_OLD   = [1.00, 0.88, 0.74];
      const C_DISK  = [0.86, 0.88, 0.96];
      const C_YOUNG = [0.58, 0.72, 1.00];
      const C_HII   = [1.00, 0.52, 0.66];
      const C_HALO  = [1.00, 0.86, 0.70];

      const pos = [], col = [];
      function push(x, y, z, c, flux) {
        pos.push(x, y, z);
        col.push(c[0], c[1], c[2], flux);
      }
      // Most tracers are faint; a few are bright (a steep luminosity function). Faint, invisible ones are simply not generated.
      function lum(bright) { const u = rnd(); return 0.35 + bright * Math.pow(u, 9); }
      function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

      function armPoint(a, sigma, h) {
        // pick β along the extended arm, weighted by exponential disk surface density × arc length
        const [b0, b1] = extentOf(a);
        for (let tries = 0; tries < 50; tries++) {
          const b = b0 + rnd() * (b1 - b0);
          const R = armR(a, b);
          if (R < 3.0 || R > 17.5) continue;
          const w = Math.exp(-(R - 3) / 3.2) * (R / 6);
          if (rnd() > w) continue;
          const s = sigma * (0.7 + R / 12);
          const Rr = R + gauss() * s;
          const bb = b * DEG + gauss() * s / R * 0.6;
          const x = -Rr * Math.cos(bb), y = Rr * Math.sin(bb);
          const z = gauss() * h * flare(Rr) + warpZ(x, y, Rr);
          return [x, y, z, Rr];
        }
        return null;
      }
      function pickArm(k) {
        let tot = 0; for (const a of ARMS) tot += a[k];
        let u = rnd() * tot;
        for (const a of ARMS) { u -= a[k]; if (u <= 0) return a; }
        return ARMS[0];
      }

      const barAngle = 27 * DEG;                                   // Wegg & Gerhard 2015
      const bax = -Math.cos(barAngle), bay = Math.sin(barAngle);   // near end toward the Sun, at positive l
      function barFrame(u, v, w) { return [u * bax - v * bay, u * bay + v * bax, w]; }

      function build() {
        const n = (f) => Math.round(N * f);

        // thin disk, smooth: Rd = 2.6 kpc, hz = 0.3 kpc, inner hole where the bar dominates
        for (let i = 0, m = n(0.26); i < m;) {
          const R = -2.6 * Math.log(rnd() * rnd());
          if (R > 17.5 || rnd() > smooth(1.8, 4.2, R)) continue;
          const t = rnd() * 2 * Math.PI, x = R * Math.cos(t), y = R * Math.sin(t);
          const z = gauss() * 0.30 * flare(R) * 0.6 + warpZ(x, y, R);
          push(x, y, z, mix(C_OLD, C_DISK, Math.min(1, R / 12)), lum(2.0));
          i++;
        }
        // thick disk: Rd = 2.0, hz = 0.9
        for (let i = 0, m = n(0.06); i < m;) {
          const R = -2.0 * Math.log(rnd() * rnd());
          if (R > 15) continue;
          const t = rnd() * 2 * Math.PI, x = R * Math.cos(t), y = R * Math.sin(t);
          push(x, y, gauss() * 0.9 * 0.6 + warpZ(x, y, R), C_OLD, lum(1.0));
          i++;
        }
        // old stars in the arms: concentrated in the two major stellar arms (Scutum–Centaurus, Perseus; Churchwell et al. 2009)
        for (let i = 0, m = n(0.17); i < m;) {
          const p = armPoint(pickArm(7), 0.55, 0.22); if (!p) continue;
          push(p[0], p[1], p[2], mix(C_OLD, C_DISK, Math.min(1, p[3] / 11)), lum(2.5)); i++;
        }
        // young, bright blue stars trace all four gas arms
        for (let i = 0, m = n(0.17); i < m;) {
          const p = armPoint(pickArm(8), 0.22, 0.07); if (!p) continue;
          push(p[0], p[1], p[2], C_YOUNG, lum(5.0)); i++;
        }
        // HII regions: sparse pink knots on the arms
        for (let i = 0, m = n(0.008); i < m;) {
          const p = armPoint(pickArm(8), 0.12, 0.05); if (!p) continue;
          const k = 3 + Math.floor(rnd() * 5);
          for (let j = 0; j < k; j++) push(p[0] + gauss() * 0.06, p[1] + gauss() * 0.06, p[2] + gauss() * 0.03, C_HII, lum(3.0));
          i++;
        }
        // long bar: half-length ~5 kpc, thin
        for (let i = 0, m = n(0.07); i < m;) {
          const u = (rnd() * 2 - 1) * 5.0, v = gauss() * 0.55, w = gauss() * 0.18;
          if (rnd() > 1 - Math.pow(Math.abs(u) / 5.0, 3)) continue;
          const q = barFrame(u, v, w); push(q[0], q[1], q[2], C_BULGE, lum(1.5)); i++;
        }
        // boxy/peanut bulge: triaxial, exponential in a boxy radius (Wegg & Gerhard 2013 scale lengths)
        for (let i = 0, m = n(0.19); i < m;) {
          const u = laplace(0.75), v = laplace(0.32), w = laplace(0.26);
          const rb = Math.pow(Math.pow(Math.abs(u) / 0.75, 4) + Math.pow(Math.abs(v) / 0.32, 4), 0.25);
          if (rb > 6) continue;
          const q = barFrame(u, v, w); push(q[0], q[1], q[2], C_BULGE, lum(1.2)); i++;
        }
        // nuclear stellar disk / cluster
        for (let i = 0, m = n(0.02); i < m; i++) push(gauss() * 0.15, gauss() * 0.15, gauss() * 0.05, [1, 0.9, 0.78], lum(1.0));
        // stellar halo: ρ ∝ r^-3.5, flattened q = 0.7
        for (let i = 0, m = n(0.04); i < m; i++) {
          const a = Math.pow(2, -0.5), b = Math.pow(80, -0.5);
          const r = Math.pow(a - rnd() * (a - b), -2);
          const ct = rnd() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * 2 * Math.PI;
          push(r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct * 0.7, C_HALO, lum(2.0));
        }

        // satellites at measured positions (l, b in degrees, heliocentric d in kpc, M_V), McConnachie 2012.
        // Points ∝ luminosity relative to the Milky Way (M_V ≈ -20.8); anything too faint to show is left out.
        const MW_MV = -20.8, Npts = pos.length / 3;
        const SAT = [
          // name,        l,       b,      d,   M_V,   shape, size (kpc)
          ["LMC",      280.47, -32.89,  50.0, -18.1, "disk",  1.4],
          ["SMC",      302.80, -44.30,  64.0, -16.8, "irr",   0.6],
          ["Sgr",        5.57, -14.17,  26.7, -13.5, "elong", 1.6],
          ["Fornax",   237.10, -65.65, 147.0, -13.4, "sph",   0.7],
          ["Leo I",    225.99,  49.11, 254.0, -12.0, "sph",   0.25],
          ["Sculptor", 287.53, -83.16,  86.0, -11.1, "sph",   0.28],
          ["Leo II",   220.17,  67.23, 233.0,  -9.8, "sph",   0.18],
          ["Sextans",  243.50,  42.27,  86.0,  -9.3, "sph",   0.7],
          ["Carina",   260.11, -22.22, 105.0,  -9.1, "sph",   0.25],
          ["Draco",     86.37,  34.72,  76.0,  -8.8, "sph",   0.22],
          ["Ursa Minor",104.97, 44.80,  76.0,  -8.8, "sph",   0.18],
        ];
        const sats = {}, spin = { mw: Npts, lmc: null };
        for (const [name, l, b, d, mv, shape, size] of SAT) {
          const cx = d * Math.cos(b * DEG) * Math.cos(l * DEG) - R0;
          const cy = d * Math.cos(b * DEG) * Math.sin(l * DEG);
          const cz = d * Math.sin(b * DEG) + SUN[2];
          sats[name] = [cx, cy, cz];
          const k = Math.round(Npts * Math.pow(10, -0.4 * (mv - MW_MV)));
          if (k < 6) continue;
          const c = shape === "disk" || shape === "irr" ? [0.78, 0.84, 1.0] : C_HALO;
          const first = pos.length / 3;
          // we see the LMC nearly face-on (i ≈ 30°): disk normal close to the Sun–LMC line of sight
          const n = norm([cx - SUN[0] + 0.3 * d, cy - SUN[1], cz - SUN[2]]);
          for (let i = 0; i < k; i++) {
            let x, y, z;
            if (shape === "disk") {          // LMC: exponential disk inclined ~30°, with its off-centre bar
              const R = -size * Math.log(rnd() * rnd()), t = rnd() * 2 * Math.PI;
              x = R * Math.cos(t); y = R * Math.sin(t) * 0.9; z = gauss() * 0.25;
              if (rnd() < 0.22) { x = gauss() * 1.1; y = gauss() * 0.3 + 0.2; z = gauss() * 0.2; }
              const e1 = norm(cross(n, [0, 0, 1])), e2 = cross(n, e1);
              [x, y, z] = [x * e1[0] + y * e2[0] + z * n[0], x * e1[1] + y * e2[1] + z * n[1], x * e1[2] + y * e2[2] + z * n[2]];
            } else if (shape === "irr") {    // SMC: elongated along the line of sight
              x = gauss() * size; y = gauss() * size * 0.6; z = gauss() * size * 0.5;
              const t = Math.atan2(cy, cx); const x2 = x * Math.cos(t) - y * Math.sin(t); y = x * Math.sin(t) + y * Math.cos(t); x = x2 * 1.15;
            } else if (shape === "elong") {  // Sgr: tidally stretched along its orbit, roughly perpendicular to the disk
              x = gauss() * size * 0.35; y = gauss() * size * 0.3; z = gauss() * size;
            } else {                         // dwarf spheroidal: Plummer sphere
              const r = size / Math.sqrt(Math.pow(rnd(), -2 / 3) - 1);
              if (r > size * 6) { i--; continue; }
              const ct = rnd() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * 2 * Math.PI;
              x = r * st * Math.cos(ph); y = r * st * Math.sin(ph); z = r * ct;
            }
            push(cx + x, cy + y, cz + z, c, lum(shape === "sph" ? 1.0 : 3.0));
          }
          // The LMC is the first satellite, so its points directly follow the Milky Way's.
          if (shape === "disk") spin.lmc = { first, count: pos.length / 3 - first, c: [cx, cy, cz], n };
        }
        return spin;
      }
      function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
      function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
      function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
      function laplace(s) { const u = rnd() - 0.5; return -s * Math.sign(u) * Math.log(1 - 2 * Math.abs(u)); }

      // Dust: thin layer on the inner edges of the arms, reddening what lies behind it.
      function buildDust() {
        const d = [];
        const m = Math.round(N * 0.12);
        for (let i = 0; i < m;) {
          const a = pickArm(8);
          const p = armPoint(a, 0.16, 0.05); if (!p) continue;
          if (p[3] > 12.5) continue;
          const R = p[3], f = 0.93;                     // lanes sit slightly inside the stellar arm
          d.push(p[0] * f, p[1] * f, p[2], 1);
          i++;
        }
        for (let i = 0, m2 = Math.round(N * 0.03); i < m2;) {   // diffuse inner dust ring
          const R = 2.5 + rnd() * 4, t = rnd() * 2 * Math.PI;
          d.push(R * Math.cos(t), R * Math.sin(t), gauss() * 0.04, 0.6);
          i++;
        }
        return d;
      }

      const sp = build(), dust = buildDust();
      lmcC = sp.lmc.c; lmcN = sp.lmc.n;
      const n = pos.length / 3, data = new Float32Array(n * 11);
      for (let q = 0; q < n; q++) {
        const kind = q < sp.mw ? 0 : q < sp.mw + sp.lmc.count ? 1 : 2;
        data.set([pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2], col[q * 4], col[q * 4 + 1], col[q * 4 + 2], col[q * 4 + 3], 0, 0, 0, kind], q * 11);
      }
      const dd = new Float32Array(dust.length / 4 * 11);
      for (let q = 0; q < dust.length / 4; q++)   // dust absorbs blue more than red
        dd.set([dust[q * 4], dust[q * 4 + 1], dust[q * 4 + 2], 0.62, 0.78, 0.95, dust[q * 4 + 3] * 0.28, 0, 0, 0, 3], q * 11);
      // candidates for the breathing star: disk stars out where one can stand out, picked
      // afresh on every load -- the galaxy itself is seeded, this is not
      const cand = [], taken = new Set();
      for (let tries = 0; cand.length < 4000 * 11 && tries < 200000; tries++) {
        const q = Math.floor(Math.random() * sp.mw), x = pos[q * 3], y = pos[q * 3 + 1], z = pos[q * 3 + 2];
        if (taken.has(q) || Math.hypot(x, y) < 4 || Math.hypot(x, y) > 13 || Math.abs(z) > 0.6) continue;
        taken.add(q);
        cand.push(x, y, z, col[q * 4], col[q * 4 + 1], col[q * 4 + 2], 90, cand.length / 11, 0, 0, 4);
      }
      // dealt from a shuffled deck, so no star breathes twice until every other one has
      deck = Array.from({ length: cand.length / 11 }, (_, q) => q);
      for (let q = deck.length - 1; q > 0; q--) { const r = Math.floor(Math.random() * (q + 1)); [deck[q], deck[r]] = [deck[r], deck[q]]; }
      pos.length = 0; col.length = 0;
      return { data, dust: dd, dustSize: 0.11, front: new Float32Array(cand) };
    },
    tick(t) {                                          // once or twice, a slow swell and fade
      if (t < 3.2) return none;
      if (!pulse && t >= nextPulse) pulse = { star: deck[dealt++ % deck.length], start: t, breaths: 1 + Math.floor(Math.random() * 2) };
      if (!pulse) return none;
      const u = (t - pulse.start) / BREATH;
      if (u >= pulse.breaths) { pulse = null; nextPulse = t + 8 + Math.random() * 12; return none; }
      const s = Math.sin(Math.PI * u);
      return { uPulseIdx: pulse.star, uPulse: s * s };
    },
  };
})();
