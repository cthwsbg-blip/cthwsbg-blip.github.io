/* 视频生成长截图 · 拼接计算 Worker
   Port of stitch.py: layout detection -> scroll offsets -> per-pixel median of aligned frames
   (+ mouse-pointer removal, scrollbar thumb removal). All pixel math runs here, off the UI thread. */
'use strict';
const K_MED = 9, BAND = 16, EDGE = 2, VMAX = 15;
let S = null;                       // job state

function fail(code, detail) { const e = new Error(code); e.code = code; e.detail = detail || {}; throw e; }
function gray(r, g, b) { return (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14; }   // == cv2 BGR2GRAY
function roundHalfEven(x) { const f = Math.floor(x), d = x - f; if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1; }
function medianSorted(a, n) { return (n & 1) ? a[n >> 1] : (a[(n >> 1) - 1] + a[n >> 1]) / 2; }
function sortN(a, n) { for (let i = 1; i < n; i++) { const v = a[i]; let j = i - 1; while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; } a[j + 1] = v; } }
function median(arr) { const a = Float64Array.from(arr).sort(); return a.length ? medianSorted(a, a.length) : NaN; }
function runs(mask) { const r = []; let s = -1; for (let i = 0; i <= mask.length; i++) { const m = i < mask.length && mask[i]; if (m && s < 0) s = i; if (!m && s >= 0) { r.push([s, i]); s = -1; } } return r; }
function longest(r) { let b = null; for (const x of r) if (!b || x[1] - x[0] > b[1] - b[0]) b = x; return b; }
function argmaxRange(a, lo, hi) { let bi = -1, bv = -Infinity; for (let i = lo; i < hi; i++) if (a[i] > bv) { bv = a[i]; bi = i; } return bi; }
function progress(stage, done, total) { postMessage({ type: 'progress', stage, done, total }); }

/* ---------- pass 0: layout samples ---------- */
function p0std(rgba) {
  const n = S.W * S.H;
  if (!S.sum) { S.sum = new Float32Array(n); S.sq = new Float32Array(n); S.nstd = 0; }
  const sum = S.sum, sq = S.sq;
  for (let i = 0, j = 0; i < n; i++, j += 4) { const g = gray(rgba[j], rgba[j + 1], rgba[j + 2]); sum[i] += g; sq[i] += g * g; }
  S.nstd++;
}
function p0med(rgba) {
  const n = S.W * S.H, rgb = new Uint8Array(n * 3);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) { rgb[k] = rgba[j]; rgb[k + 1] = rgba[j + 1]; rgb[k + 2] = rgba[j + 2]; }
  (S.medFrames = S.medFrames || []).push(rgb);
}

