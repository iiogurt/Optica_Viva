// 3-D views: a small dependency-free WebGL 2 renderer for the laboratories. A view draws a scene of
// meshes (shaded solids, or glass with a Fresnel rim), thick glowing polylines (rays, orbits,
// field lines) and text labels, seen through an orbit camera (drag to rotate, wheel or pinch to
// zoom, shift-drag or two-finger drag to pan, double-click or ⟲ to reset, arrow keys and +/− when
// focused). It renders only when the scene or the camera changes. Without WebGL 2 the view says
// so and the page's 2-D figures carry on. Geometry comes from js/lib/mesh3d.js.
import { h, download } from './ui.js';
import { t } from './i18n.js';
import { bounds } from './mesh3d.js';

export function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

// ── column-major 4×4 matrices ─────────────────────────────────────────────────────────────
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(e, c, up) {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let L = Math.hypot(zx, zy, zz); zx /= L; zy /= L; zz /= L;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  L = Math.hypot(xx, xy, xz) || 1; xx /= L; xy /= L; xz /= L;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

// ── shaders ───────────────────────────────────────────────────────────────────────────────
const MESH_VS = `#version 300 es
in vec3 p; in vec3 n; in vec3 c;
uniform mat4 mvp;
out vec3 vN; out vec3 vP; out vec3 vC;
void main() { vN = n; vP = p; vC = c; gl_Position = mvp * vec4(p, 1.0); }`;
const MESH_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vP; in vec3 vC;
uniform float opacity; uniform vec3 eye; uniform int glass;
out vec4 o;
void main() {
  vec3 color = vC; // per-vertex colour, or the mesh colour as a constant attribute
  vec3 N = normalize(vN), V = normalize(eye - vP);
  if (dot(N, V) < 0.0) N = -N; // light both sides
  vec3 L1 = normalize(vec3(0.45, 0.8, -0.4)), L2 = normalize(vec3(-0.6, -0.2, 0.7));
  float d = max(dot(N, L1), 0.0) + 0.35 * max(dot(N, L2), 0.0);
  float hemi = 0.55 + 0.45 * N.y;
  float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 60.0);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  if (glass == 1) {
    vec3 c = color * (0.25 + 0.45 * d) + vec3(0.9, 0.95, 1.0) * (0.85 * spec + 0.45 * fr);
    o = vec4(c, clamp(opacity + 0.75 * fr + 0.6 * spec, 0.0, 0.95));
  } else {
    vec3 c = color * (0.18 * hemi + 0.82 * d) + vec3(1.0) * 0.25 * spec + color * 0.12 * fr;
    o = vec4(c, opacity);
  }
}`;
// thick lines: each segment is a quad expanded across the screen-space direction of the segment
const LINE_VS = `#version 300 es
in vec3 a; in vec3 b; in vec2 sv; in vec4 col; // sv: (±width in px, end 0/1)
uniform mat4 mvp; uniform vec2 px; uniform float width;
out vec4 vC; out float vS;
void main() {
  vec4 A = mvp * vec4(a, 1.0), B = mvp * vec4(b, 1.0);
  vec2 sa = A.xy / max(A.w, 1e-6), sb = B.xy / max(B.w, 1e-6);
  vec2 d = normalize((sb - sa) * px + vec2(1e-9, 0.0));
  vec2 nrm = vec2(-d.y, d.x) / px * width;
  vec4 P = sv.y < 0.5 ? A : B;
  P.xy += nrm * sv.x * P.w;
  gl_Position = P; vC = col; vS = sign(sv.x); // −1…+1 across the line, for the soft edge
}`;
const LINE_FS = `#version 300 es
precision highp float;
in vec4 vC; in float vS; out vec4 o;
void main() { float e = 1.0 - smoothstep(0.35, 1.0, abs(vS)); o = vec4(vC.rgb, vC.a * e); }`;
const BG_VS = `#version 300 es
in vec2 q; out vec2 uv;
void main() { uv = q * 0.5 + 0.5; gl_Position = vec4(q, 0.999, 1.0); }`;
const BG_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
void main() {
  float r = distance(uv, vec2(0.5, 0.62));
  vec3 c = mix(vec3(0.075, 0.095, 0.15), vec3(0.018, 0.022, 0.035), smoothstep(0.0, 0.85, r));
  o = vec4(c, 1.0);
}`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

