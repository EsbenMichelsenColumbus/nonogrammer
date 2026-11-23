/*
 * Nonogram solver that reasons the way a person does.
 *
 * Every deduction is produced by a named technique and carries the data
 * needed to explain it. Techniques are tried from simplest to hardest, so a
 * hint always uses the easiest logic that moves the puzzle forward.
 *
 * Cell values: 0 = unknown, 1 = filled, 2 = empty (marked with an X).
 */
(function (global) {
  'use strict';

  const UNKNOWN = 0, FILLED = 1, EMPTY = 2;

  // ---------------------------------------------------------------------------
  // Technique catalogue (order = priority, simplest first)
  // ---------------------------------------------------------------------------
  const TECHNIQUES = {
    'empty-line': {
      name: 'Empty line',
      level: 1,
      summary: 'A line whose clue is 0 has no filled squares at all.',
    },
    'perfect-fit': {
      name: 'Perfect fit',
      level: 1,
      summary: 'When the blocks plus one gap between each fill the whole line exactly, there is only one way to place them.',
    },
    'line-complete': {
      name: 'Line complete',
      level: 1,
      summary: 'When every filled square a line needs has been found, all its other squares must be empty.',
    },
    'overlap': {
      name: 'Overlap (simple boxes)',
      level: 2,
      summary: 'Push all blocks as far to the start as they go, then as far to the end. Where a block covers the same squares in both positions, those squares must be filled.',
    },
    'gap-too-small': {
      name: 'Gap too small',
      level: 2,
      summary: 'A gap between empty squares (or the edge) that is shorter than any block that could go there must be empty.',
    },
    'block-complete': {
      name: 'Finished block',
      level: 2,
      summary: 'When a run of filled squares already has the full length of the only block(s) it can belong to, the squares on both ends must be empty.',
    },
    'constrained-overlap': {
      name: 'Overlap using existing marks',
      level: 2,
      summary: 'Use the squares already filled or crossed out to work out the earliest and latest position of each block. Where a block covers the same squares in both positions, they must be filled.',
    },
    'unreachable': {
      name: 'Unreachable squares',
      level: 2,
      summary: 'Using the earliest and latest possible position of each block, some squares cannot be reached by any block, so they must be empty.',
    },
    'line-analysis': {
      name: 'All possibilities',
      level: 3,
      summary: 'Consider every way the clues can fit the line with the marks already there. A square that is filled in all of them (or empty in all of them) is certain.',
    },
    'contradiction': {
      name: 'Contradiction',
      level: 4,
      summary: 'Assume a square is filled (or empty) and follow the consequences. If that makes some line impossible, the square must be the opposite.',
    },
  };

  const LINE_TECHNIQUE_ORDER = [
    'empty-line', 'perfect-fit', 'line-complete', 'overlap', 'gap-too-small',
    'block-complete', 'constrained-overlap', 'unreachable', 'line-analysis',
  ];

  /**
   * Difficulty from the hardest technique needed, how often the hard ones are
   * needed, and the puzzle size.
   */
  function rateDifficulty(maxLevel, counts, h, w) {
    const contradictions = counts['contradiction'] || 0;
    const analyses = counts['line-analysis'] || 0;
    if (contradictions > 2) return 'Expert';
    if (contradictions > 0) return 'Hard';
    if (analyses > 2 || (analyses > 0 && Math.max(h, w) > 10)) return 'Hard';
    if (analyses > 0 || Math.max(h, w) > 10) return 'Medium';
    return 'Easy';
  }

  // ---------------------------------------------------------------------------
  // Clues
  // ---------------------------------------------------------------------------
  function cluesFromLine(cells) {
    const out = [];
    let run = 0;
    for (const v of cells) {
      if (v === FILLED) run++;
      else if (run) { out.push(run); run = 0; }
    }
    if (run) out.push(run);
    return out;
  }

  function cluesFromSolution(solution) {
    const h = solution.length, w = solution[0].length;
    const rows = solution.map(r => cluesFromLine(r));
    const cols = [];
    for (let c = 0; c < w; c++) {
      const col = [];
      for (let r = 0; r < h; r++) col.push(solution[r][c]);
      cols.push(cluesFromLine(col));
    }
    return { rows, cols };
  }

  // ---------------------------------------------------------------------------
  // Exact line analysis (dynamic programming)
  //
  // Returns which squares can be filled / empty in at least one arrangement
  // that agrees with the current marks, and the valid start positions for
  // every block.
  // ---------------------------------------------------------------------------
  function analyzeLine(clues, line) {
    const n = line.length, k = clues.length;
    const canBeEmpty = c => line[c] !== FILLED;
    // prefix count of EMPTY cells to test "segment has no X" in O(1)
    const xPre = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) xPre[i + 1] = xPre[i] + (line[i] === EMPTY ? 1 : 0);
    const segFree = (a, b) => xPre[b] - xPre[a] === 0; // cells [a, b)

    // f[i][p]: first i blocks fit in cells [0, p)
    const f = [];
    for (let i = 0; i <= k; i++) f.push(new Uint8Array(n + 1));
    f[0][0] = 1;
    for (let p = 1; p <= n; p++) f[0][p] = f[0][p - 1] && canBeEmpty(p - 1) ? 1 : 0;
    for (let i = 1; i <= k; i++) {
      const L = clues[i - 1];
      for (let p = 0; p <= n; p++) {
        let v = 0;
        if (p > 0 && canBeEmpty(p - 1) && f[i][p - 1]) v = 1;
        if (!v && p >= L && segFree(p - L, p)) {
          const s = p - L;
          if (i === 1) v = f[0][s];
          else if (s >= 1 && canBeEmpty(s - 1) && f[i - 1][s - 1]) v = 1;
        }
        f[i][p] = v;
      }
    }

    // g[i][p]: blocks i..k-1 fit in cells [p, n)
    const g = [];
    for (let i = 0; i <= k; i++) g.push(new Uint8Array(n + 2));
    g[k][n] = 1;
    for (let p = n - 1; p >= 0; p--) g[k][p] = canBeEmpty(p) && g[k][p + 1] ? 1 : 0;
    for (let i = k - 1; i >= 0; i--) {
      const L = clues[i];
      for (let p = n; p >= 0; p--) {
        let v = 0;
        if (p < n && canBeEmpty(p) && g[i][p + 1]) v = 1;
        if (!v && p + L <= n && segFree(p, p + L)) {
          const e = p + L;
          if (i === k - 1) v = g[k][e];
          else if (e < n && canBeEmpty(e) && g[i + 1][e + 1]) v = 1;
        }
        g[i][p] = v;
      }
    }

    const ok = !!f[k][n];
    const starts = [];
    const fillDiff = new Int32Array(n + 1);
    if (ok) {
      for (let i = 0; i < k; i++) {
        const L = clues[i];
        const list = [];
        for (let s = 0; s + L <= n; s++) {
          if (!segFree(s, s + L)) continue;
          const left = i === 0 ? f[0][s] : (s >= 1 && canBeEmpty(s - 1) && f[i][s - 1]);
          if (!left) continue;
          const e = s + L;
          const right = i === k - 1 ? g[k][e] : (e < n && canBeEmpty(e) && g[i + 1][e + 1]);
          if (!right) continue;
          list.push(s);
          fillDiff[s]++; fillDiff[e]--;
        }
        starts.push(list);
      }
    }
    const canFill = new Array(n).fill(false);
    const canEmpty = new Array(n).fill(false);
    if (ok) {
      let acc = 0;
      for (let c = 0; c < n; c++) { acc += fillDiff[c]; canFill[c] = acc > 0; }
      for (let c = 0; c < n; c++) {
        if (!canBeEmpty(c)) continue;
        for (let i = 0; i <= k; i++) {
          if (f[i][c] && g[i][c + 1]) { canEmpty[c] = true; break; }
        }
      }
    }
    return { ok, starts, canFill, canEmpty };
  }

  /**
   * Which clue numbers the player has finished, judged only from the player's
   * own marks (never the solution). A number counts as done when its block is
   * fully filled and the marks leave it only one possible position. If the
   * filled runs already match the clue exactly, every number is done.
   * Returns one boolean per clue number (one entry for an empty clue).
   */
  function finishedBlocks(clues, line) {
    const got = cluesFromLine(line);
    if (got.length === clues.length && got.every((v, i) => v === clues[i])) {
      return clues.length ? clues.map(() => true) : [true];
    }
    if (!clues.length) return [false];
    const a = analyzeLine(clues, line);
    if (!a.ok) return clues.map(() => false);
    return clues.map((L, i) => {
      if (a.starts[i].length !== 1) return false;
      const s = a.starts[i][0];
      for (let c = s; c < s + L; c++) if (line[c] !== FILLED) return false;
      return true;
    });
  }

  /** Exact line solve: returns {ok, cells:[{i, v}]} with every forced square. */
  function solveLineExact(clues, line) {
    const a = analyzeLine(clues, line);
    if (!a.ok) return { ok: false, cells: [] };
    const cells = [];
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== UNKNOWN) continue;
      if (!a.canEmpty[c]) cells.push({ i: c, v: FILLED });
      else if (!a.canFill[c]) cells.push({ i: c, v: EMPTY });
    }
    return { ok: true, cells, analysis: a };
  }

  // ---------------------------------------------------------------------------
  // Individual techniques. Each takes (clues, line, analysis) and returns
  // null or { cells: [{i, v}], data: {...} }. Only UNKNOWN cells are reported.
  // `analysis` is the exact analysis of the line (already known to be ok).
  // ---------------------------------------------------------------------------
  const sum = arr => arr.reduce((a, b) => a + b, 0);

  function packedStarts(clues) {
    const out = [];
    let p = 0;
    for (const L of clues) { out.push(p); p += L + 1; }
    return out;
  }

  const lineTechniques = {
    'empty-line'(clues, line) {
      if (clues.length !== 0) return null;
      const cells = [];
      line.forEach((v, i) => { if (v === UNKNOWN) cells.push({ i, v: EMPTY }); });
      return cells.length ? { cells, data: {} } : null;
    },

    'perfect-fit'(clues, line) {
      if (!clues.length) return null;
      const n = line.length;
      if (sum(clues) + clues.length - 1 !== n) return null;
      const starts = packedStarts(clues);
      const target = new Array(n).fill(EMPTY);
      clues.forEach((L, b) => { for (let j = 0; j < L; j++) target[starts[b] + j] = FILLED; });
      const cells = [];
      line.forEach((v, i) => { if (v === UNKNOWN) cells.push({ i, v: target[i] }); });
      return cells.length ? { cells, data: { starts } } : null;
    },

    'line-complete'(clues, line) {
      if (!clues.length) return null;
      const filled = line.filter(v => v === FILLED).length;
      if (filled !== sum(clues)) return null;
      const cells = [];
      line.forEach((v, i) => { if (v === UNKNOWN) cells.push({ i, v: EMPTY }); });
      return cells.length ? { cells, data: { total: filled } } : null;
    },

    'overlap'(clues, line) {
      if (!clues.length) return null;
      const n = line.length;
      const slack = n - (sum(clues) + clues.length - 1);
      if (slack < 0) return null;
      const left = packedStarts(clues);
      const right = left.map(s => s + slack);
      const cells = [];
      const blocks = [];
      clues.forEach((L, b) => {
        if (L <= slack) return;
        const from = right[b], to = left[b] + L - 1;
        let added = false;
        for (let c = from; c <= to; c++) {
          if (line[c] === UNKNOWN) { cells.push({ i: c, v: FILLED }); added = true; }
        }
        if (added) blocks.push({ block: b, from, to });
      });
      return cells.length ? { cells, data: { left, right, slack, blocks } } : null;
    },

    'gap-too-small'(clues, line) {
      if (!clues.length) return null;
      const n = line.length;
      const minClue = Math.min(...clues);
      const cells = [];
      const gaps = [];
      let c = 0;
      while (c < n) {
        if (line[c] === EMPTY) { c++; continue; }
        let e = c, hasFilled = false;
        while (e < n && line[e] !== EMPTY) { if (line[e] === FILLED) hasFilled = true; e++; }
        const len = e - c;
        if (!hasFilled && len < minClue) {
          let added = false;
          for (let j = c; j < e; j++) if (line[j] === UNKNOWN) { cells.push({ i: j, v: EMPTY }); added = true; }
          if (added) gaps.push({ from: c, to: e - 1, len });
        }
        c = e;
      }
      return cells.length ? { cells, data: { minClue, gaps } } : null;
    },

    'block-complete'(clues, line, a) {
      if (!clues.length) return null;
      const n = line.length;
      const cells = [];
      const runs = [];
      let c = 0;
      while (c < n) {
        if (line[c] !== FILLED) { c++; continue; }
        let e = c;
        while (e < n && line[e] === FILLED) e++;
        const runLen = e - c;
        const leftOpen = c > 0 && line[c - 1] === UNKNOWN;
        const rightOpen = e < n && line[e] === UNKNOWN;
        if (leftOpen || rightOpen) {
          // blocks that could cover this run in some valid arrangement
          const candidates = [];
          clues.forEach((L, b) => {
            if (a.starts[b].some(s => s <= c && s + L >= e)) candidates.push(b);
          });
          if (candidates.length && candidates.every(b => clues[b] === runLen)) {
            if (leftOpen) cells.push({ i: c - 1, v: EMPTY });
            if (rightOpen) cells.push({ i: e, v: EMPTY });
            runs.push({ from: c, to: e - 1, len: runLen, candidates, isMax: runLen === Math.max(...clues) });
          }
        }
        c = e;
      }
      return cells.length ? { cells, data: { runs } } : null;
    },

    'constrained-overlap'(clues, line, a) {
      if (!clues.length) return null;
      const earliest = a.starts.map(l => l[0]);
      const latest = a.starts.map(l => l[l.length - 1]);
      const cells = [];
      const blocks = [];
      const seen = new Set();
      clues.forEach((L, b) => {
        const from = latest[b], to = earliest[b] + L - 1;
        let added = false;
        for (let c = from; c <= to; c++) {
          if (line[c] === UNKNOWN && !seen.has(c)) { seen.add(c); cells.push({ i: c, v: FILLED }); added = true; }
        }
        if (added) blocks.push({ block: b, from, to });
      });
      return cells.length ? { cells, data: { earliest, latest, blocks } } : null;
    },

    'unreachable'(clues, line, a) {
      if (!clues.length) return null;
      const n = line.length;
      const earliest = a.starts.map(l => l[0]);
      const latest = a.starts.map(l => l[l.length - 1]);
      const reach = new Array(n).fill(false);
      clues.forEach((L, b) => { for (let c = earliest[b]; c < latest[b] + L; c++) reach[c] = true; });
      const cells = [];
      for (let c = 0; c < n; c++) if (!reach[c] && line[c] === UNKNOWN) cells.push({ i: c, v: EMPTY });
      return cells.length ? { cells, data: { earliest, latest } } : null;
    },

    'line-analysis'(clues, line, a) {
      const cells = [];
      for (let c = 0; c < line.length; c++) {
        if (line[c] !== UNKNOWN) continue;
        if (!a.canEmpty[c]) cells.push({ i: c, v: FILLED });
        else if (!a.canFill[c]) cells.push({ i: c, v: EMPTY });
      }
      return cells.length ? { cells, data: {} } : null;
    },
  };

  // ---------------------------------------------------------------------------
  // Board helpers
  // ---------------------------------------------------------------------------
  function getLine(grid, type, idx) {
    if (type === 'row') return grid[idx].slice();
    return grid.map(r => r[idx]);
  }

  function cellCoord(type, idx, i) {
    return type === 'row' ? { r: idx, c: i } : { r: i, c: idx };
  }

  function cloneGrid(grid) { return grid.map(r => r.slice()); }

  function emptyGrid(h, w) {
    return Array.from({ length: h }, () => new Array(w).fill(UNKNOWN));
  }

  function allLines(clues) {
    const out = [];
    clues.rows.forEach((cl, i) => out.push({ type: 'row', idx: i, clues: cl }));
    clues.cols.forEach((cl, i) => out.push({ type: 'col', idx: i, clues: cl }));
    return out;
  }

  function isComplete(grid) {
    return grid.every(r => r.every(v => v !== UNKNOWN));
  }

  /**
   * Fully propagate with the exact line solver. Mutates grid.
   * Returns { ok, steps:[{type, idx, cells}], failedLine }.
   * If `record` is false, steps are not stored.
   */
  /*
   * Optional `opts`:
   *   limit  stop (ok, aborted) after this many line steps that changed something
   *   trail  array; every changed square is pushed as [r, c] so the caller can undo
   *   work    object {n}; counts line solves (to keep searches within a budget)
   */
  function propagate(grid, clues, record, dirtyLines, opts) {
    const h = grid.length, w = grid[0].length;
    const limit = opts && opts.limit, trail = opts && opts.trail, work = opts && opts.work;
    const queue = [];
    let head = 0;
    const inQueue = { row: new Uint8Array(h), col: new Uint8Array(w) };
    const push = (type, idx) => { if (!inQueue[type][idx]) { inQueue[type][idx] = 1; queue.push({ type, idx }); } };
    if (dirtyLines) dirtyLines.forEach(l => push(l.type, l.idx));
    else { for (let r = 0; r < h; r++) push('row', r); for (let c = 0; c < w; c++) push('col', c); }
    const steps = [];
    let changedSteps = 0;
    while (head < queue.length) {
      const { type, idx } = queue[head++];
      inQueue[type][idx] = 0;
      const cl = type === 'row' ? clues.rows[idx] : clues.cols[idx];
      const line = getLine(grid, type, idx);
      if (work) work.n++;
      const res = solveLineExact(cl, line);
      if (!res.ok) return { ok: false, steps, failedLine: { type, idx }, count: changedSteps };
      if (!res.cells.length) continue;
      for (const { i, v } of res.cells) {
        const { r, c } = cellCoord(type, idx, i);
        grid[r][c] = v;
        if (trail) trail.push([r, c]);
        if (type === 'row') push('col', c); else push('row', r);
      }
      changedSteps++;
      if (record) steps.push({ type, idx, cells: res.cells.map(x => ({ ...cellCoord(type, idx, x.i), v: x.v })) });
      if (limit != null && changedSteps > limit) return { ok: true, aborted: true, steps, count: changedSteps };
    }
    return { ok: true, steps, count: changedSteps };
  }

  // ---------------------------------------------------------------------------
  // Finding the next human-style step
  // ---------------------------------------------------------------------------

  // Per-clue-set cache of line analyses, keyed by the line's current contents.
  // Repeated calls on a slowly filling grid (logical solve, hints) only analyse changed lines.
  const lineCache = new WeakMap();
  function lineEntry(clues, L, grid) {
    let m = lineCache.get(clues);
    if (!m) { m = new Map(); lineCache.set(clues, m); }
    const line = getLine(grid, L.type, L.idx);
    const key = (L.type === 'row' ? 'r' : 'c') + L.idx + ':' + line.join('');
    let e = m.get(key);
    if (!e) {
      if (m.size > 50000) m.clear();
      e = { line, a: analyzeLine(L.clues, line), res: {}, open: line.includes(UNKNOWN) };
      m.set(key, e);
    }
    return e;
  }

  /**
   * Find the simplest deduction available on the current grid.
   * The grid must not contain mistakes (check against the solution first).
   * Returns a step object or { technique: 'stuck' } / { technique: 'solved' }.
   * opts.noContradiction: don't search for contradictions.
   * opts.anyContradiction: accept the first contradiction found instead of the shortest.
   */
  function findNextStep(grid, clues, opts) {
    opts = opts || {};
    if (isComplete(grid)) return { technique: 'solved' };
    const lines = allLines(clues);
    const analyses = [];
    for (const L of lines) {
      const e = lineEntry(clues, L, grid);
      if (!e.a.ok) return { technique: 'invalid', type: L.type, idx: L.idx };
      if (e.open) analyses.push({ L, e });
    }
    for (const tech of LINE_TECHNIQUE_ORDER) {
      let best = null, bestScore = -1;
      for (const { L, e } of analyses) {
        let res = e.res[tech];
        if (res === undefined) res = e.res[tech] = lineTechniques[tech](L.clues, e.line, e.a) || null;
        if (!res) continue;
        const filledCount = res.cells.filter(x => x.v === FILLED).length;
        // prefer steps that fill squares, then more squares
        const score = filledCount * 100 + res.cells.length;
        if (score > bestScore) { bestScore = score; best = { L, e, res }; }
      }
      if (best) {
        const { L, e, res } = best;
        return {
          technique: tech,
          type: L.type,
          idx: L.idx,
          clues: L.clues,
          line: e.line.slice(),
          lineCells: res.cells,
          cells: res.cells.map(x => ({ ...cellCoord(L.type, L.idx, x.i), v: x.v })),
          data: res.data,
        };
      }
    }
    if (opts.noContradiction) return { technique: 'stuck' };
    return findContradiction(grid, clues, opts.anyContradiction) || { technique: 'stuck' };
  }

  // A contradiction chain longer than this many line steps is not something a person
  // could follow, so it doesn't count as a usable deduction.
  const MAX_CHAIN = 40;
  // Upper bound on line solves in one contradiction search (keeps big boards responsive).
  const SEARCH_BUDGET = 150000;

  /**
   * Try unknown squares both ways and look for one that leads to an impossible line.
   * Squares in nearly finished lines are tried first, as that is where short chains are.
   * Returns the shortest chain found (or the first one, if `any`).
   */
  function findContradiction(grid, clues, any) {
    const h = grid.length, w = grid[0].length;
    const rowOpen = new Int32Array(h), colOpen = new Int32Array(w);
    const cand = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      if (grid[r][c] !== UNKNOWN) continue;
      rowOpen[r]++; colOpen[c]++;
      cand.push(r * w + c);
    }
    const prio = k => {
      const ro = rowOpen[(k / w) | 0], co = colOpen[k % w];
      return Math.min(ro, co) * 4 + ro + co;
    };
    cand.sort((a, b) => prio(a) - prio(b) || a - b);
    const work = { n: 0 };
    const trail = [];
    let best = null;
    for (const k of cand) {
      if (work.n > SEARCH_BUDGET) break;
      const r = (k / w) | 0, c = k % w;
      for (const assumed of [FILLED, EMPTY]) {
        const limit = best ? best.len - 1 : MAX_CHAIN;
        if (limit < 0) continue;
        trail.length = 0;
        grid[r][c] = assumed;
        const res = propagate(grid, clues, true, [{ type: 'row', idx: r }, { type: 'col', idx: c }], { limit, trail, work });
        for (const [tr, tc] of trail) grid[tr][tc] = UNKNOWN;
        grid[r][c] = UNKNOWN;
        if (res.ok) continue;
        const len = res.steps.length;
        if (!best || len < best.len) best = { len, r, c, assumed, steps: res.steps, failedLine: res.failedLine };
      }
      if (best && (any || best.len <= 1)) break;
    }
    if (!best) return null;
    const actual = best.assumed === FILLED ? EMPTY : FILLED;
    const fl = best.failedLine;
    return {
      technique: 'contradiction',
      type: fl.type,
      idx: fl.idx,
      cells: [{ r: best.r, c: best.c, v: actual }],
      data: {
        r: best.r, c: best.c,
        assumed: best.assumed,
        steps: best.steps,
        failedLine: fl,
        failedClues: fl.type === 'row' ? clues.rows[fl.idx] : clues.cols[fl.idx],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Whole-puzzle analysis: logical solve, difficulty, uniqueness
  // ---------------------------------------------------------------------------

  /**
   * Boards with more squares than this must be solvable with line techniques alone
   * (no contradictions). Searching for contradictions on a 100x100 board is too slow
   * to do on every check, and line-solvable big puzzles keep hints fast.
   */
  const BIG_CELLS = 900;
  const isBig = (h, w) => h * w > BIG_CELLS;

  /** Solve using only human techniques. Returns {solved, maxLevel, counts, steps, grid}. */
  function logicalSolve(clues, h, w, maxSteps) {
    const big = isBig(h, w);
    if (big) {
      // fast check: line logic to a standstill. If that doesn't finish, the step-by-step solve can't either.
      const g = emptyGrid(h, w);
      const res = propagate(g, clues, false);
      if (!res.ok) return { solved: false, maxLevel: 0, counts: {}, steps: 0, grid: g, reason: 'invalid' };
      if (!isComplete(g)) return { solved: false, maxLevel: 0, counts: {}, steps: 0, grid: g, reason: 'stuck' };
    }
    const grid = emptyGrid(h, w);
    const counts = {};
    let maxLevel = 0, steps = 0;
    maxSteps = maxSteps || 1000000;
    while (steps < maxSteps) {
      const step = findNextStep(grid, clues, { anyContradiction: true, noContradiction: big });
      if (step.technique === 'solved') return { solved: true, maxLevel, counts, steps, grid };
      if (step.technique === 'stuck' || step.technique === 'invalid') {
        return { solved: false, maxLevel, counts, steps, grid, reason: step.technique };
      }
      for (const { r, c, v } of step.cells) grid[r][c] = v;
      counts[step.technique] = (counts[step.technique] || 0) + 1;
      maxLevel = Math.max(maxLevel, TECHNIQUES[step.technique].level);
      steps++;
    }
    return { solved: false, maxLevel, counts, steps, grid, reason: 'limit' };
  }

  /**
   * Count solutions (stops at `limit`, or after `maxNodes` guesses).
   * Returns {count, solutions, complete}; complete is false if the search was cut short.
   */
  function countSolutions(clues, h, w, limit, maxNodes) {
    limit = limit || 2;
    maxNodes = maxNodes || 20000;
    const solutions = [];
    let nodes = 0, cut = false;
    function rec(grid, dirty) {
      if (solutions.length >= limit) return;
      if (++nodes > maxNodes) { cut = true; return; }
      const res = propagate(grid, clues, false, dirty);
      if (!res.ok) return;
      let br = -1, bc = -1;
      outer: for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (grid[r][c] === UNKNOWN) { br = r; bc = c; break outer; }
      if (br < 0) { solutions.push(cloneGrid(grid)); return; }
      for (const v of [FILLED, EMPTY]) {
        const g = cloneGrid(grid);
        g[br][bc] = v;
        rec(g, [{ type: 'row', idx: br }, { type: 'col', idx: bc }]);
        if (solutions.length >= limit || cut) return;
      }
    }
    rec(emptyGrid(h, w));
    return { count: solutions.length, solutions, complete: !cut };
  }

  /**
   * Full check for a puzzle drawn as a 0/1 matrix.
   * Returns {unique, logical, difficulty, level, counts, altSolution}.
   * A puzzle that the techniques solve is unique (every step is a sound deduction),
   * so the slower search for a second solution only runs when logic gets stuck.
   */
  function evaluatePuzzle(solution01) {
    const h = solution01.length, w = solution01[0].length;
    const sol = solution01.map(r => r.map(v => (v ? FILLED : EMPTY)));
    const clues = cluesFromSolution(sol);
    const ls = logicalSolve(clues, h, w);
    const logical = ls.solved;
    let unique = logical, alt = null;
    if (!logical) {
      // on big boards only a short search for a second solution (to show where it differs)
      const cs = countSolutions(clues, h, w, 2, isBig(h, w) ? 200 : 20000);
      unique = cs.count === 1 && cs.complete;
      if (cs.count > 1) alt = cs.solutions.find(s => s.some((row, r) => row.some((v, c) => v !== sol[r][c]))) || null;
    }
    const level = ls.maxLevel || 1;
    return {
      unique,
      logical,
      level,
      difficulty: logical ? rateDifficulty(level, ls.counts, h, w) : 'Needs guessing',
      counts: ls.counts,
      steps: ls.steps,
      altSolution: alt,
      clues,
    };
  }

  // ---------------------------------------------------------------------------
  // Auto-fix: change as few squares as possible so a drawing becomes solvable
  // ---------------------------------------------------------------------------

  /** Squares the plain line solver leaves open for a 0/1 picture (a quick score). */
  function quickUnknown(grid01) {
    const h = grid01.length, w = grid01[0].length;
    const clues = cluesFromSolution(grid01.map(r => r.map(v => (v ? FILLED : EMPTY))));
    const g = emptyGrid(h, w);
    propagate(g, clues, false);
    let n = 0;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (g[r][c] === UNKNOWN) n++;
    return n;
  }

  /**
   * One auto-fix step. Finds where solving gets stuck and picks the single
   * square whose change helps most. Squares on the picture's outline are tried
   * first, because changing them alters the picture least.
   * Returns {solved:true} or {r, c, stuck, score}. `avoid` is a Set of "r,c" keys not to flip.
   */
  function repairStep(grid01, avoid, maxCandidates) {
    const h = grid01.length, w = grid01[0].length;
    const big = isBig(h, w);
    const clues = cluesFromSolution(grid01.map(r => r.map(v => (v ? FILLED : EMPTY))));
    // Line logic first: if it solves everything, the puzzle is fine.
    const base = emptyGrid(h, w);
    propagate(base, clues, false);
    if (isComplete(base)) return { solved: true };
    // Small boards may also use contradictions. Big boards aim for line logic only,
    // which keeps both this search and later hints fast.
    let ls = { grid: base };
    if (!big) {
      ls = logicalSolve(clues, h, w);
      if (ls.solved) return { solved: true };
    }
    const at = (r, c) => (r >= 0 && r < h && c >= 0 && c < w ? grid01[r][c] : 0);
    // known squares, with the board's border counting as known
    const known = (r, c) => r < 0 || r >= h || c < 0 || c >= w || ls.grid[r][c] !== UNKNOWN;
    // Priority: next to what is already solved (where solving stalled), then on the picture's outline
    const tiers = [[], [], [], []];
    let stuck = 0;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      if (ls.grid[r][c] !== UNKNOWN) continue;
      stuck++;
      if (avoid && avoid.has(r + ',' + c)) continue;
      const v = grid01[r][c];
      const onEdge = at(r - 1, c) !== v || at(r + 1, c) !== v || at(r, c - 1) !== v || at(r, c + 1) !== v;
      const frontier = known(r - 1, c) || known(r + 1, c) || known(r, c - 1) || known(r, c + 1);
      // big boards: outline squares first, spread over the whole stuck area, so fixes
      // look like small bumps on the picture rather than new lines along one edge
      if (big) tiers[(onEdge ? 0 : 2) + (frontier ? 0 : 1)].push([r, c]);
      else tiers[(frontier ? 0 : 2) + (onEdge ? 0 : 1)].push([r, c]);
    }
    const max = maxCandidates || 80;
    let candidates;
    if (big) {
      const spread = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor(i * list.length / n)]));
      candidates = [];
      for (const t of tiers) candidates = candidates.concat(spread(t, max - candidates.length));
    } else {
      candidates = [].concat(...tiers).slice(0, max);
    }
    if (!candidates.length) return { solved: false, stuck, r: -1, c: -1 };
    // how well a changed square blends in: original neighbours that have its new value
    // (earlier auto-fix changes don't count, so fixes don't grow into lines)
    const blend = (r, c) => {
      const nv = grid01[r][c] ^ 1;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!(dr || dc)) continue;
        if (avoid && avoid.has((r + dr) + ',' + (c + dc))) { n -= 2; continue; }
        if (at(r + dr, c + dc) === nv) n++;
      }
      return n;
    };
    let best = null;
    for (const [r, c] of candidates) {
      const b = blend(r, c);
      grid01[r][c] ^= 1;
      const score = big ? quickUnknownFrom(base, clues, grid01, r, c) : quickUnknown(grid01);
      grid01[r][c] ^= 1;
      if (!best || score < best.score || (score === best.score && b > best.b)) best = { r, c, score, b };
    }
    return { solved: false, stuck, r: best.r, c: best.c, score: best.score };
  }

  /**
   * Quick score for big boards: start from the already-propagated grid, forget
   * the changed square's row and column, and re-propagate from there only.
   */
  function quickUnknownFrom(base, clues, grid01, r, c) {
    const h = grid01.length, w = grid01[0].length;
    const g = cloneGrid(base);
    for (let i = 0; i < w; i++) g[r][i] = UNKNOWN;
    for (let i = 0; i < h; i++) g[i][c] = UNKNOWN;
    const cl = { rows: clues.rows.slice(), cols: clues.cols.slice() };
    cl.rows[r] = cluesFromLine(grid01[r].map(v => (v ? FILLED : EMPTY)));
    cl.cols[c] = cluesFromLine(grid01.map(row => (row[c] ? FILLED : EMPTY)));
    const res = propagate(g, cl, false, [{ type: 'row', idx: r }, { type: 'col', idx: c }]);
    if (!res.ok) return h * w; // the shortcut broke down; rank it last
    let n = 0;
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) if (g[i][j] === UNKNOWN) n++;
    return n;
  }

  global.NonogramSolver = {
    repairStep,
    UNKNOWN, FILLED, EMPTY,
    TECHNIQUES, LINE_TECHNIQUE_ORDER, rateDifficulty,
    cluesFromLine, cluesFromSolution,
    analyzeLine, solveLineExact, finishedBlocks,
    lineTechniques,
    findNextStep, findContradiction, propagate, isBig,
    logicalSolve, countSolutions, evaluatePuzzle,
    getLine, cellCoord, emptyGrid, cloneGrid,
  };
})(typeof window !== 'undefined' ? window : globalThis);