function detectLayout() {
  const { W, H } = S, N = S.nstd, sum = S.sum, sq = S.sq;
  if (!N || !S.medFrames || !S.medFrames.length) fail('NOREGION');
  const ch = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const m = sum[i] / N, v = sq[i] / N - m * m; ch[i] = (v > 36) ? 1 : 0; }   // std > 6
  S.sum = S.sq = null;
  const colfrac = new Float64Array(W);
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) colfrac[x] += ch[o + x]; }
  let cmax = 0; for (let x = 0; x < W; x++) { colfrac[x] /= H; if (colfrac[x] > cmax) cmax = colfrac[x]; }
  if (cmax <= 0) fail('NOREGION');
  const cols = []; for (let x = 0; x < W; x++) if (colfrac[x] > 0.25 * cmax) cols.push(x);
  const rowmask = new Uint8Array(H);
  for (let y = 0; y < H; y++) { let c = 0; const o = y * W; for (const x of cols) c += ch[o + x]; rowmask[y] = c / cols.length > 0.5 ? 1 : 0; }
  const vr = longest(runs(rowmask)); if (!vr) fail('NOREGION');
  const [v0, v1] = vr;
  const cfm = new Uint8Array(W);
  for (let x = 0; x < W; x++) { let c = 0; for (let y = v0; y < v1; y++) c += ch[y * W + x]; cfm[x] = c / (v1 - v0) > 0.45 ? 1 : 0; }
  const rr = runs(cfm); if (!rr.length) fail('NOREGION');
  const merged = [rr[0].slice()];
  for (let i = 1; i < rr.length; i++) { const [a, b] = rr[i]; if (a - merged[merged.length - 1][1] < 30) merged[merged.length - 1][1] = b; else merged.push([a, b]); }
  const [c0, c1] = longest(merged);
  if (v1 - v0 < 80 || c1 - c0 < 40) fail('NOREGION');

  // temporal median frame (colour)
  const M = S.medFrames.length, med = new Uint8Array(W * H * 3), buf = new Float64Array(M);
  for (let i = 0; i < W * H * 3; i++) { for (let k = 0; k < M; k++) buf[k] = S.medFrames[k][i]; sortN(buf, M); med[i] = Math.floor(medianSorted(buf, M)); }
  const px = (y, x, c) => med[(y * W + x) * 3 + c];
  const hd = (y, x) => Math.abs(px(y, x + 1, 0) - px(y, x, 0)) + Math.abs(px(y, x + 1, 1) - px(y, x, 1)) + Math.abs(px(y, x + 1, 2) - px(y, x, 2));
  const vd = (y, x) => Math.abs(px(y + 1, x, 0) - px(y, x, 0)) + Math.abs(px(y + 1, x, 1) - px(y, x, 1)) + Math.abs(px(y + 1, x, 2) - px(y, x, 2));
  const dx = new Float64Array(W - 1);
  for (let x = 0; x < W - 1; x++) { let s = 0; for (let y = v0; y < v1; y++) s += hd(y, x); dx[x] = s / (v1 - v0); }
  const lo = Math.max(0, c0 - 40); let x0 = c0 > lo ? argmaxRange(dx, lo, c0) + 1 : c0;
  const hi = Math.min(W - 1, c1 + 40); let x1 = hi > c1 ? argmaxRange(dx, c1, hi) + 1 : c1;
  const dy = new Float64Array(H - 1), outside = new Float64Array(H - 1), side = new Uint8Array(H);
  const oL = Math.max(1, x0 - 4), oR = x1 + 4, nOut = oL + Math.max(0, W - oR);
  for (let y = 0; y < H - 1; y++) {
    let c = 0, n = 0; for (let x = x0 + 6; x < x1 - 6; x++) { c += vd(y, x) > 30 ? 1 : 0; n++; } dy[y] = n ? c / n : 0;
    let o = 0; for (let x = 0; x < oL; x++) o += vd(y, x) > 30 ? 1 : 0; for (let x = oR; x < W; x++) o += vd(y, x) > 30 ? 1 : 0; outside[y] = nOut ? o / nOut : 0;
  }
  for (let y = 0; y < H; y++) {
    let l = 0, r = 0;
    for (let x = Math.max(0, x0 - 3); x < Math.min(W - 1, x0 + 2); x++) l = Math.max(l, hd(y, x));
    for (let x = Math.max(0, x1 - 4); x < Math.min(W - 1, x1 + 1); x++) r = Math.max(r, hd(y, x));
    side[y] = (l > 40 && r > 40) ? 1 : 0;
  }
  const sideMean = (a, b) => { b = Math.min(H, b); if (b <= a) return NaN; let s = 0; for (let y = a; y < b; y++) s += side[y]; return s / (b - a); };
  const tops = [], bots = [];
  for (let y = 1; y < v0; y++) if (dy[y] > 0.95 && outside[y] < 0.6 && sideMean(y + 8, y + 40) > 0.9) tops.push(y);
  for (let y = v1; y < H - 2; y++) if (dy[y] > 0.95 && outside[y] < 0.6) bots.push(y);
  x0 = Math.max(0, x0 - 1); x1 = Math.min(W, x1 + 2);
  const y0 = tops.length ? tops[0] + 1 : 0, y1 = bots.length ? bots[bots.length - 1] + 1 : H;
  const cw = c0 + Math.floor((c1 - c0) * 0.92);
  S.L = { v0, v1, c0, c1, x0, x1, y0, y1, cw, vh: v1 - v0 };
  if (x1 - x0 < 60 || v0 - y0 < 0.08 * S.H || v1 - v0 > 0.8 * S.H) fail('NOREGION');   // the page always has a fixed header above the scrolling list

  // header reference (median of the sampled frames) + drop threshold for transitions/popups
  const hw = x1 - x0, hh = v0 - y0, hmed = new Float32Array(hw * hh), hb = new Float64Array(M);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = ((y0 + y) * W + x0 + x) * 3;
    for (let k = 0; k < M; k++) { const f = S.medFrames[k]; hb[k] = gray(f[i], f[i + 1], f[i + 2]); }
    sortN(hb, M); hmed[y * hw + x] = medianSorted(hb, M);
  }
  S.hmed = hmed;
  const hd0 = S.medFrames.map(f => { let s = 0; for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) { const i = ((y0 + y) * W + x0 + x) * 3; s += Math.abs(gray(f[i], f[i + 1], f[i + 2]) - hmed[y * hw + x]); } return hh * hw ? s / (hh * hw) : 0; });
  S.hthr = Math.max(6, 3 * median(hd0) + 3);
  S.medFrames = null;
  return S.L;
}

