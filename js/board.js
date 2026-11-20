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
      el.innerHTML = '';
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

    function setCell(r, c, v) {
      const d = cells[r][c];
      d.classList.toggle('f', v === FILLED);
      d.classList.toggle('x', v === EMPTY);
    }

    function renderGrid(grid) {
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) setCell(r, c, grid[r][c]);
    }

    function setClueDone(type, idx, done) {
      (type === 'row' ? rowClues : colClues)[idx].classList.toggle('done', done);
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

    // ---------------------------------------------------------------- sizing
    function fit() {
      if (!h) return;
      const maxRow = Math.max(1, ...clues.rows.map(l => l.length || 1));
      const maxCol = Math.max(1, ...clues.cols.map(l => l.length || 1));
      const style = getComputedStyle(wrap);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 4;
      const availW = wrap.clientWidth - padX;
      let size = availW / (w + maxRow * 0.78 + 0.4);
      if (window.innerWidth > 860) {
        const top = wrap.getBoundingClientRect().top + window.scrollY;
        const availH = window.innerHeight - Math.min(top, 140) - 60;
        size = Math.min(size, availH / (h + maxCol * 0.62 + 0.3));
      }
      size = Math.max(14, Math.min(36, Math.floor(size)));
      el.style.setProperty('--cell', size + 'px');
    }

    // ---------------------------------------------------------------- input
    function cellFromPoint(x, y) {
      const t = document.elementFromPoint(x, y);
      const d = t && t.closest && t.closest('.cell');
      if (!d || !el.contains(d)) return null;
      return { r: +d.dataset.r, c: +d.dataset.c };
    }

    el.addEventListener('contextmenu', e => e.preventDefault());

    el.addEventListener('pointerdown', e => {
      const d = e.target.closest('.cell');
      if (!d || stroke) return;
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
    function updateCross(r, c) {
      const enabled = opts.crosshair && opts.crosshair();
      if (!enabled) { r = -1; c = -1; }
      if (r === crossAt.r && c === crossAt.c) return;
      clearClass('cross');
      crossAt = { r, c };
      if (r < 0) return;
      lineEls('row', r).forEach(x => x.classList.add('cross'));
      lineEls('col', c).forEach(x => x.classList.add('cross'));
    }

    return {
      build, setClues, setCell, renderGrid, setClueDone, lineEls, clearClass, cellEl, fit,
      get size() { return { h, w }; },
      setSolved(on) { el.classList.toggle('solved', on); },
    };
  }

  global.NonogramBoard = { createBoard };
})(typeof window !== 'undefined' ? window : globalThis);
