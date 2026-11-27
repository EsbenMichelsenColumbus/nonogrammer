/*
 * Board view shared by the game and the editor: draws clues and squares,
 * handles click-and-drag strokes (locked to one row or column) and sizing.
 */
(function (global) {
  'use strict';

  const { FILLED, EMPTY } = global.NonogramSolver;

  /**
   * @param {HTMLElement} el      board element
   * @param {HTMLElement} wrap    scrolling container used for sizing
   * @param {object} opts
   *   onStrokeStart(r, c, button) -> { visit(r, c) } | null
   *   onStrokeEnd(stroke)
   *   crosshair() -> boolean
   */
  function createBoard(el, wrap, opts) {
    let h = 0, w = 0, cells = [], rowClues = [], colClues = [], clues = null;
    let stroke = null;

    function build(clueSet, height, width) {
      h = height; w = width; clues = clueSet;
      manualSize = null; crossEls = []; crossAt = { r: -1, c: -1 };
      el.innerHTML = '';
      el.classList.toggle('big', Math.max(h, w) > 30);
      el.style.setProperty('--w', w);
      el.classList.remove('solved');
      cells = []; rowClues = []; colClues = [];
      const frag = document.createDocumentFragment();
      const corner = document.createElement('div');
      corner.className = 'corner';
      frag.appendChild(corner);
      for (let c = 0; c < w; c++) {
        const d = document.createElement('div');
        d.className = 'clue col' + (Math.floor(c / 5) % 2 ? ' alt' : '');
        colClues.push(d);
        frag.appendChild(d);
      }
      for (let r = 0; r < h; r++) {
        const rc = document.createElement('div');
        rc.className = 'clue row' + (Math.floor(r / 5) % 2 ? ' alt' : '');
        rowClues.push(rc);
        frag.appendChild(rc);
        const row = [];
        for (let c = 0; c < w; c++) {
          const d = document.createElement('div');
          let cls = 'cell';
          if (c === 0) cls += ' first-col';
          if (r === 0) cls += ' first-row';
          if (c === w - 1) cls += ' last-col';
          else if ((c + 1) % 5 === 0) cls += ' b5r';
          if (r === h - 1) cls += ' last-row';
          else if ((r + 1) % 5 === 0) cls += ' b5b';
          d.className = cls;
          d.dataset.r = r; d.dataset.c = c;
          row.push(d);
          frag.appendChild(d);
        }
        cells.push(row);
      }
      el.appendChild(frag);
      setClues(clueSet);
      fit();
    }

    function setClues(clueSet) {
      clues = clueSet;
      const fill = (node, list) => {
        node.innerHTML = '';
        (list.length ? list : [0]).forEach(n => {
          const s = document.createElement('span');
          s.textContent = n;
          node.appendChild(s);
        });
      };
      clueSet.rows.forEach((l, r) => fill(rowClues[r], l));
      clueSet.cols.forEach((l, c) => fill(colClues[c], l));
    }

    /** Replace the clue of one row or column (cheaper than setClues on big boards). */
    function setLineClue(type, idx, list) {
      const node = (type === 'row' ? rowClues : colClues)[idx];
      if (!node) return;
      (type === 'row' ? clues.rows : clues.cols)[idx] = list;
      node.innerHTML = '';
      (list.length ? list : [0]).forEach(n => {
        const s = document.createElement('span');
        s.textContent = n;
        node.appendChild(s);
      });
    }

    function setCell(r, c, v) {
      const d = cells[r][c];
      d.classList.toggle('f', v === FILLED);
      d.classList.toggle('x', v === EMPTY);
    }

    function renderGrid(grid) {
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) setCell(r, c, grid[r][c]);
    }

    /** done: one boolean per clue number, or a single boolean for the whole line. */
    function setClueDone(type, idx, done) {
      const node = (type === 'row' ? rowClues : colClues)[idx];
      const spans = node.children;
      const list = Array.isArray(done) ? done : Array.from(spans, () => done);
      for (let i = 0; i < spans.length; i++) spans[i].classList.toggle('done', !!list[i]);
      node.classList.toggle('done', list.length > 0 && list.every(Boolean));
    }

    function lineEls(type, idx) {
      const out = [type === 'row' ? rowClues[idx] : colClues[idx]];
      if (type === 'row') for (let c = 0; c < w; c++) out.push(cells[idx][c]);
      else for (let r = 0; r < h; r++) out.push(cells[r][idx]);
      return out;
    }

    function clearClass(...names) {
      names.forEach(n => el.querySelectorAll('.' + n).forEach(x => x.classList.remove(n)));
    }

    function cellEl(r, c) { return cells[r] && cells[r][c]; }

    // ---------------------------------------------------------------- sizing & zoom
    // Square sizes the zoom buttons step through
    const ZOOM_STEPS = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44];
    let manualSize = null; // null = fit to the screen
    let cellSize = 28;

    /** Square size that fits the frame. `whole`: allow small squares so the whole board shows. */
    function fitSize(whole) {
      const maxRow = Math.max(1, ...clues.rows.map(l => l.length || 1));
      const maxCol = Math.max(1, ...clues.cols.map(l => l.length || 1));
      const style = getComputedStyle(wrap);
      const bs = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight) + 4;
      const availW = wrap.clientWidth - padX;
      let size = availW / (w + maxRow * 0.78 + 0.4);
      if (window.innerWidth > 860) {
        const top = wrap.getBoundingClientRect().top + window.scrollY;
        const availH = window.innerHeight - Math.min(top, 140) - 60;
        size = Math.min(size, availH / (h + maxCol * 0.62 + 0.3));
      }
      // small puzzles stay finger-sized (the page scrolls instead); big ones may shrink further
      const min = whole || Math.max(h, w) > 30 ? 6 : 14;
      return Math.max(min, Math.min(36, Math.floor(size)));
    }

    function applySize(size, anchor) {
      // keep the point under `anchor` (client coordinates) in place while zooming
      const rect = wrap.getBoundingClientRect();
      const ax = anchor ? anchor.x - rect.left : wrap.clientWidth / 2;
      const ay = anchor ? anchor.y - rect.top : wrap.clientHeight / 2;
      const fx = (wrap.scrollLeft + ax) / Math.max(1, wrap.scrollWidth);
      const fy = (wrap.scrollTop + ay) / Math.max(1, wrap.scrollHeight);
      cellSize = size;
      el.style.setProperty('--cell', size + 'px');
      el.classList.toggle('tiny', size < 12);
      wrap.scrollLeft = fx * wrap.scrollWidth - ax;
      wrap.scrollTop = fy * wrap.scrollHeight - ay;
      if (opts.onZoom) opts.onZoom(size, manualSize == null);
    }

    /**
     * On wide screens, let the board frame end just above the bottom of the window,
     * so its scrollbars are visible without scrolling the page.
     */
    function sizeFrame() {
      if (window.innerWidth <= 860) { wrap.style.maxHeight = ''; return; }
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      wrap.style.maxHeight = Math.max(240, Math.floor(window.innerHeight - top - 16)) + 'px';
    }

    function fit() {
      if (!h) return;
      sizeFrame();
      applySize(manualSize == null ? fitSize() : manualSize);
    }

    function zoom(dir, anchor) {
      if (!h) return;
      // the Fit button shows the whole board, even if the squares get small
      if (dir === 'fit') { manualSize = fitSize(true); applySize(manualSize); return; }
      const next = dir > 0 ? ZOOM_STEPS.find(s => s > cellSize) : [...ZOOM_STEPS].reverse().find(s => s < cellSize);
      if (next == null) return;
      manualSize = next;
      applySize(next, anchor);
    }

    // Ctrl + mouse wheel (and trackpad pinch, which browsers report the same way) zooms
    wrap.addEventListener('wheel', e => {
      if (!e.ctrlKey || !h) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
    }, { passive: false });

    if (opts.zoomBar) {
      opts.zoomBar.addEventListener('click', e => {
        const b = e.target.closest('[data-zoom]');
        if (!b) return;
        const d = b.dataset.zoom;
        zoom(d === 'fit' ? 'fit' : d === 'in' ? 1 : -1);
      });
    }

    // ---------------------------------------------------------------- input
    function cellFromPoint(x, y) {
      const t = document.elementFromPoint(x, y);
      const d = t && t.closest && t.closest('.cell');
      if (!d || !el.contains(d)) return null;
      return { r: +d.dataset.r, c: +d.dataset.c };
    }

    el.addEventListener('contextmenu', e => e.preventDefault());

    // ----- touch: one finger draws, two fingers pan and pinch-zoom
    const touches = new Map(); // pointerId -> {x, y}
    let gesture = null;
    const midDist = () => {
      const [a, b] = [...touches.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    function startGesture() {
      // a second finger: undo what the first finger just drew and switch to pan/zoom
      if (stroke) {
        const s = stroke;
        stroke = null;
        if (s.impl.cancel) s.impl.cancel(); else opts.onStrokeEnd(s.impl);
      }
      const m = midDist();
      gesture = { x: m.x, y: m.y, d: m.d, size: cellSize, raf: 0 };
    }
    function moveGesture() {
      if (gesture.raf) return;
      gesture.raf = requestAnimationFrame(() => {
        gesture.raf = 0;
        if (!gesture || touches.size < 2) return;
        const m = midDist();
        wrap.scrollLeft -= m.x - gesture.x;
        wrap.scrollTop -= m.y - gesture.y;
        gesture.x = m.x; gesture.y = m.y;
        const size = Math.round(Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], gesture.size * m.d / gesture.d)));
        if (size !== cellSize) { manualSize = size; applySize(size, m); }
      });
    }
    el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      if (touches.size === 2) startGesture();
    }, true);
    el.addEventListener('pointermove', e => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture) moveGesture();
    }, true);
    const touchUp = e => {
      if (!touches.delete(e.pointerId)) return;
      if (gesture && touches.size === 0) gesture = null;
    };
    ['pointerup', 'pointercancel'].forEach(t => el.addEventListener(t, touchUp, true));

    el.addEventListener('pointerdown', e => {
      const d = e.target.closest('.cell');
      if (!d || stroke || gesture) return;
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      const r = +d.dataset.r, c = +d.dataset.c;
      const s = opts.onStrokeStart(r, c, e.button);
      if (!s) return;
      stroke = { impl: s, r0: r, c0: c, axis: null, last: { r, c }, pointerId: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      s.visit(r, c);
    });

    el.addEventListener('pointermove', e => {
      if (gesture) return;
      if (stroke && e.pointerId === stroke.pointerId) {
        const p = cellFromPoint(e.clientX, e.clientY);
        if (!p) return;
        if (p.r === stroke.last.r && p.c === stroke.last.c) return;
        if (!stroke.axis) {
          if (p.r === stroke.r0 && p.c === stroke.c0) return;
          const dr = Math.abs(p.r - stroke.r0), dc = Math.abs(p.c - stroke.c0);
          stroke.axis = dc >= dr ? 'row' : 'col';
        }
        const tr = stroke.axis === 'row' ? stroke.r0 : p.r;
        const tc = stroke.axis === 'row' ? p.c : stroke.c0;
        // visit every square between the start and the pointer
        if (stroke.axis === 'row') {
          const step = tc >= stroke.c0 ? 1 : -1;
          for (let c = stroke.c0; c !== tc + step; c += step) stroke.impl.visit(tr, c);
        } else {
          const step = tr >= stroke.r0 ? 1 : -1;
          for (let r = stroke.r0; r !== tr + step; r += step) stroke.impl.visit(r, tc);
        }
        stroke.last = p;
        updateCross(tr, tc);
      } else if (e.pointerType === 'mouse') {
        const p = cellFromPoint(e.clientX, e.clientY);
        if (p) updateCross(p.r, p.c); else updateCross(-1, -1);
      }
    });

    const endStroke = e => {
      if (!stroke || (e && e.pointerId !== stroke.pointerId)) return;
      const s = stroke;
      stroke = null;
      opts.onStrokeEnd(s.impl);
    };
    el.addEventListener('pointerup', endStroke);
    el.addEventListener('pointercancel', endStroke);
    el.addEventListener('lostpointercapture', endStroke);
    el.addEventListener('pointerleave', e => { if (!stroke && e.pointerType === 'mouse') updateCross(-1, -1); });

    let crossAt = { r: -1, c: -1 };
    let crossEls = [];
    function updateCross(r, c) {
      const enabled = opts.crosshair && opts.crosshair();
      if (!enabled) { r = -1; c = -1; }
      if (r === crossAt.r && c === crossAt.c) return;
      // only touch the squares that change (a 100x100 board has 10,000 of them)
      crossEls.forEach(x => x.classList.remove('cross'));
      crossAt = { r, c };
      crossEls = r < 0 ? [] : lineEls('row', r).concat(lineEls('col', c));
      crossEls.forEach(x => x.classList.add('cross'));
    }

    return {
      build, setClues, setLineClue, setCell, renderGrid, setClueDone, lineEls, clearClass, cellEl, fit, zoom,
      /** scroll so square (r, c) is visible (for hints on big boards) */
      reveal(r, c) {
        const d = cells[r] && cells[r][c];
        if (!d) return;
        // the clue headers stick to the top and left, so keep the square clear of them
        const dr = d.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        const top = wr.top + (colClues[0] ? colClues[0].getBoundingClientRect().height : 0);
        const left = wr.left + (rowClues[0] ? rowClues[0].getBoundingClientRect().width : 0);
        const margin = cellSize * 2;
        let dx = 0, dy = 0;
        if (dr.left < left + margin) dx = dr.left - left - margin;
        else if (dr.right > wr.right - margin) dx = dr.right - wr.right + margin;
        if (dr.top < top + margin) dy = dr.top - top - margin;
        else if (dr.bottom > wr.bottom - margin) dy = dr.bottom - wr.bottom + margin;
        if (dx || dy) wrap.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      },
      get size() { return { h, w }; },
      setSolved(on) { el.classList.toggle('solved', on); },
    };
  }

  global.NonogramBoard = { createBoard };
})(typeof window !== 'undefined' ? window : globalThis);