/* ---------- pass 1: scroll positions (online, anchor based, exhaustive SAD) ---------- */
function makeCrop(rgba, rw, rx, ry) {       // gray crop of viewport rows x content cols from the received rect
  const { v0, v1, c0, cw } = S.L, w = cw - c0, h = v1 - v0, g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let j = ((v0 - ry + y) * rw + (c0 - rx)) * 4; const o = y * w; for (let x = 0; x < w; x++, j += 4) g[o + x] = gray(rgba[j], rgba[j + 1], rgba[j + 2]); }
  return { g, w, h };
}
function sad(A, C, d, rs) {  // mean |A[r+d] - C[r]| (content row r of A appears at row r-d of C); cols step 2, rows step rs
  const n = A.h, w = A.w; let s = 0, c = 0;
  const r0 = d >= 0 ? d : 0, r1 = d >= 0 ? n : n + d;
  for (let r = r0; r < r1; r += rs) { const oa = r * w, oc = (r - d) * w; for (let x = 0; x < w; x += 2) s += Math.abs(A.g[oa + x] - C.g[oc + x]); c += (w + 1) >> 1; }
  return c ? s / c : Infinity;
}
function search(A, C, lo, hi) {   // like stitch.py sad_curve + best: exhaustive coarse pass (rows step 2), exact refine around the minimum
  const n = A.h, valid = d => Math.abs(d) <= n - 60;
  let cd = null, ce = Infinity;
  for (let d = lo; d <= hi; d++) if (valid(d)) { const e = sad(A, C, d, 2); if (e < ce) { ce = e; cd = d; } }
  if (cd === null) return null;
  const res = new Map();
  for (let d = cd - 2; d <= cd + 2; d++) if (d >= lo && d <= hi && valid(d)) res.set(d, sad(A, C, d, 1));
  let bd = null, be = Infinity; for (const d of [...res.keys()].sort((a, b) => a - b)) if (res.get(d) < be) { be = res.get(d); bd = d; }
  for (const d of [bd - 1, bd + 1]) if (d >= lo && d <= hi && valid(d) && !res.has(d)) res.set(d, sad(A, C, d, 1));
  if (res.has(bd - 1) && res.has(bd + 1)) { const l = res.get(bd - 1), r = res.get(bd + 1), den = l - 2 * be + r; if (den > 1e-6) return [bd + 0.5 * (l - r) / den, be]; }
  return [bd, be];
}
function p1(idx, rgba, rect) {
  const { y0, v0, x0, x1, vh } = S.L, W = rect.w;
  const hw = x1 - x0, hh = v0 - y0; let hs = 0;
  for (let y = 0; y < hh; y++) { let j = ((y0 - rect.y + y) * W + (x0 - rect.x)) * 4; for (let x = 0; x < hw; x++, j += 4) hs += Math.abs(gray(rgba[j], rgba[j + 1], rgba[j + 2]) - S.hmed[y * hw + x]); }
  const ok = hh * hw ? hs / (hh * hw) < S.hthr : true;
  S.pos[idx] = NaN; S.ok[idx] = 0;
  if (!ok) return;
  const C = makeCrop(rgba, W, rect.x, rect.y), T = S.track;
  if (!T.anc) { T.anc = C; T.ancPos = 0; T.prevPos = 0; T.vel = 0; S.pos[idx] = 0; S.ok[idx] = 1; return; }
  const R = Math.trunc(vh * 0.6), pred = T.prevPos + T.vel - T.ancPos;
  let r = search(T.anc, C, Math.trunc(Math.max(-R, pred - 40)), Math.trunc(Math.min(R, pred + 40)));
  if (!r || r[1] > 12) { const r2 = search(T.anc, C, -R, R); if (r2) r = r2; }
  if (!r) return;
  const pos = T.ancPos + r[0];
  S.pos[idx] = pos; S.ok[idx] = 1;
  T.vel = pos - T.prevPos; T.prevPos = pos;
  if (Math.abs(pos - T.ancPos) > vh * 0.3 || r[1] > 4) { T.anc = C; T.ancPos = pos; }
}

