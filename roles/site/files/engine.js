// Shared point-cloud engine for the space previews.
//
// A scene (the global SCENE, defined before this runs) supplies:
//   build(ctx)   -> { data: Float32Array, stride 11: x y z  r g b flux  e0 e1 e2 e3 }
//   glsl         -> GLSL defining  vec3 place(vec3 p, vec4 e, inout vec3 col, inout float flux)
//                   (uTime = scene time, uCam = camera position in world units)
//   view         -> { radius, el, az, roll ("diag" or degrees), fov, offset:[x,y] }
//   exposure, haze (0..), hazeFrac, timeScale, bg (distant star count, 0 for none)
//   step(dt, data) (optional) -> mutate positions on the CPU; the buffer is re-uploaded
//   center(t) (optional) -> [x,y,z] the camera looks at
//   view.disk    -> frame a disk of that radius seen at view.el, rather than a sphere
//   ppkRef       -> px per unit on a 1600x1000 window where exposure was tuned (default from radius)
//   hazeFlux     -> give every haze point this flux instead of its star's
//   tick(t)      -> { uName: value } floats set on the point program each frame (declare them in glsl)
//   build may also return  dust  (drawn after data, absorbing: rgb = absorption per
//   channel, flux = opacity, and dustSize = its size in world units) and  front
//   (emission drawn over the dust, e.g. lit rims on a dark cloud), and  solid
//   (opaque surface points, depth-tested, colour = rgb * flux; solidSize in world
//   units; a point with e.w = -k is drawn k times larger) which then hides whatever
//   glowing points lie behind it
//
// The page runs it as ENGINE.run(SCENE), and again with another scene to swap one in:
// the GL context, the input and the frame loop stay, and everything built from the
// scene is freed and built anew. ENGINE.leave() fades the current scene out first.
(() => {
"use strict";
const canvas = document.getElementById("c");
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: true, powerPreference: "high-performance" });
if (!gl) { document.body.insertAdjacentHTML("beforeend", "<p style='position:fixed;top:45%;width:100%;text-align:center'>WebGL is not available.</p>"); window.ENGINE = { run() {}, leave() {} }; return; }
const DEG = Math.PI / 180;
const coarse = matchMedia("(pointer: coarse)").matches;
const small = Math.min(screen.width, screen.height) < 700;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// deterministic PRNG shared with scenes
let seed = 0x9e3779b9;
function rnd() {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function gauss() { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
function b64(s, T) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); }
const ctx = { rnd, gauss, b64, DEG, coarse, small, lite: coarse || small };

