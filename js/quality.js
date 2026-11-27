/*
 * Puzzle quality: is a (valid) puzzle interesting to solve?
 *
 * Measures
 *   symmetry   share of squares that equal their mirror image (best of left-right / top-bottom).
 *              Mirrored pictures have mirrored clues, so solving one half solves the other.
 *   fill       share of filled squares. Very dense pictures give huge overlaps at the start.
 *   giveaway   share of squares you can work out from single lines on the empty board.
 *   tension    share of steps where at most two lines can make progress: the moments where
 *              you have to find the one line that moves the puzzle on.
 *   variety    number of different techniques the solve needs.
 *
 * Small puzzles (under 10 squares on both sides) are treated as warm-ups: they are measured
 * but not judged. Tension is skipped on boards over 30x30 (too slow to measure on every check).
 */
(function (global) {
  'use strict';

  const S = global.NonogramSolver;

  /** Target ranges. `max`/`min` are inclusive. */
  const TARGETS = {
    symmetry: { max: 0.85, label: 'Symmetry', advice: 'Very symmetric: both halves give the same clues. Move something off-centre or add a detail on one side.' },
    fillLow: { min: 0.30, label: 'Filled squares', advice: 'Very few filled squares: mostly empty lines are quick to rule out. Add some shapes.' },
    fillHigh: { max: 0.60, label: 'Filled squares', advice: 'Very dense: big solid areas give large overlaps right away. Try outlines or cut-outs.' },
    giveaway: { max: 0.40, label: 'Given away at the start', advice: 'A lot can be read from single lines on the empty board. Break up long runs, or use more, shorter blocks.' },
    tension: { min: 0.05, label: 'Tricky moments', advice: 'There is always an easy line to work on. Puzzles get more interesting when progress sometimes depends on one particular line.' },
    variety: { min: 6, label: 'Techniques used', advice: 'Only a few techniques are needed. Shapes with gaps and short blocks next to long ones call for more.' },
  };

  function isWarmUp(h, w) { return Math.max(h, w) < 10; }

  function measure(solution01) {
    const h = solution01.length, w = solution01[0].length, n = h * w;
    let lr = 0, tb = 0, fill = 0;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const v = solution01[r][c] ? 1 : 0;
      fill += v;
      if (v === (solution01[r][w - 1 - c] ? 1 : 0)) lr++;
      if (v === (solution01[h - 1 - r][c] ? 1 : 0)) tb++;
    }
    const sol = solution01.map(r => r.map(v => (v ? S.FILLED : S.EMPTY)));
    const clues = S.cluesFromSolution(sol);

    // giveaway: squares known from one line alone on the empty board
    const known = new Uint8Array(n);
    const empty = new Array(Math.max(h, w)).fill(S.UNKNOWN);
    for (let r = 0; r < h; r++) S.solveLineExact(clues.rows[r], empty.slice(0, w)).cells.forEach(({ i }) => { known[r * w + i] = 1; });
    for (let c = 0; c < w; c++) S.solveLineExact(clues.cols[c], empty.slice(0, h)).cells.forEach(({ i }) => { known[i * w + c] = 1; });
    const giveaway = known.reduce((a, b) => a + b, 0) / n;

    // replay the solve: techniques used, and how many lines could make progress at each step
    const big = S.isBig(h, w);
    const grid = S.emptyGrid(h, w);
    const techniques = {};
    let steps = 0, narrow = 0;
    const lineCache = new Map();
    const progress = (type, idx) => {
      const line = S.getLine(grid, type, idx);
      const key = type[0] + idx + ':' + line.join('');
      let v = lineCache.get(key);
      if (v === undefined) {
        v = S.solveLineExact(type === 'row' ? clues.rows[idx] : clues.cols[idx], line).cells.length > 0;
        lineCache.set(key, v);
      }
      return v;
    };
    for (let guard = 0; guard < 200000; guard++) {
      const st = S.findNextStep(grid, clues, { noContradiction: big });
      if (!S.TECHNIQUES[st.technique]) break;
      if (!big) {
        let avail = 0;
        for (let r = 0; r < h && avail <= 2; r++) if (progress('row', r)) avail++;
        for (let c = 0; c < w && avail <= 2; c++) if (progress('col', c)) avail++;
        if (avail <= 2) narrow++;
      }
      techniques[st.technique] = (techniques[st.technique] || 0) + 1;
      steps++;
      st.cells.forEach(({ r, c, v }) => { grid[r][c] = v; });
    }
    return {
      h, w,
      symmetry: Math.max(lr, tb) / n,
      symmetryAxis: lr >= tb ? 'left-right' : 'top-bottom',
      fill: fill / n,
      giveaway,
      tension: big || !steps ? null : narrow / steps,
      variety: Object.keys(techniques).length,
      techniques,
      steps,
    };
  }

  /**
   * Judge a puzzle. Returns { metrics, warmUp, checks:[{key, label, value, target, ok, advice}], passed, total }.
   * Only meaningful for valid puzzles (unique and solvable without guessing).
   */
  function assess(solution01) {
    const m = measure(solution01);
    const warmUp = isWarmUp(m.h, m.w);
    const pct = x => Math.round(x * 100) + '%';
    const checks = [];
    const add = (key, value, shown, ok, target) => checks.push({ key, label: TARGETS[key].label, value, shown, target, ok, advice: ok ? '' : TARGETS[key].advice });
    add('symmetry', m.symmetry, pct(m.symmetry), m.symmetry <= TARGETS.symmetry.max, `at most ${pct(TARGETS.symmetry.max)}`);
    if (m.fill < TARGETS.fillLow.min) add('fillLow', m.fill, pct(m.fill), false, `${pct(TARGETS.fillLow.min)}–${pct(TARGETS.fillHigh.max)}`);
    else add('fillHigh', m.fill, pct(m.fill), m.fill <= TARGETS.fillHigh.max, `${pct(TARGETS.fillLow.min)}–${pct(TARGETS.fillHigh.max)}`);
    add('giveaway', m.giveaway, pct(m.giveaway), m.giveaway <= TARGETS.giveaway.max, `at most ${pct(TARGETS.giveaway.max)}`);
    if (m.tension != null) add('tension', m.tension, pct(m.tension), m.tension >= TARGETS.tension.min, `at least ${pct(TARGETS.tension.min)} of steps`);
    add('variety', m.variety, `${m.variety} of ${Object.keys(S.TECHNIQUES).length}`, m.variety >= TARGETS.variety.min, `at least ${TARGETS.variety.min}`);
    const passed = checks.filter(c => c.ok).length;
    return { metrics: m, warmUp, checks, passed, total: checks.length };
  }

  /**
   * How far a drawing is from meeting the targets (0 = meets all of them).
   * Infinity if it is not a valid puzzle (no unique, guess-free solution).
   */
  function shortfall(solution01) {
    const h = solution01.length, w = solution01[0].length;
    const clues = S.cluesFromSolution(solution01.map(r => r.map(v => (v ? S.FILLED : S.EMPTY))));
    if (!S.logicalSolve(clues, h, w).solved) return Infinity;
    const a = assess(solution01);
    let cost = 0;
    for (const c of a.checks) {
      if (c.ok) continue;
      cost += 1;
      if (c.key === 'symmetry') cost += (c.value - TARGETS.symmetry.max) / 0.03;
      if (c.key === 'fillHigh') cost += (c.value - TARGETS.fillHigh.max) / 0.03;
      if (c.key === 'fillLow') cost += (TARGETS.fillLow.min - c.value) / 0.03;
      if (c.key === 'giveaway') cost += (c.value - TARGETS.giveaway.max) / 0.03;
      if (c.key === 'tension') cost += (TARGETS.tension.min - c.value) / 0.01;
      if (c.key === 'variety') cost += TARGETS.variety.min - c.value;
    }
    return cost;
  }

  /**
   * One tuning step: try changing single squares on the picture's outline (where a change
   * is least visible) and return the change that brings the puzzle closest to the targets
   * while keeping it valid, or null if no change helps. `avoid`: Set of "r,c" not to touch.
   */
  function improveStep(solution01, avoid, maxCandidates) {
    const h = solution01.length, w = solution01[0].length;
    const base = shortfall(solution01);
    if (base === 0) return { done: true, cost: 0 };
    const at = (r, c) => (r >= 0 && r < h && c >= 0 && c < w ? solution01[r][c] : 0);
    const outline = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      if (avoid && avoid.has(r + ',' + c)) continue;
      const v = solution01[r][c];
      if (at(r - 1, c) !== v || at(r + 1, c) !== v || at(r, c - 1) !== v || at(r, c + 1) !== v) outline.push([r, c]);
    }
    const max = maxCandidates || 50;
    const pick = outline.length <= max ? outline
      : Array.from({ length: max }, (_, i) => outline[Math.floor(i * outline.length / max)]);
    let best = null;
    for (const [r, c] of pick) {
      solution01[r][c] ^= 1;
      const cost = shortfall(solution01);
      solution01[r][c] ^= 1;
      if (cost < base && (!best || cost < best.cost)) best = { r, c, cost };
    }
    return best ? { done: false, r: best.r, c: best.c, cost: best.cost, before: base } : null;
  }

  global.NonogramQuality = { TARGETS, measure, assess, isWarmUp, shortfall, improveStep };
})(typeof window !== 'undefined' ? window : globalThis);