/* ---------- plan: frame selection + per-band median sources ---------- */
function plan() {
  const { vh } = S.L, n = S.n;
  const good = []; for (let i = 0; i < n; i++) if (S.ok[i] && !Number.isNaN(S.pos[i])) good.push(i);
  if (good.length < 2) fail('NOSCROLL', { px: 0 });
  let mn = Infinity, mx = -Infinity; for (const i of good) { mn = Math.min(mn, S.pos[i]); mx = Math.max(mx, S.pos[i]); }
  const p = new Float64Array(n).fill(NaN); for (const i of good) p[i] = S.pos[i] - mn;
  const scroll = mx - mn;
  if (scroll < Math.max(20, vh * 0.1)) fail('NOSCROLL', { px: Math.round(scroll) });
  const speed = new Float64Array(n);
  good.forEach((i, k) => { let m = 0; if (k > 0) m = Math.max(m, Math.abs(p[i] - p[good[k - 1]])); if (k < good.length - 1) m = Math.max(m, Math.abs(p[i] - p[good[k + 1]])); speed[i] = m; });
  const bySpeed = good.slice().sort((a, b) => speed[a] - speed[b]);   // stable
  const sel = [], inSel = new Uint8Array(n), seen = new Map();
  for (const i of bySpeed) {
    const key = roundHalfEven(p[i]);
    if (speed[i] > VMAX && sel.length > 0) continue;
    if ((seen.get(key) || 0) >= 1) continue;
    seen.set(key, (seen.get(key) || 0) + 1); sel.push(i); inSel[i] = 1;
  }
  let smax = 0; for (const i of sel) smax = Math.max(smax, p[i]);
  const total = Math.ceil(smax) + vh;
  const cov = new Int32Array(total);
  const addCov = s => { for (let y = Math.max(0, s); y < Math.min(total, s + vh); y++) cov[y]++; };
  for (const i of sel) addCov(Math.floor(p[i]));
  for (const i of bySpeed) {
    if (inSel[i]) continue; const s = Math.floor(p[i]); let need = false;
    for (let y = Math.max(0, s); y < Math.min(total, s + vh); y++) if (cov[y] < 3) { need = true; break; }
    if (need) { sel.push(i); inSel[i] = 1; addCov(s); }
  }
  let layers = sel.map(i => { const s = roundHalfEven(p[i]), fr = p[i] - s; return { f: i, s, fr, shift: Math.abs(fr) > 0.2, score: Math.abs(fr) * 10 + speed[i] * 0.2, pieces: [] }; });
  layers.sort((a, b) => a.score - b.score);
  layers.forEach((L, k) => { L.k = k; });
  const bands = [];
  for (let b0 = 0; b0 < total; b0 += BAND) {
    const b1 = Math.min(total, b0 + BAND), band = { b0, b1, pieces: [], fb: null }; let nfull = 0;
    const rowCov = new Uint8Array(b1 - b0);
    for (const L of layers) {
      const a = Math.max(b0, L.s + EDGE), bb = Math.min(b1, L.s + vh - EDGE);
      if (bb <= a) continue;
      const pc = { L, a, bb, data: null, mask: null }; band.pieces.push(pc); L.pieces.push(pc); band.last = L.k;
      for (let y = a; y < bb; y++) rowCov[y - b0] = 1;
      nfull += (bb - a === b1 - b0) ? 1 : 0; if (nfull >= K_MED) break;
    }
    if (rowCov.some(v => !v)) {           // rows no trimmed piece covers (canvas top/bottom): fall back to every layer, untrimmed
      band.fb = [];
      for (const L of layers) { const a = Math.max(b0, L.s), bb = Math.min(b1, L.s + vh); if (bb > a) { const pc = { L, a, bb, data: null }; band.fb.push(pc); L.pieces.push(pc); } }
    }
    bands.push(band);
  }
  let hf = good[0]; for (const i of good) if (p[i] < p[hf]) hf = i;
  let ff = good[0]; for (const i of good) if (p[i] > p[ff]) ff = i;
  Object.assign(S, { p, good, layers, bands, total, headerFrame: hf, footerFrame: ff, scroll });
  const need = new Set(layers.filter(L => L.pieces.length).map(L => L.f)); need.add(hf);
  return { frames: [...need].sort((a, b) => a - b), headerFrame: hf, scroll: Math.round(scroll), total, layers: layers.length };
}

/* ---------- strips ---------- */
function buildStrip(L, rgba, rect) {        // viewport rows x panel cols, RGB, sub-pixel aligned like cv2.warpAffine(ty=fr)
  const { v0, vh, x0, x1 } = S.L, w = x1 - x0, out = new Uint8Array(vh * w * 3), rw = rect.w;
  const row = y => ((v0 - rect.y + Math.min(vh - 1, Math.max(0, y))) * rw + (x0 - rect.x)) * 4;
  for (let y = 0; y < vh; y++) {
    const o = y * w * 3;
    if (!L.shift) { let j = row(y); for (let x = 0, k = o; x < w; x++, j += 4, k += 3) { out[k] = rgba[j]; out[k + 1] = rgba[j + 1]; out[k + 2] = rgba[j + 2]; } continue; }
    const ys = y - L.fr, yl = Math.floor(ys), t = Math.round((ys - yl) * 32) / 32;
    let ja = row(yl), jb = row(yl + 1);
    for (let x = 0, k = o; x < w; x++, ja += 4, jb += 4, k += 3) for (let c = 0; c < 3; c++) out[k + c] = Math.round(rgba[ja + c] * (1 - t) + rgba[jb + c] * t);
  }
  return out;
}
function p2(idx, rgba, rect) {
  const { v0, y0, x0, x1, vh } = S.L, w = x1 - x0;
  if (idx === S.headerFrame) {
    const hh = v0 - y0, hdr = new Uint8Array(hh * w * 3);
    for (let y = 0; y < hh; y++) { let j = ((y0 - rect.y + y) * rect.w + (x0 - rect.x)) * 4; for (let x = 0, k = y * w * 3; x < w; x++, j += 4, k += 3) { hdr[k] = rgba[j]; hdr[k + 1] = rgba[j + 1]; hdr[k + 2] = rgba[j + 2]; } }
    S.header = hdr;
  }
  for (const L of S.layers) {
    if (L.f !== idx || !L.pieces.length) continue;
    const st = buildStrip(L, rgba, rect);
    for (const pc of L.pieces) pc.data = st.slice((pc.a - L.s) * w * 3, (pc.bb - L.s) * w * 3);
  }
}

