window.DATA = {};
window.META = {"name": "deep space nine", "caption": "The Bajoran station from <a href=\"https://en.wikipedia.org/wiki/Star_Trek:_Deep_Space_Nine\" target=\"_blank\" rel=\"noopener\">Star Trek: Deep Space Nine</a>.", "notice": "Star Trek and Deep Space Nine are trademarks and copyrighted designs of CBS Studios Inc. and Paramount. Not affiliated with or endorsed by them."};
window.PART = "station";
// Deep Space Nine and the Enterprise-D: point-cloud fan renderings. One file
// builds both; window.PART picks the page -- "station" (Deep Space Nine alone,
// turning slowly) or "ship" (the Enterprise alone, on a slow turntable).
//
// Units: the docking ring's radius is 1 (the station is about 1.45 km across),
// so the 642 m Enterprise is ~0.89 long. Every hull point carries its surface
// normal: it is lit by the Sun, hidden when it faces away, and backed by a black
// core just under the skin so the far side and whatever is behind stay hidden.
// Window lights and running lights glow on their own.
const PART = window.PART || "station";
window.SCENE = {
  view: PART === "ship"
    ? { radius: 0.5, el: 18, az: 215, roll: 8, fov: 26, offset: [0, 0], portraitYaw: 7 }
    : { radius: 1.2, el: 13, az: 235, roll: 6, fov: 26, offset: [-0.02, 0.02], portraitYaw: 7 },
  center: PART === "ship" ? () => [-0.1, 0, -0.05] : undefined,
  exposure: 3.8, haze: 1.5, hazeFrac: 0.04, hazeSize: 1.0, hazeUnit: 0.06,
  timeScale: 1, spin: 0,
  bg: 50000, bgExposure: 1.6,
  glsl: `
const vec3 SUN = vec3(-0.45, 0.55, 0.70);
const float DS9_T = 400.0, ENT_T = 180.0;
vec3 rotz(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
vec3 rotx(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
vec3 place(vec3 p, vec4 e, inout vec3 col, inout float flux) {
  bool light = e.w > 9.5;
  float body = light ? e.w - 10.0 : e.w;
  vec3 n = e.xyz, w;
  if (body < 0.5) {                                  // the station turns very slowly
    float a = 6.2831853 / DS9_T * uTime;
    w = rotz(p, a); n = rotz(n, a);
  } else {                                           // the Enterprise on a slow turntable about its middle
    vec3 m = vec3(-0.1, 0.0, -0.05);
    float a = 6.2831853 / ENT_T * uTime;
    w = rotz(p - m, a) + m; n = rotz(n, a);
  }
  if (dot(n, normalize(uCam - w)) <= 0.0) { flux = 0.0; return w; }
  if (!light) flux *= 0.2 + max(0.0, dot(n, normalize(SUN)));
  return w;
}`,
  build(ctx) {
    const { rnd, lite } = ctx;
    const k = (lite ? 0.55 : 1) * (PART === "ship" ? 3 : 1);   // the ship alone fills the screen: more points
    const out = [], solid = [];
    const TAU = Math.PI * 2;
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const surf = (p, n, c, f, body, inset) => {
      n = nrm(n);
      out.push(p[0], p[1], p[2], c[0], c[1], c[2], f, n[0], n[1], n[2], body);
      // the black backing hides what is behind a hull, but its dots are wider than a thin
      // part: blades, tips and pods go without it rather than show black blotches
      if (inset > 0) solid.push(p[0] - n[0] * inset, p[1] - n[1] * inset, p[2] - n[2] * inset, 0, 0, 0, 0, n[0], n[1], n[2], body);
    };
    const light = (p, n, c, f, body) => { n = nrm(n); out.push(p[0], p[1], p[2], c[0], c[1], c[2], f, n[0], n[1], n[2], body + 10); };

    if (PART === "station") {
    // ---------------------------------------------------------------- Deep Space Nine
    // Proportions from the station's plan and elevation, docking ring radius ~1:
    // a small habitat ring round the core, three crossover bridges flaring into
    // webs at the docking ring, a docking pylon rising and one falling from each
    // web and curling back over the station, and a low core -- Ops over the
    // Promenade on top, the fusion reactor's housing and red glow below.
    const HULL = [0.68, 0.66, 0.78], RUST = [0.6, 0.34, 0.34], WARM = [1.0, 0.78, 0.48], AMBER = [1.0, 0.6, 0.3];
    const S = (p, n, f = 1.0, c = HULL, thin = false) => surf(p, n, c, f, 0, thin ? 0 : 0.01);
    // a ring; with segs > 0 it is built of that many sections, a narrow dark joint
    // between each and a bulkier collar sitting over every joint
    const torus = (R, rr, rz, z0, n, lights, segs = 0, pointed = false) => {
      const SEG = TAU / Math.max(segs, 1), GAP = 0.1, COLLAR = 0.22;   // as fractions of a section
      for (let i = 0; i < n * k;) {
        const u = rnd() * TAU, v = rnd() * TAU;
        if (rnd() > (R + rr * Math.cos(v)) / (R + rr)) continue;
        if (segs) {
          const f = ((u / SEG) % 1 + 1) % 1, d = Math.min(f, 1 - f);    // distance to the nearest joint
          if (d < GAP / 2) continue;                                   // the joint itself stays dark
          if (d < COLLAR / 2) {                                        // the collar: a larger, squarer cross-section
            const cr = rr * 1.45, cz = rz * 1.5, sq = Math.sign(Math.cos(v)) * Math.pow(Math.abs(Math.cos(v)), 0.5), sz = Math.sign(Math.sin(v)) * Math.pow(Math.abs(Math.sin(v)), 0.5);
            S([(R + cr * sq) * Math.cos(u), (R + cr * sq) * Math.sin(u), z0 + cz * sz], [sq * Math.cos(u) / cr, sq * Math.sin(u) / cr, sz / cz]);
            i++; continue;
          }
        }
        // pointed rings run out into a thin blade on their outer side; round ones stay round
        const cv = Math.cos(v), out = pointed && cv > 0;
        const ro = rr * cv * (out ? 1.8 : 1), zo = rz * Math.sin(v) * (out ? 1 - 0.8 * cv : 1);
        const p = [(R + ro) * Math.cos(u), (R + ro) * Math.sin(u), z0 + zo];
        S(p, [cv * Math.cos(u) / rr, cv * Math.sin(u) / rr, Math.sin(v) / rz * (out ? 2.5 : 1)]);
        i++;
      }
      for (const v of lights) for (let i = 0; i < 480 * k; i++) {       // rows of windows around the ring
        const u = rnd() * TAU;
        light([(R + rr * Math.cos(v)) * Math.cos(u), (R + rr * Math.cos(v)) * Math.sin(u), z0 + rz * Math.sin(v)],
              [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)], rnd() < 0.8 ? WARM : AMBER, 1.2 + rnd(), 0);
      }
    };
    torus(0.93, 0.04, 0.03, 0, 28000, [0.3, -0.3], 12, true);   // docking ring, in 12 sections, a blade-edged outer rim
    torus(0.36, 0.045, 0.035, 0.02, 9000, [0.5, -0.5]);      // habitat ring

    // core as a surface of revolution: [z, r] from the Ops module on top down past the reactor
    // measured off the starboard elevation: Ops -- a stepped tower under the sub-space
    // array -- on a Promenade drum, which sits on a broad low cone over the habitat ring;
    // under the ring a narrow column of struts, the reactor housing's saucer, and a cone
    // tapering to the main fusion reactor's point
    const CORE = [[0.28, 0], [0.28, 0.006], [0.235, 0.008], [0.235, 0.03], [0.22, 0.045], [0.2, 0.062], [0.18, 0.075], [0.165, 0.1],
      [0.15, 0.13], [0.14, 0.17], [0.1, 0.2], [0.085, 0.22], [0.06, 0.28], [0.035, 0.34], [0.0, 0.36],
      [-0.04, 0.33], [-0.045, 0.3], [-0.045, 0.1], [-0.12, 0.09], [-0.125, 0.125], [-0.15, 0.13], [-0.17, 0.1], [-0.2, 0.06],
      [-0.23, 0.02], [-0.25, 0.008], [-0.27, 0]];
    const segW = CORE.slice(1).map(([z1, r1], i) => { const [z0, r0] = CORE[i]; return Math.hypot(z1 - z0, r1 - r0) * ((r0 + r1) / 2 + 0.02); });
    const segT = segW.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 22000 * k; i++) {
      let u = rnd() * segT, s = 0;
      while (u > segW[s]) { u -= segW[s]; s++; }
      const [z0, r0] = CORE[s], [z1, r1] = CORE[s + 1], t = rnd();
      const z = z0 + (z1 - z0) * t, r = r0 + (r1 - r0) * t, a = rnd() * TAU;
      const nr = -(z1 - z0), nz = r1 - r0;             // outward normal of the profile, going down it
      S([r * Math.cos(a), r * Math.sin(a), z], [nr * Math.cos(a), nr * Math.sin(a), nz]);
    }
    for (let i = 0; i < 700 * k; i++) {                   // the Promenade's windows, round the drum
      const z = rnd() < 0.5 ? 0.11 : 0.125, r = 0.205 - (z - 0.1) * 0.9, a = rnd() * TAU;
      light([r * Math.cos(a), r * Math.sin(a), z], [Math.cos(a), Math.sin(a), 0.2], WARM, 1.3, 0);
    }
    for (let i = 0; i < 300 * k; i++) {                   // lights round the reactor housing's saucer
      const a = rnd() * TAU;
      light([0.131 * Math.cos(a), 0.131 * Math.sin(a), -0.14], [Math.cos(a), Math.sin(a), 0], AMBER, 1.3, 0);
    }
    for (let i = 0; i < 400 * k; i++) { const a = rnd() * TAU; light([0.242 * Math.cos(a), 0.242 * Math.sin(a), 0.0], [Math.cos(a), Math.sin(a), 0], AMBER, 1.4, 0); }   // rim of the platform
    for (let i = 0; i < 300 * k; i++) {                   // fusion reactor glow
      const a = rnd() * TAU, z = -0.2 - rnd() * 0.05, r = 0.045 + 0.01 * rnd();
      light([r * Math.cos(a), r * Math.sin(a), z], [Math.cos(a), Math.sin(a), 0], [1.0, 0.15, 0.1], 2.4, 0);
    }
    for (let i = 0; i < 160 * k; i++) { const a = rnd() * TAU; light([0.078 * Math.cos(a), 0.078 * Math.sin(a), 0.18], [Math.cos(a), Math.sin(a), 0.4], [1.0, 0.9, 0.75], 1.6, 0); }   // Ops windows

    // the defensive sails, as on the blueprint: three rising from the broad cone over the
    // habitat ring and three hanging under it, between the crossover bridges -- each a thin
    // blade like a shark's fin, broad at the root, leaning outward to a narrow tip that
    // carries the tractor beam emitter
    const coneZ = (r) => {                               // height of the core's upper surface at radius r
      for (let q = 0; q < CORE.length - 1; q++) {
        const [z0, r0] = CORE[q], [z1, r1] = CORE[q + 1];
        if (z0 >= 0 && z1 >= 0 && (r - r0) * (r - r1) <= 0 && r0 !== r1) return z0 + (z1 - z0) * (r - r0) / (r1 - r0);
      }
      return 0.05;
    };
    for (const d of [90, 210, 330]) for (const sz of [1, -1]) {
      const a = d * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const base = sz > 0 ? coneZ(0.185) - 0.01 : -0.04, H = sz > 0 ? 0.13 : 0.09;
      const at = (r, z, side, n) => S([r * ca - side * sa, r * sa + side * ca, z], [n[0] * ca - n[2] * sa, n[0] * sa + n[2] * ca, n[1]], 1.0, HULL, true);
      for (let i = 0; i < 1300 * k; i++) {
        const t = Math.pow(rnd(), 0.8), w = 0.055 * Math.pow(1 - t, 0.8) + 0.004;
        const rin = 0.155 + 0.06 * t * t, u = rnd(), r = rin + u * w, z = base + sz * H * t;
        const face = rnd();
        if (face < 0.8) { const sd = rnd() < 0.5 ? -1 : 1; at(r, z, sd * 0.006, [0, 0, sd]); }                     // the two flat faces
        else if (face < 0.9) at(rin, z, (rnd() - 0.5) * 0.012, [-1, 0.3 * sz, 0]);                                // leading edge, inboard
        else at(rin + w, z, (rnd() - 0.5) * 0.012, [1, 0.5 * sz, 0]);                                           // trailing edge
      }
      const tipR = 0.155 + 0.06 + 0.002;
      for (let i = 0; i < 3; i++) light([tipR * ca, tipR * sa, base + sz * (H + 0.004)], [ca, sa, sz], [1.0, 0.55, 0.3], 2.5, 0);
    }

    // spokes from the core out to the habitat ring
    const box = (a, r0, r1, wy, hz, n) => {
      const L = r1 - r0, faces = [[L * wy, 0], [L * wy, 1], [L * hz, 2], [L * hz, 3]], tot = faces.reduce((s, f) => s + f[0], 0);
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < n * k; i++) {
        let u = rnd() * tot, f = 0; while (u > faces[f][0]) { u -= faces[f][0]; f++; }
        const r = r0 + rnd() * L; let y, z, nl;
        if (f < 2) { y = (rnd() - 0.5) * wy; z = f ? hz / 2 : -hz / 2; nl = [0, 0, f ? 1 : -1]; }
        else { z = (rnd() - 0.5) * hz; y = f === 2 ? wy / 2 : -wy / 2; nl = [0, f === 2 ? 1 : -1, 0]; }
        S([r * ca - y * sa, r * sa + y * ca, z + 0.02], [nl[0] * ca - nl[1] * sa, nl[0] * sa + nl[1] * ca, nl[2]]);
      }
    };
    for (let j = 0; j < 6; j++) box(TAU * (j + 0.5) / 6, 0.2, 0.33, 0.022, 0.018, 320);

    // the three crossover bridges, narrow at the habitat ring, flaring into a web at the docking ring
    const ARMS = [30, 150, 270].map((d) => d * Math.PI / 180);
    const halfW = (r) => 0.03 + 0.09 * Math.pow((r - 0.4) / 0.54, 3);
    for (const a of ARMS) {
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < 2600 * k;) {
        const r = 0.4 + rnd() * 0.54, w = halfW(r);
        if (rnd() > w / 0.12) continue;
        const y = (rnd() * 2 - 1) * w, top = rnd() < 0.5;
        S([r * ca - y * sa, r * sa + y * ca, top ? 0.018 : -0.018], [0, 0, top ? 1 : -1]);
        i++;
      }
      for (let i = 0; i < 900 * k; i++) {                 // the web's two edges
        const r = 0.4 + rnd() * 0.54, w = halfW(r), sgn = rnd() < 0.5 ? -1 : 1;
        S([r * ca - sgn * w * sa, r * sa + sgn * w * ca, (rnd() - 0.5) * 0.036], [-sgn * sa, sgn * ca, 0]);
      }
    }

    // docking pylons, measured off the blueprint's elevation: at each arm one rises and one
    // falls from a broad wedge on the ring, never bulging outside it, sweeping up and inward
    // like a quarter-ellipse to a thin, nearly horizontal tip above the core; the inner face
    // rust red
    const bez = (P, t) => P[0].map((_, d) => (1 - t) ** 3 * P[0][d] + 3 * (1 - t) ** 2 * t * P[1][d] + 3 * (1 - t) * t * t * P[2][d] + t ** 3 * P[3][d]);
    for (const a of ARMS) for (const sz of [1, -1]) {
      const P = [[0.9, 0], [0.9, 0.42 * sz], [0.7, 0.7 * sz], [0.28, 0.72 * sz]];   // (radius, z): vertical at the ring, level at the tip
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < 6500 * k; i++) {
        const t = rnd(), c = bez(P, t), c2 = bez(P, Math.min(1, t + 0.01)), c1 = bez(P, Math.max(0, t - 0.01));
        const tr = [c2[0] - c1[0], c2[1] - c1[1]], tl = Math.hypot(...tr);
        const nr = [tr[1] / tl * sz, -tr[0] / tl * sz];                          // in-plane normal, pointing outward
        const point = 0.45 + 0.55 * Math.min(1, (1 - t) / 0.3);   // narrows toward the tip, where the port takes over
        const hw = (0.01 + 0.03 * Math.pow(1 - t, 1.5)) * point, ht = (0.012 + 0.03 * (1 - t)) * point + 0.09 * Math.pow(1 - t, 6), ph = rnd() * TAU;   // the root flares into a wedge
        const inw = 0.06 * Math.pow(1 - t, 6);            // the wedge grows inward, the outer edge stays a clean curve
        const r = c[0] + nr[0] * (Math.cos(ph) * ht - inw), z = c[1] + nr[1] * (Math.cos(ph) * ht - inw), side = Math.sin(ph) * hw;
        const nn = [nr[0] * Math.cos(ph) / ht, nr[1] * Math.cos(ph) / ht, Math.sin(ph) / hw];   // (radial, z, tangential)
        S([r * ca - side * sa, r * sa + side * ca, z], [nn[0] * ca - nn[2] * sa, nn[0] * sa + nn[2] * ca, nn[1]], 1.0, Math.cos(ph) < -0.3 ? RUST : HULL, ht < 0.03);
      }
      // the tip, as the blueprint draws it: the pylon ends in a slim docking port -- an airlock
      // nozzle carrying on along the curve to a point -- with the control gondola, a
      // teardrop pod, slung under the pylon just behind it on the side facing the ring
      const tip = bez(P, 1), pre = bez(P, 0.97);
      const tr = [tip[0] - pre[0], tip[1] - pre[1]], tl = Math.hypot(...tr), td = [tr[0] / tl, tr[1] / tl];
      const inner = [-td[1] * sz, td[0] * sz];                                      // toward the ring, in (radius, z)
      const at = (rr, zz, side, n) => S([rr * ca - side * sa, rr * sa + side * ca, zz], [n[0] * ca - n[2] * sa, n[0] * sa + n[2] * ca, n[1]], 1.0, HULL, true);
      for (let i = 0; i < 110 * k; i++) {                // airlock nozzle: a slim cone, 0.06 long (points per area as on the pylon, so it takes the same colour)
        const s2 = rnd(), ph = rnd() * TAU, w = 0.011 * (1 - s2) + 0.002;
        const c0 = [tip[0] + td[0] * s2 * 0.06, tip[1] + td[1] * s2 * 0.06];
        const nn = [-td[1] * Math.cos(ph), td[0] * Math.cos(ph), Math.sin(ph)];
        at(c0[0] + nn[0] * w, c0[1] + nn[1] * w, nn[2] * w, nn);
      }
      const nose = [tip[0] + td[0] * 0.06, tip[1] + td[1] * 0.06];
      for (let i = 0; i < 2; i++) light([nose[0] * ca, nose[0] * sa, nose[1]], [ca, sa, sz], [1.0, 0.55, 0.3], 2.5, 0);   // port light
      const g = bez(P, 0.9);
      const gc = [g[0] + inner[0] * 0.016, g[1] + inner[1] * 0.016];                // gondola centre, fused to the underside of the pylon
      for (let i = 0; i < 520 * k; i++) {                // control gondola: a teardrop pod along the pylon
        const s2 = rnd() * 2 - 1, ph = rnd() * TAU, w = 0.02 * Math.sqrt(Math.max(0, 1 - s2 * s2)) * (1 - 0.35 * s2);
        const c0 = [gc[0] + td[0] * s2 * 0.05, gc[1] + td[1] * s2 * 0.05];
        const nn = [inner[0] * Math.cos(ph) + td[0] * s2 * 0.6, inner[1] * Math.cos(ph) + td[1] * s2 * 0.6, Math.sin(ph)];
        at(c0[0] + inner[0] * Math.cos(ph) * w, c0[1] + inner[1] * Math.cos(ph) * w, Math.sin(ph) * w, nn);
      }
      for (let i = 0; i < 14 * k; i++) {                 // observation windows along the gondola
        const s2 = rnd() * 1.4 - 0.7, c0 = [gc[0] + td[0] * s2 * 0.05 + inner[0] * 0.02, gc[1] + td[1] * s2 * 0.05 + inner[1] * 0.02];
        light([c0[0] * ca, c0[0] * sa, c0[1]], [inner[0] * ca, inner[0] * sa, inner[1]], WARM, 1.1, 0);
      }
      for (let i = 0; i < 5; i++) light([0.97 * ca, 0.97 * sa, 0.04 * sz], [ca, sa, 0], [1.0, 0.6, 0.25], 3, 0);   // docking lights at the root
    }

    }
    if (PART === "ship") {
    // ---------------------------------------------------------------- Enterprise-D (x forward, z up)
    const EH = [0.8, 0.82, 0.86], WIN = [1.0, 0.95, 0.85];
    const E = (p, n, f = 1.0, c = EH) => surf(p, n, c, f, 1, 0.006);
    // saucer: an ellipse, domed above, shallower below
    const SC = [0.17, 0, 0.02], AX = 0.25, AY = 0.235;
    for (let i = 0; i < 9000 * k;) {
      const dx = (rnd() * 2 - 1) * AX, dy = (rnd() * 2 - 1) * AY, q = (dx / AX) ** 2 + (dy / AY) ** 2;
      if (q > 1) continue;
      const gx = 2 * dx / AX / AX, gy = 2 * dy / AY / AY;
      if (rnd() < 0.55) E([SC[0] + dx, dy, SC[2] + 0.006 + 0.045 * (1 - q)], [0.045 * gx, 0.045 * gy, 1]);
      else E([SC[0] + dx, dy, SC[2] - 0.006 - 0.03 * (1 - q)], [0.03 * gx, 0.03 * gy, -1]);
      i++;
    }
    for (let i = 0; i < 1500 * k; i++) {                 // rim
      const a = rnd() * TAU, z = (rnd() * 2 - 1) * 0.006;
      E([SC[0] + AX * Math.cos(a), AY * Math.sin(a), SC[2] + z], [Math.cos(a) / AX, Math.sin(a) / AY, 0]);
    }
    for (const q of [0.97, 0.8, 0.62]) for (let i = 0; i < 260 * k; i++) {   // window rows on the saucer
      const a = rnd() * TAU, s = Math.sqrt(q);
      light([SC[0] + AX * s * Math.cos(a), AY * s * Math.sin(a), SC[2] + 0.007 + 0.045 * (1 - q)], [0, 0, 1], WIN, 1.1, 1);
    }
    for (let i = 0; i < 300 * k; i++) {                  // bridge
      const u = rnd() * TAU, v = rnd() * Math.PI / 2;
      E([SC[0] + 0.02 * Math.cos(v) * Math.cos(u), 0.02 * Math.cos(v) * Math.sin(u), SC[2] + 0.051 + 0.012 * Math.sin(v)], [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)]);
    }
    // an elliptic tube between two points, for the neck and the nacelle pylons
    const tube = (a, b, ry, rz, n) => {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), t0 = d.map((x) => x / L);
      const s1 = nrm(Math.abs(t0[2]) < 0.9 ? [t0[1], -t0[0], 0] : [1, 0, 0]), s2 = nrm([t0[1] * s1[2] - t0[2] * s1[1], t0[2] * s1[0] - t0[0] * s1[2], t0[0] * s1[1] - t0[1] * s1[0]]);
      for (let i = 0; i < n * k; i++) {
        const t = rnd(), ph = rnd() * TAU, c1 = Math.cos(ph) * ry, c2 = Math.sin(ph) * rz;
        E([0, 1, 2].map((j) => a[j] + d[j] * t + s1[j] * c1 + s2[j] * c2), [0, 1, 2].map((j) => s1[j] * Math.cos(ph) / ry + s2[j] * Math.sin(ph) / rz));
      }
    };
    tube([0.04, 0, -0.01], [-0.12, 0, -0.1], 0.022, 0.03, 1400);                 // neck
    // engineering hull: an ellipsoid, with the deflector dish at its front
    const EC = [-0.28, 0, -0.12], EA = [0.27, 0.06, 0.065];
    for (let i = 0; i < 6000 * k; i++) {
      const u = rnd() * TAU, v = Math.acos(rnd() * 2 - 1);
      const s = [Math.cos(v), Math.sin(v) * Math.cos(u), Math.sin(v) * Math.sin(u)];
      E([EC[0] + EA[0] * s[0], EC[1] + EA[1] * s[1], EC[2] + EA[2] * s[2]], [s[0] / EA[0], s[1] / EA[1], s[2] / EA[2]]);
    }
    for (let i = 0; i < 260 * k; i++) {
      const r = Math.sqrt(rnd()) * 0.035, a = rnd() * TAU;
      light([EC[0] + EA[0] * 0.96, r * Math.cos(a), EC[2] + r * Math.sin(a) * 0.9], [1, 0, 0], [0.45, 0.7, 1.0], 2.2, 1);
    }
    for (const z of [0.3, -0.1]) for (let i = 0; i < 200 * k; i++) {             // hull windows
      const x = -0.45 + rnd() * 0.3, sgn = rnd() < 0.5 ? -1 : 1, s = 1 - ((x - EC[0]) / EA[0]) ** 2;
      light([x, sgn * EA[1] * Math.sqrt(Math.max(0, s - z * z)), EC[2] + EA[2] * z], [0, sgn, z], WIN, 1.0, 1);
    }
    // nacelles on their pylons
    for (const sy of [-1, 1]) {
      tube([-0.32, 0.04 * sy, -0.09], [-0.37, 0.19 * sy, 0.0], 0.01, 0.018, 900);
      const y0 = 0.2 * sy, z0 = 0.01, ry = 0.028, rz = 0.022, x0 = -0.62, x1 = -0.18;
      for (let i = 0; i < 3200 * k; i++) {
        const x = x0 + rnd() * (x1 - x0), ph = rnd() * TAU;
        const end = Math.min(1, (x1 - x) / 0.03, (x - x0) / 0.02), sc = Math.sqrt(Math.max(0.05, end));   // rounded ends
        E([x, y0 + Math.cos(ph) * ry * sc, z0 + Math.sin(ph) * rz * sc], [end < 1 ? (x > -0.4 ? 1 : -1) * (1 - end) : 0, Math.cos(ph) / ry, Math.sin(ph) / rz]);
      }
      for (let i = 0; i < 260 * k; i++) {                // Bussard collector: red, at the front
        const ph = rnd() * TAU, x = x1 - rnd() * 0.03;
        light([x + 0.004, y0 + Math.cos(ph) * ry * 0.9, z0 + Math.sin(ph) * rz * 0.9], [1, Math.cos(ph), Math.sin(ph)], [1.0, 0.25, 0.15], 2.6, 1);
      }
      for (let i = 0; i < 500 * k; i++) {                // warp grille: blue, along the inboard side
        const x = x0 + 0.03 + rnd() * (x1 - x0 - 0.07);
        light([x, y0 - sy * ry * 1.02, z0 + (rnd() - 0.5) * rz], [0, -sy, 0], [0.4, 0.6, 1.0], 1.8, 1);
      }
    }
    }
    return { data: new Float32Array(out), solid: new Float32Array(solid), solidSize: PART === "ship" ? 0.01 : 0.022 };
  },
};
