/*
 * Turning a picture into a black-and-white puzzle grid.
 * Everything runs locally in the browser; the picture never leaves the page.
 */
(function (global) {
  'use strict';

  /** Load a File/Blob into an <img>. Resolves with { img, url }. */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || '')) { reject(new Error('That file is not a picture.')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The picture could not be read.')); };
      img.src = url;
    });
  }

  /** Draw the image (on white, so transparency counts as background) and return darkness 0..1 per pixel. */
  function darknessMap(img, sx, sy, sw, sh, W, H) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const lum = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      out[i] = 1 - lum / 255;
    }
    return out;
  }

  /**
   * Find the part of the picture that is not plain border.
   * Returns a crop rectangle in image pixels.
   */
  function trimBounds(img) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.min(1, 256 / Math.max(iw, ih));
    const W = Math.max(1, Math.round(iw * scale)), H = Math.max(1, Math.round(ih * scale));
    const dark = darknessMap(img, 0, 0, iw, ih, W, H);
    // background = median darkness of the outer edge
    const edge = [];
    for (let x = 0; x < W; x++) edge.push(dark[x], dark[(H - 1) * W + x]);
    for (let y = 0; y < H; y++) edge.push(dark[y * W], dark[y * W + W - 1]);
    edge.sort((a, b) => a - b);
    const bg = edge[edge.length >> 1];
    const differs = v => Math.abs(v - bg) > 0.12;
    let top = H, bottom = -1, left = W, right = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!differs(dark[y * W + x])) continue;
      if (y < top) top = y; if (y > bottom) bottom = y;
      if (x < left) left = x; if (x > right) right = x;
    }
    if (bottom < 0) return { x: 0, y: 0, w: iw, h: ih };
    return {
      x: left / scale, y: top / scale,
      w: Math.min(iw, (right - left + 1) / scale), h: Math.min(ih, (bottom - top + 1) / scale),
    };
  }

  /** Average darkness per puzzle square (w x h) for the crop rectangle. */
  function sampleGrid(img, crop, w, h) {
    const S = Math.max(1, Math.min(8, Math.floor(2000 / Math.max(w, h))));
    const W = w * S, H = h * S;
    const dark = darknessMap(img, crop.x, crop.y, crop.w, crop.h, W, H);
    const out = [];
    for (let r = 0; r < h; r++) {
      const row = [];
      for (let c = 0; c < w; c++) {
        let sum = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) sum += dark[(r * S + y) * W + c * S + x];
        row.push(sum / (S * S));
      }
      out.push(row);
    }
    return out;
  }

  /** Otsu's method: the threshold that best separates dark from light values. */
  function otsu(values) {
    const bins = 64, hist = new Array(bins).fill(0);
    values.forEach(v => hist[Math.min(bins - 1, Math.floor(v * bins))]++);
    const total = values.length;
    let sumAll = 0;
    hist.forEach((n, i) => { sumAll += i * n; });
    // when several cut points score the same (an empty gap between dark and light), use the middle of the gap
    let sumB = 0, wB = 0, best = -1, from = bins / 2, to = bins / 2;
    for (let t = 0; t < bins; t++) {
      wB += hist[t];
      sumB += t * hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best * (1 + 1e-9)) { best = between; from = to = t + 1; }
      else if (between >= best * (1 - 1e-9)) to = t + 1;
    }
    return Math.min(0.95, Math.max(0.05, (from + to) / 2 / bins));
  }

  /** Threshold the darkness grid into 0/1, optionally inverted and cleaned of stray squares. */
  function toGrid(dark, threshold, invert, clean) {
    const h = dark.length, w = dark[0].length;
    let g = dark.map(row => row.map(v => ((v >= threshold) !== !!invert ? 1 : 0)));
    if (clean) {
      const at = (r, c) => (r >= 0 && r < h && c >= 0 && c < w ? g[r][c] : 0);
      g = g.map((row, r) => row.map((v, c) => {
        const n = at(r - 1, c) + at(r + 1, c) + at(r, c - 1) + at(r, c + 1);
        const diag = at(r - 1, c - 1) + at(r - 1, c + 1) + at(r + 1, c - 1) + at(r + 1, c + 1);
        if (v && n === 0 && diag === 0) return 0;          // lone filled square
        if (!v && n === 4) return 1;                        // pinhole
        return v;
      }));
    }
    return g;
  }

  global.NonogramImage = { loadImage, trimBounds, sampleGrid, otsu, toGrid };
})(typeof window !== 'undefined' ? window : globalThis);