// view3d({ label, aspect, minH, maxH, yaw, pitch }) → { el, setScene(scene, keepCamera), redraw(), destroy() }
// scene = {
//   meshes: [{ mesh, color: [r, g, b] (0–1), opacity = 1, glass = false }] (mesh.colors, if present:
//           per-vertex RGB, replacing color),
//   lines:  [{ points: [[x, y, z], …], color: [r, g, b, a], width = 1.5 (px), glow = true }],
//   labels: [{ p: [x, y, z], text, color = '#fff' }],
//   frame:  optional { centre, size } to aim the camera at (default: everything)
// }
export function view3d({ label = '', aspect = 2, minH = 260, maxH = 620, yaw = -0.75, pitch = 0.32 } = {}) {
  const canvas = h('canvas', { tabindex: '0', role: 'img', 'aria-label': (label ? t(label) + '. ' : '') + t('3-D view: drag to rotate, scroll or pinch to zoom, double-click to reset.') });
  const overlay = h('canvas.v3d-overlay', { 'aria-hidden': 'true' });
  const hint = h('div.v3d-hint', {}, t('Drag to rotate · scroll to zoom · double-click to reset'));
  const resetBtn = h('button.st-btn', { type: 'button', title: t('Reset the view') }, '⟲');
  const pngBtn = h('button.st-btn', { type: 'button', title: t('Save this picture as PNG') }, 'PNG');
  const el = h('figure.stage.v3d', {}, canvas, overlay, label ? h('figcaption', {}, t(label)) : null, hint, h('div.stage-tools', {}, resetBtn, pngBtn));
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
  if (!gl) {
    el.classList.add('v3d-none');
    el.append(h('p.v3d-msg', {}, t('This 3-D view needs WebGL 2, which this browser does not provide. The 2-D figures show the same results.')));
    return { el, setScene() {}, redraw() {}, destroy() {}, ok: false };
  }
  const mesh = program(gl, MESH_VS, MESH_FS), line = program(gl, LINE_VS, LINE_FS), bg = program(gl, BG_VS, BG_FS);
  const bgBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const cam = { yaw, pitch, dist: 1, target: [0, 0, 0], size: 1 }, home = { yaw, pitch };
  let objs = [], lineVAO = null, lineCount = 0, plainCount = 0, lineBufs = [], labels = [], dirty = true, raf = 0, W = 1, H = 1, M = null;

  function release() {
    for (const o of objs) { gl.deleteBuffer(o.pb); gl.deleteBuffer(o.nb); if (o.cb) gl.deleteBuffer(o.cb); gl.deleteBuffer(o.ib); gl.deleteVertexArray(o.vao); }
    for (const b of lineBufs) gl.deleteBuffer(b);
    if (lineVAO) gl.deleteVertexArray(lineVAO);
    objs = []; lineBufs = []; lineVAO = null; lineCount = 0; plainCount = 0;
  }
  function setScene(scene, keepCamera = false) {
    release();
    for (const m of scene.meshes || []) {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, m.mesh.positions, gl.STATIC_DRAW);
      let loc = gl.getAttribLocation(mesh.p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, m.mesh.normals, gl.STATIC_DRAW);
      loc = gl.getAttribLocation(mesh.p, 'n'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      let cb = null;
      loc = gl.getAttribLocation(mesh.p, 'c');
      if (m.mesh.colors) { cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, m.mesh.colors, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); }
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.mesh.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const c = bounds([m.mesh]).centre;
      objs.push({ vao, pb, nb, cb, ib, count: m.mesh.indices.length, color: m.color || [0.8, 0.8, 0.8], opacity: m.opacity ?? 1, glass: !!m.glass, centre: c, loc });
    }
    // all polylines in one buffer: per segment 4 vertices (a, b, side/end, colour), 6 indices
    // plain lines (glow: false, blended over what is behind) first, then glowing ones (added)
    const plain = [], glowing = [];
    for (const l of scene.lines || []) for (let i = 0; i + 1 < l.points.length; i++) (l.glow === false ? plain : glowing).push([l.points[i], l.points[i + 1], l.color || [1, 1, 1, 1], l.width || 1.5]);
    const segs = plain.concat(glowing);
    plainCount = plain.length * 6;
    if (segs.length) {
      const A = new Float32Array(segs.length * 4 * 3), B = new Float32Array(segs.length * 4 * 3), S = new Float32Array(segs.length * 4 * 2), C = new Float32Array(segs.length * 4 * 4), I = new Uint32Array(segs.length * 6);
      segs.forEach(([a, b, c, wd], s) => {
        for (let k = 0; k < 4; k++) {
          const v = s * 4 + k;
          A.set(a, v * 3); B.set(b, v * 3);
          S[v * 2] = (k & 1 ? 1 : -1) * wd; S[v * 2 + 1] = k < 2 ? 0 : 1;
          C.set(c, v * 4);
        }
        I.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
      });
      lineVAO = gl.createVertexArray(); gl.bindVertexArray(lineVAO);
      for (const [name, data, size] of [['a', A, 3], ['b', B, 3], ['sv', S, 2], ['col', C, 4]]) {
        const buf = gl.createBuffer(); lineBufs.push(buf);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(line.p, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      }
      const ib = gl.createBuffer(); lineBufs.push(ib);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      lineCount = I.length;
    }
    labels = scene.labels || [];
    if (!keepCamera) {
      const bb = scene.frame || bounds((scene.meshes || []).map((m) => m.mesh), (scene.lines || []).map((l) => l.points));
      if (isFinite(bb.size) && bb.size > 0) { cam.target = bb.centre; cam.size = bb.size; cam.dist = bb.size * 1.25; }
    }
    redraw();
  }

  function matrices() {
    const e = [cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
    const P = perspective((35 * Math.PI) / 180, W / H, cam.size * 0.01, cam.size * 30);
    return { eye: e, mvp: mul(P, lookAt(e, cam.target, [0, 1, 0])) };
  }
  function render() {
    raf = 0; dirty = false;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(bg.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
    const ql = gl.getAttribLocation(bg.p, 'q'); gl.bindVertexArray(null); gl.enableVertexAttribArray(ql); gl.vertexAttribPointer(ql, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(ql);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    M = matrices();
    // opaque meshes, then glass back to front without depth writes, then additive lines
    gl.useProgram(mesh.p);
    gl.uniformMatrix4fv(mesh.u.mvp, false, M.mvp); gl.uniform3fv(mesh.u.eye, M.eye);
    const d2 = (o) => (o.centre[0] - M.eye[0]) ** 2 + (o.centre[1] - M.eye[1]) ** 2 + (o.centre[2] - M.eye[2]) ** 2;
    const opaque = objs.filter((o) => !o.glass && o.opacity >= 1), clear = objs.filter((o) => o.glass || o.opacity < 1).sort((a, b) => d2(b) - d2(a));
    // without per-vertex colours the attribute is disabled in the VAO and takes this constant
    const draw = (o) => { if (!o.cb) gl.vertexAttrib3f(o.loc, o.color[0], o.color[1], o.color[2]); gl.uniform1f(mesh.u.opacity, o.opacity); gl.uniform1i(mesh.u.glass, o.glass ? 1 : 0); gl.bindVertexArray(o.vao); gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_INT, 0); };
    gl.depthMask(true); opaque.forEach(draw);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    clear.forEach(draw);
    if (lineCount) {
      gl.useProgram(line.p);
      gl.uniformMatrix4fv(line.u.mvp, false, M.mvp); gl.uniform2f(line.u.px, W / 2, H / 2); gl.uniform1f(line.u.width, Math.min(2, devicePixelRatio || 1));
      gl.bindVertexArray(lineVAO);
      if (plainCount) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawElements(gl.TRIANGLES, plainCount, gl.UNSIGNED_INT, 0); }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      if (lineCount > plainCount) gl.drawElements(gl.TRIANGLES, lineCount - plainCount, gl.UNSIGNED_INT, plainCount * 4);
    }
    gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.BLEND);
    drawLabels();
  }
  function project(p) {
    const m = M.mvp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return w > 0 ? [((x / w) * 0.5 + 0.5) * W, (0.5 - (y / w) * 0.5) * H] : null;
  }
  function drawLabels(ctx = overlay.getContext('2d')) {
    if (ctx.canvas === overlay) ctx.clearRect(0, 0, W, H);
    const dpr = W / Math.max(1, canvas.clientWidth);
    ctx.save(); ctx.font = `${11 * dpr}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4 * dpr;
    for (const l of labels) { const q = project(l.p); if (!q) continue; ctx.fillStyle = l.color || 'rgba(255,255,255,0.85)'; ctx.fillText(l.text, q[0], q[1]); }
    ctx.restore();
  }
  const redraw = () => { dirty = true; if (!raf) raf = requestAnimationFrame(render); };

  // size: width of the figure, height from the aspect ratio within [minH, maxH]
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.max(1, el.clientWidth);
    const ch = Math.max(minH, Math.min(maxH, cw / aspect));
    canvas.style.height = overlay.style.height = ch + 'px';
    W = canvas.width = overlay.width = Math.round(cw * dpr); H = canvas.height = overlay.height = Math.round(ch * dpr);
    redraw();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(el); else setTimeout(resize, 0);

  // ── interaction ──
  const ptrs = new Map();
  let last = null, interacted = false;
  const dismiss = () => { if (!interacted) { interacted = true; hint.classList.add('gone'); } };
  const pan = (dx, dy) => {
    const s = cam.dist * 0.0018, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    cam.target = [cam.target[0] - dx * s * cy, cam.target[1] + dy * s, cam.target[2] + dx * s * sy];
  };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = null; dismiss(); });
  canvas.addEventListener('pointerup', (e) => { ptrs.delete(e.pointerId); last = null; });
  canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); last = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { // pinch to zoom, move both fingers to pan
      const [p, q] = [...ptrs.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]), mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (last) { cam.dist *= last.d / d; pan(mid[0] - last.mid[0], mid[1] - last.mid[1]); }
      last = { d, mid };
    } else if (e.shiftKey || e.buttons === 4) pan(e.clientX - prev[0], e.clientY - prev[1]);
    else { cam.yaw -= (e.clientX - prev[0]) * 0.008; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + (e.clientY - prev[1]) * 0.008)); }
    redraw();
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); dismiss(); cam.dist *= Math.exp(e.deltaY * 0.0012); cam.dist = Math.max(cam.size * 0.05, Math.min(cam.size * 8, cam.dist)); redraw(); }, { passive: false });
  const reset = () => { cam.yaw = home.yaw; cam.pitch = home.pitch; cam.dist = cam.size * 1.25; redraw(); };
  canvas.addEventListener('dblclick', reset);
  resetBtn.addEventListener('click', reset);
  canvas.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') cam.yaw += 0.1; else if (k === 'ArrowRight') cam.yaw -= 0.1;
    else if (k === 'ArrowUp') cam.pitch = Math.min(1.45, cam.pitch + 0.1); else if (k === 'ArrowDown') cam.pitch = Math.max(-1.45, cam.pitch - 0.1);
    else if (k === '+' || k === '=') cam.dist /= 1.15; else if (k === '-') cam.dist *= 1.15; else if (k === '0') return reset();
    else return;
    e.preventDefault(); dismiss(); redraw();
  });
  pngBtn.addEventListener('click', () => {
    render();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.drawImage(canvas, 0, 0); drawLabels(x);
    const page = location.hash.replace(/^#\/?/, '').split('?')[0] || 'home';
    c.toBlob((b) => b && download(b, `${page}-3d.png`), 'image/png');
  });

  return {
    el, ok: true, setScene, redraw,
    destroy() { if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); release(); },
  };
}