/* ---------- median compose ---------- */
function compose(useMask) {
  const w = S.L.x1 - S.L.x0, total = S.total, canvas = new Uint8Array(total * w * 3);
  const vals = new Float64Array(4096);
  let prevRowOk = false;
  for (const band of S.bands) {
    for (let y = band.b0; y < band.b1; y++) {
      const act = band.pieces.filter(pc => pc.data && y >= pc.a && y < pc.bb);
      const fb = band.fb ? band.fb.filter(pc => pc.data && y >= pc.a && y < pc.bb) : [];
      const ext = band.extra ? band.extra.filter(pc => pc.data && y >= pc.a && y < pc.bb) : [];
      let rowHas = false;
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let n = 0;
          for (const pc of act) { const r = y - pc.a; if (useMask && pc.mask && pc.mask[r * w + x]) continue; vals[n++] = pc.data[(r * w + x) * 3 + c]; }
          if (useMask && n < K_MED && ext.length) for (const pc of ext) { if (n >= K_MED) break; const r = y - pc.a; if (pc.mask && pc.mask[r * w + x]) continue; vals[n++] = pc.data[(r * w + x) * 3 + c]; }
          if (!n) for (const pc of (fb.length ? fb : act)) { const r = y - pc.a; vals[n++] = pc.data[(r * w + x) * 3 + c]; }
          if (!n) continue;
          sortN(vals, n); canvas[(y * w + x) * 3 + c] = Math.floor(medianSorted(vals, n)); rowHas = true;
        }
      }
      if (!rowHas && y > 0) canvas.copyWithin(y * w * 3, (y - 1) * w * 3, y * w * 3);
    }
  }
  return canvas;
}