// ---------------------------------------------------------------- GL
function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src);
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos"); gl.bindAttribLocation(p, 1, "aCol"); gl.bindAttribLocation(p, 2, "aX");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const HEAD = `
precision highp float;
attribute vec3 aPos; attribute vec4 aCol; attribute vec4 aX;
uniform mat4 uMV, uP; uniform float uDpr, uRef, uExposure, uFade, uScale, uHaze, uTime;
uniform vec3 uCam;
varying vec3 vCol;
`;
const MAIN = `
void main() {
  vec3 col = aCol.rgb; float flux = aCol.a;
  vec3 w = place(aPos, aX, col, flux);
  vec4 mv = uMV * vec4(w, 1.0);
  gl_Position = uP * mv;
  if (flux <= 0.0 || mv.z > -0.01) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  float persp = clamp(uRef / -mv.z, 0.3, 4.0);
  float f = flux * uExposure * uFade;
  float size = uHaze > 0.0
    ? uHaze * uDpr * persp
    : max((1.1 + 1.25 * sqrt(flux)) * uDpr * sqrt(persp * uScale), 1.5 * uDpr);
  gl_PointSize = min(size, 64.0 * uDpr);
  vCol = col * f * (uDpr * uDpr * 2.2) / (size * size) * persp;
}`;
const FS = `
precision mediump float;
varying vec3 vCol;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r2 * 3.5), 1.0);
}`;
const DUST_MAIN = `
uniform float uDustPx;
void main() {
  vec3 col = aCol.rgb; float flux = aCol.a;
  vec3 w = place(aPos, aX, col, flux);
  vec4 mv = uMV * vec4(w, 1.0);
  gl_Position = uP * mv;
  if (flux <= 0.0 || mv.z > -0.01) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  float persp = clamp(uRef / -mv.z, 0.3, 4.0);
  gl_PointSize = max(uDustPx * uDpr * persp, 1.5 * uDpr);
  vCol = col * flux * uFade;
}`;
const FS_DUST = `
precision mediump float;
varying vec3 vCol;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * (1.0 - r2), 1.0);
}`;
const SOLID_MAIN = `
uniform float uSolidPx;
void main() {
  vec3 col = aCol.rgb; float flux = aCol.a;
  vec3 w = place(aPos, aX, col, flux);
  vec4 mv = uMV * vec4(w, 1.0);
  gl_Position = uP * mv;
  if (mv.z > -0.01) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  float persp = clamp(uRef / -mv.z, 0.3, 4.0);
  float big = aX.w < -0.5 ? -aX.w : 1.0;            // a negative e.w on a solid point scales its size
  gl_PointSize = max(uSolidPx * big * uDpr * persp, 1.0);
  vCol = col * max(flux, 0.0) * uExposure * uFade;
}`;
const FS_SOLID = `
precision mediump float;
varying vec3 vCol;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  if (dot(p, p) > 1.0) discard;
  gl_FragColor = vec4(vCol, 1.0);
}`;
const progBg = program(HEAD + "vec3 place(vec3 p, vec4 e, inout vec3 c, inout float f) { return p; }" + MAIN, FS);
const U = (p) => { const o = {}; for (const n of ["uMV", "uP", "uDpr", "uRef", "uExposure", "uFade", "uScale", "uHaze", "uTime", "uCam"]) o[n] = gl.getUniformLocation(p, n); return o; };
const ub = U(progBg);

const STRIDE = 11;
function makeBuf(arr, dynamic) {
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, arr, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  return { buf: b, count: arr.length / STRIDE };
}
function bindBuf(b) {
  gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 44, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 44, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 44, 28);
}

// ---------------------------------------------------------------- matrices (column-major)
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
function rotY(t) { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); }
function trans(x, y, z) { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]); }
function persp(fovy, asp, n, f) {
  const t = 1 / Math.tan(fovy / 2);
  return new Float32Array([t / asp,0,0,0, 0,t,0,0, 0,0,(f + n) / (n - f),-1, 0,0,2 * f * n / (n - f),0]);
}

// ---------------------------------------------------------------- the scene
// Everything below is built from the scene, and replaced with it.
let S, built, data, count, prog, progDust, progSolid, u, us, ud, tickLoc;
let main, dustBuf, frontBuf, solidBuf, hazeBuf, bgBuf, V, FOV, OFFSET, BASE, PPK_REF;
let t0, simT, lastNow, stepped, leaving;
function free() {
  for (const p of [prog, progDust, progSolid]) if (p) gl.deleteProgram(p);
  for (const b of [main, dustBuf, frontBuf, solidBuf, hazeBuf, bgBuf]) if (b) gl.deleteBuffer(b.buf);
}
function load(scene) {
  free();
  S = scene;
  seed = 0x9e3779b9;                                     // the same scene draws the same every time
  built = S.build(ctx);
  data = built.data; count = data.length / STRIDE;
  prog = program(HEAD + S.glsl + MAIN, FS);
  progDust = built.dust ? program(HEAD + S.glsl + DUST_MAIN, FS_DUST) : null;
  progSolid = built.solid ? program(HEAD + S.glsl + SOLID_MAIN, FS_SOLID) : null;
  u = U(prog); tickLoc = {};
  us = progSolid ? Object.assign(U(progSolid), { uSolidPx: gl.getUniformLocation(progSolid, "uSolidPx") }) : null;
  ud = progDust ? Object.assign(U(progDust), { uDustPx: gl.getUniformLocation(progDust, "uDustPx") }) : null;
  main = makeBuf(data, !!S.step);
  dustBuf = built.dust ? makeBuf(built.dust, false) : null;
  frontBuf = built.front ? makeBuf(built.front, false) : null;
  solidBuf = built.solid ? makeBuf(built.solid, false) : null;
  hazeBuf = null; bgBuf = null;
  // haze: a random subset drawn as wide, faint sprites -- the unresolved light
  if (S.haze > 0) {
    const frac = S.hazeFrac || 0.05, keep = [];
    for (let i = 0; i < count; i++) if (rnd() < frac) keep.push(i);
    const h = new Float32Array(keep.length * STRIDE);
    keep.forEach((i, j) => { h.set(data.subarray(i * STRIDE, i * STRIDE + STRIDE), j * STRIDE); h[j * STRIDE + 6] = S.hazeFlux || data[i * STRIDE + 6]; });
    hazeBuf = makeBuf(h, false);
    hazeBuf.keep = keep; hazeBuf.arr = h;
  }

  // distant stars in the camera's frame
  if (S.bg) {
    const n = ctx.lite ? Math.round(S.bg * 0.7) : S.bg, a = new Float32Array(n * STRIDE);
    for (let i = 0; i < n; i++) {
      const ax = (rnd() * 2 - 1) * 42 * DEG, ay = (rnd() * 2 - 1) * 38 * DEG;
      let x = Math.tan(ax), y = Math.tan(ay), z = -1; const l = Math.hypot(x, y, z);
      const w = rnd(), c = w < 0.2 ? [0.72, 0.8, 1.0] : w > 0.85 ? [1.0, 0.86, 0.68] : [0.92, 0.93, 1.0];
      a.set([x / l * 1000, y / l * 1000, z / l * 1000, c[0], c[1], c[2], 0.35 + 4.5 * Math.pow(rnd(), 7), 0, 0, 0, 0], i * STRIDE);   // mostly faint, a scattering of brighter ones
    }
    bgBuf = makeBuf(a, false);
  }
  V = S.view; FOV = (V.fov || 26) * DEG; OFFSET = V.offset || [0, 0];
  BASE = mul(rotX(-(Math.PI / 2 - V.el * DEG)), rotZ(-V.az * DEG - Math.PI / 2));
  PPK_REF = S.ppkRef || 500 / (V.radius * 1.05);       // px per unit on a 1600x1000 window, where exposure is tuned
  t0 = performance.now(); simT = 0; lastNow = null; stepped = false; leaving = null;
  resize();
}

// ---------------------------------------------------------------- view
let W = 0, H = 0, dpr = 1, dist = 10, roll = 0, ppk = 1, P, dirty = true, restYaw = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // fill is the cost, and it goes as dpr squared; sprites scale with it, so the look holds
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  const asp = W / H, tv = Math.tan(FOV / 2);
  roll = (V.roll === "diag" ? Math.min(42, Math.max(22, Math.atan2(H, W) / DEG * 0.8)) : (V.roll || 0)) * DEG;
  restYaw = W < H ? (V.portraitYaw || 0) * DEG : 0;
  if (V.disk) {                                  // the disk's projected ellipse, laid along the roll
    const a = V.radius, b = V.radius * Math.sin(V.el * DEG), th = tv * asp;
    const hw = Math.sqrt(a * a * Math.cos(roll) ** 2 + b * b * Math.sin(roll) ** 2);
    const hh = Math.sqrt(a * a * Math.sin(roll) ** 2 + b * b * Math.cos(roll) ** 2);
    dist = Math.max(hw / th, hh / tv) * 1.02;
  } else dist = V.radius / (tv * Math.min(1, asp)) * 1.05;
  P = persp(FOV, asp, dist * 0.002, Math.max(dist * 60, 2000));   // far enough for the distant star field at 1000
  P[8] = -OFFSET[0]; P[9] = -OFFSET[1];
  ppk = (H / 2) / (tv * dist);
  dirty = true;
}

// ---------------------------------------------------------------- input: pointer parallax + device motion
const MAX_YAW = 9 * DEG, MAX_PITCH = 7 * DEG;
let tx = 0, ty = 0, cx = 0, cy = 0, usingMotion = false, base = null;
window.addEventListener("pointermove", (e) => {
  if (pinch) return;                                     // two fingers zoom; they do not steer
  if (e.pointerType === "mouse" || e.buttons) { tx = (e.clientX / W) * 2 - 1; ty = (e.clientY / H) * 2 - 1; usingMotion = false; }
}, { passive: true });
window.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse" && !usingMotion) { tx = 0; ty = 0; } });
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let x, y;
  if (ang === 90) { x = e.beta; y = -e.gamma; }
  else if (ang === -90 || ang === 270) { x = -e.beta; y = e.gamma; }
  else if (ang === 180) { x = -e.gamma; y = -e.beta; }
  else { x = e.gamma; y = e.beta; }
  if (!base) base = { x, y };
  base.x += (x - base.x) * 0.015; base.y += (y - base.y) * 0.015;
  tx = Math.max(-1, Math.min(1, (x - base.x) / 14)); ty = Math.max(-1, Math.min(1, (y - base.y) / 14));
  usingMotion = true;
}
// iOS sends orientation only after a permission prompt, and a page that asks for motion
// on its first tap is not worth a parallax effect; there, touch drives it instead.
if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission !== "function")
  window.addEventListener("deviceorientation", onOrient);

// ---------------------------------------------------------------- wheel and two fingers: a little zoom, eased
// The wheel (and a trackpad pinch, which arrives as a wheel event with ctrlKey) moves the
// camera at most a quarter closer or farther; dots scale with it, so the look holds.
const ZOOM_MIN = 0.78, ZOOM_MAX = 1.28;
let zoomT = 1, zoom = 1;
window.addEventListener("wheel", (e) => {
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomT = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomT * Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012))));
}, { passive: false });

// Two fingers on a touch screen do the same: spread or pinch them, or slide both up to
// come closer and down to draw back. Each move is measured from the last, so the two
// combine. Safari zooms the page on a pinch whatever touch-action says, unless its own
// gesture events are refused.
let pinch = null;
const twoFingers = (e) => {
  const [a, b] = e.touches;
  return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), y: (a.clientY + b.clientY) / 2 };
};
window.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) { pinch = twoFingers(e); tx = 0; ty = 0; }
}, { passive: true });
window.addEventListener("touchmove", (e) => {
  if (!pinch || e.touches.length !== 2) return;
  const g = twoFingers(e);
  zoomT = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomT * (pinch.d / g.d) * Math.exp((g.y - pinch.y) * 0.0025)));
  pinch = g;
}, { passive: true });
window.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; });
window.addEventListener("touchcancel", () => { pinch = null; });
for (const g of ["gesturestart", "gesturechange"]) document.addEventListener(g, (e) => e.preventDefault());

// ---------------------------------------------------------------- loop
gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.clearColor(0, 0, 0, 1);
const pinned = /^#t=/.test(location.hash) ? parseFloat(location.hash.slice(3)) : null;   // preview aid: freeze the clock
const ENTER_S = 1.8, LEAVE_S = 0.6;                       // seconds a scene takes to fade in, and out
// Everything here moves slowly, so 30 frames a second is enough; uncapped, a 120 Hz display
// would draw four times the frames for nothing. The slack keeps a 60 Hz display at 30, not 20.
const FRAME_MS = 1000 / 30 - 4;

function frame(now) {
  requestAnimationFrame(frame);
  if (!S) return;
  if (lastNow !== null && now - lastNow < FRAME_MS) return;
  const real = pinned !== null ? pinned : (now - t0) / 1000;
  const dtReal = lastNow === null ? 0 : Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
  const intro = Math.min(1, real / 3.2), ease = 1 - Math.pow(1 - intro, 3);
  const fade = Math.min(1, real / ENTER_S) * (leaving === null ? 1 : Math.max(0, 1 - (now - leaving) / 1000 / LEAVE_S));
  const speed = reduceMotion ? 0 : 1;
  if (pinned !== null) simT = pinned * (S.timeScale || 1);
  else simT += dtReal * (S.timeScale || 1) * speed;

  const ease60 = (k) => 1 - Math.pow(1 - k, dtReal * 60);   // easing rates are per 60 Hz frame, whatever the frame rate
  const k = ease60(usingMotion ? 0.12 : 0.06);
  cx += (tx - cx) * k; cy += (ty - cy) * k;
  zoom += (zoomT - zoom) * ease60(0.12);
  const ppkZ = ppk / zoom;                      // px per unit at the centre, zoom included

  if (S.step) {
    if (pinned !== null && !stepped) { for (let i = 0; i < pinned * 60; i++) S.step(1 / 60 * (S.timeScale || 1), data, simT); stepped = true; }
    else if (pinned === null && speed) S.step(dtReal * (S.timeScale || 1), data, simT);
    gl.bindBuffer(gl.ARRAY_BUFFER, main.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    if (hazeBuf) {
      const h = hazeBuf.arr;
      hazeBuf.keep.forEach((i, j) => { h[j * STRIDE] = data[i * STRIDE]; h[j * STRIDE + 1] = data[i * STRIDE + 1]; h[j * STRIDE + 2] = data[i * STRIDE + 2]; });
      gl.bindBuffer(gl.ARRAY_BUFFER, hazeBuf.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, h);
    }
  }

  const introYaw = (1 - ease) * -14 * DEG, introPitch = (1 - ease) * 10 * DEG;
  const d = dist * zoom * (1 + (1 - ease) * 0.12);
  const spin = (S.spin || 0) * simT / (S.timeScale || 1);
  const c = S.center ? S.center(simT) : [0, 0, 0];
  const R = mul(rotX(cy * MAX_PITCH + introPitch), mul(rotY(cx * MAX_YAW + restYaw + introYaw), mul(rotZ(roll), mul(BASE, rotZ(spin)))));
  const MV = mul(trans(0, 0, -d), mul(R, trans(-c[0], -c[1], -c[2])));
  // camera position in world: c + R^T (0,0,d)
  const cam = [c[0] + R[2] * d, c[1] + R[6] * d, c[2] + R[10] * d];

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.blendFunc(gl.ONE, gl.ONE);
  const sc = ppkZ / PPK_REF, scale = Math.min(1.3, Math.max(0.5, sc));
  if (bgBuf) {
    gl.useProgram(progBg);
    gl.uniformMatrix4fv(ub.uMV, false, mul(rotX(cy * MAX_PITCH + introPitch), rotY(cx * MAX_YAW + introYaw))); gl.uniformMatrix4fv(ub.uP, false, P);
    gl.uniform1f(ub.uDpr, dpr); gl.uniform1f(ub.uRef, 1000); gl.uniform1f(ub.uFade, fade); gl.uniform1f(ub.uScale, 1);
    gl.uniform1f(ub.uExposure, S.bgExposure || 1.4); gl.uniform1f(ub.uHaze, 0);
    bindBuf(bgBuf); gl.drawArrays(gl.POINTS, 0, bgBuf.count);
  }
  gl.blendFunc(gl.ONE, gl.ONE);

  if (solidBuf) {
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.useProgram(progSolid);
    gl.uniformMatrix4fv(us.uMV, false, MV); gl.uniformMatrix4fv(us.uP, false, P);
    gl.uniform1f(us.uDpr, dpr); gl.uniform1f(us.uRef, d); gl.uniform1f(us.uFade, fade);
    gl.uniform1f(us.uTime, simT); gl.uniform3fv(us.uCam, cam);
    gl.uniform1f(us.uExposure, S.solidExposure || 1); gl.uniform1f(us.uSolidPx, (built.solidSize || 0.02) * ppkZ);
    bindBuf(solidBuf); gl.drawArrays(gl.POINTS, 0, solidBuf.count);
    gl.enable(gl.BLEND); gl.depthMask(false);     // glowing points are hidden behind it, but do not hide each other
  }

  gl.useProgram(prog);
  if (S.tick) { const v = S.tick(simT); for (const n in v) { if (!(n in tickLoc)) tickLoc[n] = gl.getUniformLocation(prog, n); gl.uniform1f(tickLoc[n], v[n]); } }
  gl.uniformMatrix4fv(u.uMV, false, MV); gl.uniformMatrix4fv(u.uP, false, P);
  gl.uniform1f(u.uDpr, dpr); gl.uniform1f(u.uRef, d); gl.uniform1f(u.uFade, fade); gl.uniform1f(u.uScale, scale);
  gl.uniform1f(u.uTime, simT); gl.uniform3fv(u.uCam, cam);
  if (hazeBuf) {
    gl.uniform1f(u.uExposure, S.haze * S.exposure * sc * sc); gl.uniform1f(u.uHaze, (S.hazeSize || 0.9) * ppkZ * (S.hazeUnit || V.radius / 16));
    bindBuf(hazeBuf); gl.drawArrays(gl.POINTS, 0, hazeBuf.count);
  }
  gl.uniform1f(u.uExposure, S.exposure * sc * sc); gl.uniform1f(u.uHaze, 0);
  bindBuf(main); gl.drawArrays(gl.POINTS, 0, main.count);

  if (dustBuf) {
    gl.useProgram(progDust);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
    gl.uniformMatrix4fv(ud.uMV, false, MV); gl.uniformMatrix4fv(ud.uP, false, P);
    gl.uniform1f(ud.uDpr, dpr); gl.uniform1f(ud.uRef, d); gl.uniform1f(ud.uFade, fade);
    gl.uniform1f(ud.uTime, simT); gl.uniform3fv(ud.uCam, cam); gl.uniform1f(ud.uDustPx, (built.dustSize || 0.1) * ppkZ);
    bindBuf(dustBuf); gl.drawArrays(gl.POINTS, 0, dustBuf.count);
    gl.blendFunc(gl.ONE, gl.ONE);
  }
  if (frontBuf) {
    gl.useProgram(prog);
    gl.uniform1f(u.uExposure, (S.frontExposure || S.exposure) * sc * sc); gl.uniform1f(u.uHaze, 0);
    bindBuf(frontBuf); gl.drawArrays(gl.POINTS, 0, frontBuf.count);
  }
  if (solidBuf) { gl.disable(gl.DEPTH_TEST); gl.depthMask(true); }

}
window.addEventListener("resize", () => { if (S) resize(); });
let running = false;
window.ENGINE = {
  // a scene that fails to build leaves the canvas black and the error to the page
  run(scene) { try { load(scene); } catch (e) { S = null; throw e; } if (!running) { running = true; requestAnimationFrame(frame); } },
  leave() { if (S && leaving === null) leaving = performance.now(); },
  ENTER_MS: ENTER_S * 1000, LEAVE_MS: LEAVE_S * 1000,
};
})();
