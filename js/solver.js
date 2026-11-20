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
  function propagate(grid, clues, record, dirtyLines) {
    const h = grid.length, w = grid[0].length;
    const queue = [];
    const inQueue = { row: new Uint8Array(h), col: new Uint8Array(w) };
    const push = (type, idx) => { if (!inQueue[type][idx]) { inQueue[type][idx] = 1; queue.push({ type, idx }); } };
    if (dirtyLines) dirtyLines.forEach(l => push(l.type, l.idx));
    else { for (let r = 0; r < h; r++) push('row', r); for (let c = 0; c < w; c++) push('col', c); }
    const steps = [];
    while (queue.length) {
      const { type, idx } = queue.shift();
      inQueue[type][idx] = 0;
      const cl = type === 'row' ? clues.rows[idx] : clues.cols[idx];
      const line = getLine(grid, type, idx);
      const res = solveLineExact(cl, line);
      if (!res.ok) return { ok: false, steps, failedLine: { type, idx } };
      if (!res.cells.length) continue;
      for (const { i, v } of res.cells) {
        const { r, c } = cellCoord(type, idx, i);
        grid[r][c] = v;
        if (type === 'row') push('col', c); else push('row', r);
      }
      if (record) steps.push({ type, idx, cells: res.cells.map(x => ({ ...cellCoord(type, idx, x.i), v: x.v })) });
    }
    return { ok: true, steps };
  }

  // ---------------------------------------------------------------------------
  // Finding the next human-style step
  // ---------------------------------------------------------------------------

  /**
   * Find the simplest deduction available on the current grid.
   * The grid must not contain mistakes (check against the solution first).
   * Returns a step object or { technique: 'stuck' } / { technique: 'solved' }.
   */
  function findNextStep(grid, clues, opts) {
    opts = opts || {};
    if (isComplete(grid)) return { technique: 'solved' };
    const lines = allLines(clues);
    const analyses = [];
    for (const L of lines) {
      const line = getLine(grid, L.type, L.idx);
      const a = analyzeLine(L.clues, line);
      if (!a.ok) return { technique: 'invalid', type: L.type, idx: L.idx };
      analyses.push({ ...L, line, a });
    }
    for (const tech of LINE_TECHNIQUE_ORDER) {
      let best = null, bestScore = -1;
      for (const L of analyses) {
        if (!L.line.includes(UNKNOWN)) continue;
        const res = lineTechniques[tech](L.clues, L.line, L.a);
        if (!res) continue;
        const filledCount = res.cells.filter(x => x.v === FILLED).length;
        // prefer steps that fill squares, then more squares
        const score = filledCount * 100 + res.cells.length;
        if (score > bestScore) { bestScore = score; best = { L, res }; }
      }
      if (best) {
        const { L, res } = best;
        return {
          technique: tech,
          type: L.type,
          idx: L.idx,
          clues: L.clues,
          line: L.line,
          lineCells: res.cells,
          cells: res.cells.map(x => ({ ...cellCoord(L.type, L.idx, x.i), v: x.v })),
          data: res.data,
        };
      }
    }
    if (opts.noContradiction) return { technique: 'stuck' };
    return findContradiction(grid, clues) || { technique: 'stuck' };
  }

  /** Try every unknown square both ways; return the shortest contradiction. */
  function findContradiction(grid, clues) {
    const h = grid.length, w = grid[0].length;
    let best = null;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (grid[r][c] !== UNKNOWN) continue;
        for (const assumed of [FILLED, EMPTY]) {
          const g = cloneGrid(grid);
          g[r][c] = assumed;
          const res = propagate(g, clues, true, [{ type: 'row', idx: r }, { type: 'col', idx: c }]);
          if (res.ok) continue;
          const len = res.steps.length;
          if (!best || len < best.len) {
            best = { len, r, c, assumed, steps: res.steps, failedLine: res.failedLine };
          }
        }
      }
      if (best && best.len <= 1) break;
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

  /** Solve using only human techniques. Returns {solved, maxLevel, counts, steps}. */
  function logicalSolve(clues, h, w, maxSteps) {
    const grid = emptyGrid(h, w);
    const counts = {};
    let maxLevel = 0, steps = 0;
    maxSteps = maxSteps || 100000;
    while (steps < maxSteps) {
      const step = findNextStep(grid, clues);
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

  /** Count solutions (stops at `limit`). Returns {count, solutions}. */
  function countSolutions(clues, h, w, limit) {
    limit = limit || 2;
    const solutions = [];
    function rec(grid) {
      if (solutions.length >= limit) return;
      const res = propagate(grid, clues, false);
      if (!res.ok) return;
      let br = -1, bc = -1;
      outer: for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (grid[r][c] === UNKNOWN) { br = r; bc = c; break outer; }
      if (br < 0) { solutions.push(cloneGrid(grid)); return; }
      for (const v of [FILLED, EMPTY]) {
        const g = cloneGrid(grid);
        g[br][bc] = v;
        rec(g);
        if (solutions.length >= limit) return;
      }
    }
    rec(emptyGrid(h, w));
    return { count: solutions.length, solutions };
  }

  /**
   * Full check for a puzzle drawn as a 0/1 matrix.
   * Returns {unique, logical, difficulty, level, counts, altSolution}.
   */
  function evaluatePuzzle(solution01) {
    const h = solution01.length, w = solution01[0].length;
    const sol = solution01.map(r => r.map(v => (v ? FILLED : EMPTY)));
    const clues = cluesFromSolution(sol);
    const cs = countSolutions(clues, h, w, 2);
    const unique = cs.count === 1;
    let alt = null;
    if (!unique && cs.solutions.length) {
      alt = cs.solutions.find(s => s.some((row, r) => row.some((v, c) => v !== sol[r][c]))) || null;
    }
    const ls = logicalSolve(clues, h, w);
    const logical = ls.solved;
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

  global.NonogramSolver = {
    UNKNOWN, FILLED, EMPTY,
    TECHNIQUES, LINE_TECHNIQUE_ORDER, rateDifficulty,
    cluesFromLine, cluesFromSolution,
    analyzeLine, solveLineExact,
    lineTechniques,
    findNextStep, findContradiction, propagate,
    logicalSolve, countSolutions, evaluatePuzzle,
    getLine, cellCoord, emptyGrid, cloneGrid,
  };
})(typeof window !== 'undefined' ? window : globalThis);