/* ---------- pointer (mouse cursor) learning + masking ---------- */
function blur5(src, h, w) {   // cv2.GaussianBlur(ksize=5, sigma=0) on RGB uint8, BORDER_REFLECT_101
  const k = [1, 4, 6, 4, 1], tmp = new Float32Array(h * w * 3), out = new Uint8Array(h * w * 3);
  const rx = x => x < 0 ? -x : x >= w ? 2 * w - 2 - x : x, ry = y => y < 0 ? -y : y >= h ? 2 * h - 2 - y : y;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let i = -2; i <= 2; i++) s += k[i + 2] * src[(y * w + rx(x + i)) * 3 + c]; tmp[(y * w + x) * 3 + c] = s / 16; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let i = -2; i <= 2; i++) s += k[i + 2] * tmp[(ry(y + i) * w + x) * 3 + c]; out[(y * w + x) * 3 + c] = Math.round(s / 16); }
  return out;
}
function morph(m, h, w, dil, r) {  // square (2r+1) dilate / erode on 0/1 mask, cv2 default borders
  const t = new Uint8Array(h * w), o = new Uint8Array(h * w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = dil ? 0 : 1; for (let i = -r; i <= r; i++) { const xx = x + i; if (xx < 0 || xx >= w) continue; const q = m[y * w + xx]; v = dil ? (v | q) : (v & q); } t[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = dil ? 0 : 1; for (let i = -r; i <= r; i++) { const yy = y + i; if (yy < 0 || yy >= h) continue; const q = t[yy * w + x]; v = dil ? (v | q) : (v & q); } o[y * w + x] = v; }
  return o;
}
function components(m, h, w) {     // 8-connected components -> stats
  const lab = new Int32Array(h * w), stats = [], stack = [];
  let n = 0;
  for (let i = 0; i < h * w; i++) {
    if (!m[i] || lab[i]) continue;
    n++; let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0; stack.push(i); lab[i] = n;
    while (stack.length) {
      const j = stack.pop(), y = (j / w) | 0, x = j - y * w; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue; const q = yy * w + xx; if (m[q] && !lab[q]) { lab[q] = n; stack.push(q); } }
    }
    stats.push({ id: n, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return { lab, stats };
}
function p3start() {
  const w = S.L.x1 - S.L.x0;
  S.canvas1 = compose(false);
  S.cblur = blur5(S.canvas1, S.total, w);
  S.cands = [];
  S.res = new Float64Array(w); S.resN = 0;
  S.sbFrom = Math.floor(w * 0.85);
  S.hist = new Uint32Array((w - S.sbFrom) * 3 * 256); S.histN = 0;
  S.resStep = Math.max(1, Math.floor(S.layers.length / 60));
  return { frames: [...new Set(S.layers.map(L => L.f))].sort((a, b) => a - b) };
}
function p3(idx, rgba, rect) {
  const { vh, x0, x1 } = S.L, w = x1 - x0;
  S.layers.forEach((L, k) => {
    if (L.f !== idx) return;
    const st = buildStrip(L, rgba, rect), base = L.s * w * 3;
    // scrollbar residual (sampled layers, best-first order like stitch.py) + track colour histogram (all layers)
    if (k % S.resStep === 0) {
      for (let y = 0; y < vh; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(st[i + c] - S.canvas1[base + i + c])); S.res[x] += m / vh; }
      S.resN++;
    }
    const hw = w - S.sbFrom;
    for (let y = 0; y < vh; y++) for (let x = S.sbFrom; x < w; x++) { const i = (y * w + x) * 3; for (let c = 0; c < 3; c++) S.hist[((x - S.sbFrom) * 3 + c) * 256 + st[i + c]]++; }
    S.histN += vh;
    // pointer candidates: compact blobs that differ from the consensus
    const sb = blur5(st, vh, w), m = new Uint8Array(vh * w);
    for (let i = 0; i < vh * w; i++) { let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(sb[i * 3 + c] - S.cblur[base + i * 3 + c])); m[i] = d > 50 ? 1 : 0; }
    const closed = morph(morph(m, vh, w, true, 1), vh, w, false, 1);
    const { lab, stats } = components(closed, vh, w);
    for (const s of stats) {
      if (s.area >= 100 && s.area <= 1500 && s.w >= 12 && s.w <= 50 && s.h >= 12 && s.h <= 60 && s.area > 0.3 * s.w * s.h && s.y > 2 && s.y + s.h < vh - 2 && s.x > 2 && s.x + s.w < w - 2) {
        const tpl = new Uint8Array(s.w * s.h * 3), mk = new Uint8Array(s.w * s.h);
        for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const si = ((s.y + y) * w + s.x + x); for (let c = 0; c < 3; c++) tpl[(y * s.w + x) * 3 + c] = st[si * 3 + c]; mk[y * s.w + x] = lab[si] === s.id ? 1 : 0; }
        S.cands.push({ area: s.area, w: s.w, h: s.h, tpl, mk });
      }
    }
  });
}
function learnCursor() {
  const c = S.cands; S.cands = null;
  if (c.length < 5) return null;
  const votes = c.map(a => c.filter(b => Math.abs(b.w - a.w) <= 3 && Math.abs(b.h - a.h) <= 3).length);
  const top = Math.max(...votes); if (top < 5) return null;
  const cl = c.filter((_, i) => votes[i] === top).sort((a, b) => a.area - b.area);
  const pick = cl[cl.length >> 1];
  const v = []; for (let i = 0; i < pick.w * pick.h; i++) if (pick.mk[i]) for (let k = 0; k < 3; k++) v.push(pick.tpl[i * 3 + k]);
  const mean = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  if (sd < 20) return null;
  const m = morph(pick.mk, pick.h, pick.w, true, 1);
  const P = 5, bw = pick.w + 2 * P, bh = pick.h + 2 * P, pm = new Uint8Array(bw * bh);   // big mask may reach P px outside the template box
  for (let y = 0; y < pick.h; y++) for (let x = 0; x < pick.w; x++) pm[(y + P) * bw + x + P] = m[y * pick.w + x];
  return { t: pick.tpl, m, w: pick.w, h: pick.h, big: morph(pm, bh, bw, true, P), bw, bh, P };
}
function p3done() {
  const w = S.L.x1 - S.L.x0;
  S.tpl = learnCursor();
  // scrollbar columns
  const res = Array.from(S.res, v => v / Math.max(1, S.resN)), mres = median(res);
  const sb = res.map((r, x) => r > 2.5 * mres + 2 && x > w * 0.85);
  S.sb = null;
  if (sb.some(Boolean)) {
    let lo = sb.indexOf(true), hi = sb.lastIndexOf(true); lo = Math.max(0, lo - 1); hi = Math.min(w - 1, hi + 1);
    if (lo >= S.sbFrom) {
      const track = new Uint8Array((hi - lo + 1) * 3);
      for (let x = lo; x <= hi; x++) for (let c = 0; c < 3; c++) {
        const h = S.hist.subarray(((x - S.sbFrom) * 3 + c) * 256, ((x - S.sbFrom) * 3 + c + 1) * 256), N = S.histN;
        const kth = k => { let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc > k) return v; } return 255; };
        track[(x - lo) * 3 + c] = Math.floor(N % 2 ? kth((N - 1) / 2) : (kth(N / 2 - 1) + kth(N / 2)) / 2);
      }
      S.sb = { lo, hi, track };
    }
  }
  S.hist = null; S.cblur = null;
  if (!S.tpl) return { frames: [] };
  return { frames: [...new Set(S.layers.filter(L => L.pieces.some(pc => 'mask' in pc)).map(L => L.f))].sort((a, b) => a - b) };
}
function matchCursor(st, h, w) {   // TM_SQDIFF_NORMED with mask; coarse (1/4) search then full-res refine
  const T = S.tpl, th = T.h, tw = T.w;
  if (h < th || w < tw) return null;
  const score = (ox, oy) => { let num = 0, tt = 0, ii = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { if (!T.m[y * tw + x]) continue; const ti = (y * tw + x) * 3, si = ((oy + y) * w + ox + x) * 3;
      for (let c = 0; c < 3; c++) { const a = T.t[ti + c], b = st[si + c]; num += (a - b) * (a - b); tt += a * a; ii += b * b; } }
    const den = Math.sqrt(tt * ii); return den > 0 ? num / den : 1; };
  const F = 4, hw = Math.floor(w / F), hh = Math.floor(h / F), tw4 = Math.floor(tw / F), th4 = Math.floor(th / F);
  let best = [];
  if (tw4 >= 3 && th4 >= 3) {
    const sd = new Float32Array(hw * hh * 3); for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let j = 0; j < F; j++) for (let i = 0; i < F; i++) s += st[((y * F + j) * w + x * F + i) * 3 + c]; sd[(y * hw + x) * 3 + c] = s / (F * F); }
    const td = new Float32Array(tw4 * th4 * 3), md = new Float32Array(tw4 * th4);
    for (let y = 0; y < th4; y++) for (let x = 0; x < tw4; x++) { let mm = 0; const acc = [0, 0, 0]; for (let j = 0; j < F; j++) for (let i = 0; i < F; i++) { const q = (y * F + j) * tw + x * F + i; mm += T.m[q]; for (let c = 0; c < 3; c++) acc[c] += T.t[q * 3 + c]; } md[y * tw4 + x] = mm / (F * F); for (let c = 0; c < 3; c++) td[(y * tw4 + x) * 3 + c] = acc[c] / (F * F); }
    const cand = [];
    for (let oy = 0; oy <= hh - th4; oy++) for (let ox = 0; ox <= hw - tw4; ox++) {
      let num = 0, tt = 0, ii = 0;
      for (let y = 0; y < th4; y++) for (let x = 0; x < tw4; x++) { const mw = md[y * tw4 + x]; if (!mw) continue; const ti = (y * tw4 + x) * 3, si = ((oy + y) * hw + ox + x) * 3;
        for (let c = 0; c < 3; c++) { const a = td[ti + c], b = sd[si + c]; num += mw * (a - b) * (a - b); tt += mw * a * a; ii += mw * b * b; } }
      const den = Math.sqrt(tt * ii); cand.push([den > 0 ? num / den : 1, ox * F, oy * F]);
    }
    cand.sort((a, b) => a[0] - b[0]); best = cand.slice(0, 6);
  } else best = [[0, 0, 0]];
  let bs = Infinity, bx = 0, by = 0;
  for (const [, cx, cy] of best) for (let oy = Math.max(0, cy - 6); oy <= Math.min(h - th, cy + 6); oy++) for (let ox = Math.max(0, cx - 6); ox <= Math.min(w - tw, cx + 6); ox++) { const s = score(ox, oy); if (s < bs) { bs = s; bx = ox; by = oy; } }
  return bs < 0.07 ? { x: bx, y: by } : null;
}
function markCursor(pc, L, hit, w) {
  const T = S.tpl;
  for (let y = 0; y < T.bh; y++) { const cy = L.s + hit.y + y - T.P; if (cy < pc.a || cy >= pc.bb) continue;
    for (let x = 0; x < T.bw; x++) { const cx = hit.x + x - T.P; if (cx < 0 || cx >= w || !T.big[y * T.bw + x]) continue;
      (pc.mask = pc.mask || new Uint8Array((pc.bb - pc.a) * w))[(cy - pc.a) * w + cx] = 1; } }
}
function p4(idx, rgba, rect) {
  const { vh, x0, x1 } = S.L, w = x1 - x0, T = S.tpl;
  for (const L of S.layers) {
    if (L.f !== idx) continue;
    const st = buildStrip(L, rgba, rect), hit = matchCursor(st, vh, w);
    if (!hit) continue;
    for (const pc of L.pieces) {
      if (!('mask' in pc) || pc.extra) continue;          // fallback pieces are never masked
      markCursor(pc, L, hit, w);
    }
    S.cursorHits = (S.cursorHits || 0) + 1;
  }
}
function p5plan() {   // pixels that lost too many samples to the pointer mask get topped up from the next-best layers
  if (!S.tpl) return { frames: [] };
  const w = S.L.x1 - S.L.x0, vh = S.L.vh, need = new Set();
  for (const band of S.bands) {
    if (!band.pieces.some(pc => pc.mask)) continue;
    let short = false;
    for (let y = band.b0; y < band.b1 && !short; y++) {
      const act = band.pieces.filter(pc => y >= pc.a && y < pc.bb);
      for (let x = 0; x < w; x++) { let n = 0; for (const pc of act) if (!(pc.mask && pc.mask[(y - pc.a) * w + x])) n++; if (n < K_MED) { short = true; break; } }
    }
    if (!short) continue;
    band.extra = [];
    for (let k = (band.last === undefined ? -1 : band.last) + 1; k < S.layers.length && band.extra.length < 24; k++) {
      const L = S.layers[k], a = Math.max(band.b0, L.s + EDGE), bb = Math.min(band.b1, L.s + vh - EDGE);
      if (bb <= a) continue;
      const pc = { L, a, bb, data: null, mask: null, extra: true }; band.extra.push(pc); L.pieces.push(pc); need.add(L.f);
    }
  }
  return { frames: [...need].sort((a, b) => a - b) };
}
function p5(idx, rgba, rect) {
  const { vh, x0, x1 } = S.L, w = x1 - x0, T = S.tpl;
  for (const L of S.layers) {
    if (L.f !== idx || !L.pieces.some(pc => pc.extra)) continue;
    const st = buildStrip(L, rgba, rect), hit = matchCursor(st, vh, w);
    for (const pc of L.pieces) {
      if (!pc.extra) continue;
      pc.data = st.slice((pc.a - L.s) * w * 3, (pc.bb - L.s) * w * 3);
      if (hit) markCursor(pc, L, hit, w);
    }
  }
}
function finish() {
  const { x0, x1, v0, y0 } = S.L, w = x1 - x0, hh = v0 - y0;
  const canvas = S.tpl ? compose(true) : S.canvas1;
  if (S.sb) { const { lo, hi, track } = S.sb; for (let y = 0; y < S.total; y++) for (let x = lo; x <= hi; x++) for (let c = 0; c < 3; c++) canvas[(y * w + x) * 3 + c] = track[(x - lo) * 3 + c]; }
  const H = hh + S.total, out = new Uint8ClampedArray(w * H * 4);
  const put = (src, rows, off) => { for (let i = 0; i < rows * w; i++) { const o = (off * w + i) * 4; out[o] = src[i * 3]; out[o + 1] = src[i * 3 + 1]; out[o + 2] = src[i * 3 + 2]; out[o + 3] = 255; } };
  put(S.header, hh, 0); put(canvas, S.total, hh);
  const info = { w, h: H, layout: S.L, scroll: Math.round(S.scroll), layers: S.layers.length, cursor: !!S.tpl, cursorHits: S.cursorHits || 0, tpl: S.tpl ? [S.tpl.w, S.tpl.h, S.tpl.m.reduce((a, b) => a + b, 0)] : null, scrollbar: S.sb ? [x0 + S.sb.lo, x0 + S.sb.hi] : null, frames: S.n, used: S.good.length };
  S = null;
  postMessage({ type: 'result', w, h: H, data: out.buffer, info }, [out.buffer]);
}

onmessage = e => {
  const m = e.data;
  try {
    let reply = {};
    switch (m.type) {
      case 'init': S = { W: m.W, H: m.H, n: m.n, pos: new Float64Array(m.n).fill(NaN), ok: new Uint8Array(m.n), track: {} }; break;
      case 'p0': { const d = new Uint8ClampedArray(m.data); if (m.std) p0std(d); if (m.med) p0med(d); break; }
      case 'layout': reply = { L: detectLayout() }; break;
      case 'p1': p1(m.idx, new Uint8ClampedArray(m.data), m.rect); break;
      case 'plan': reply = plan(); break;
      case 'p2': p2(m.idx, new Uint8ClampedArray(m.data), m.rect); break;
      case 'p3start': reply = p3start(); break;
      case 'p3': p3(m.idx, new Uint8ClampedArray(m.data), m.rect); break;
      case 'p3done': reply = p3done(); break;
      case 'p4': p4(m.idx, new Uint8ClampedArray(m.data), m.rect); break;
      case 'p5plan': reply = p5plan(); break;
      case 'p5': p5(m.idx, new Uint8ClampedArray(m.data), m.rect); break;
      case 'finish': finish(); return;
      case 'probe': { const w = S.L.x1 - S.L.x0, out = []; m.y -= S.L.v0 - S.L.y0; for (const b of S.bands) if (m.y >= b.b0 && m.y < b.b1) { for (const [nm, arr] of [['p', b.pieces], ['x', b.extra || []], ['f', b.fb || []]]) for (const pc of arr) if (m.y >= pc.a && m.y < pc.bb && pc.data) { const r = m.y - pc.a, i = (r * w + m.x) * 3; out.push([nm, pc.L.f, pc.L.s, +pc.L.fr.toFixed(2), pc.data[i], pc.data[i + 1], pc.data[i + 2], pc.mask ? pc.mask[r * w + m.x] : 0]); } } postMessage({ type: 'probe', out, tpl: S.tpl && [S.tpl.w, S.tpl.h] }); return; }
      case 'dump': postMessage({ type: 'dump', pos: Array.from(S.pos), ok: Array.from(S.ok) }); return;
    }
    postMessage({ type: 'ack', id: m.id, ...reply });
  } catch (err) {
    postMessage({ type: 'error', id: m.id, code: err.code || (err instanceof RangeError ? 'MEMORY' : 'FAIL'), detail: err.detail || {}, message: String(err && err.message || err) });
  }
};
