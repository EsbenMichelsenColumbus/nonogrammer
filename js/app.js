/*
 * Nonograms: game controller (library, play, hints, editor, settings).
 */
(function () {
  'use strict';

  const S = window.NonogramSolver;
  const H = window.NonogramHints;
  const { UNKNOWN, FILLED, EMPTY } = S;
  const $ = id => document.getElementById(id);

  // ===========================================================================
  // Storage (all access guarded: private windows may block it)
  // ===========================================================================
  const KEY = { settings: 'nono.v1.settings', progress: 'nono.v1.progress', custom: 'nono.v1.custom' };
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
  }

  const settings = Object.assign({ mistakes: 'idle', crosshair: true, greyClues: true }, load(KEY.settings, {}));
  let progress = load(KEY.progress, {});
  let customPuzzles = load(KEY.custom, []);

  // ===========================================================================
  // Puzzle registry
  // ===========================================================================
  const evalCache = new Map();
  function prepareCustom(p) {
    const solution = window.NonogramPuzzles.toMatrix(p.rows);
    return { ...p, width: p.rows[0].length, height: p.rows.length, solution, builtIn: false };
  }
  function allPuzzles() {
    return window.NonogramPuzzles.PUZZLES.concat(customPuzzles.map(prepareCustom));
  }
  function findPuzzle(id) { return allPuzzles().find(p => p.id === id); }
  function puzzleInfo(p) {
    const key = p.id + ':' + p.rows.join('');
    if (!evalCache.has(key)) evalCache.set(key, S.evaluatePuzzle(p.solution));
    return evalCache.get(key);
  }
  function displayName(p, index) {
    if (!p.builtIn) return p.name || 'My puzzle';
    const solved = progress[p.id] && progress[p.id].solved;
    return solved ? p.name : `Puzzle ${index + 1}`;
  }

  const encodeGrid = g => g.map(r => r.join('')).join('');
  const decodeGrid = (s, h, w) => Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => +s[r * w + c] || 0));

  // ===========================================================================
  // Navigation
  // ===========================================================================
  let currentView = 'library';
  function show(view) {
    currentView = view;
    ['library', 'game', 'editor'].forEach(v => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.topbar nav [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
    if (view === 'library') renderLibrary();
    if (view === 'editor') edBoard.fit();
    if (view === 'game') board.fit();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.nav === 'library') { saveGame(); show('library'); }
    else if (b.dataset.nav === 'editor') openEditor(null);
  }));

  // ===========================================================================
  // Toast & confirm
  // ===========================================================================
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function confirmBox(text, okLabel) {
    return new Promise(resolve => {
      const dlg = $('dlg-confirm');
      $('confirm-text').textContent = text;
      $('confirm-ok').textContent = okLabel || 'OK';
      dlg.returnValue = '';
      dlg.onclose = () => resolve(dlg.returnValue === 'ok');
      dlg.showModal();
    });
  }

  // ===========================================================================
  // Thumbnails
  // ===========================================================================
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function drawPicture(canvas, p, grid, mode) {
    const k = Math.max(2, Math.floor(160 / Math.max(p.width, p.height)));
    canvas.width = p.width * k; canvas.height = p.height * k;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = cssVar('--cross'); ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = cssVar('--filled');
    for (let r = 0; r < p.height; r++) for (let c = 0; c < p.width; c++) {
      const on = mode === 'solution' ? p.solution[r][c] : grid && grid[r][c] === FILLED;
      if (on) ctx.fillRect(c * k, r * k, k, k);
    }
  }

  // ===========================================================================
  // Library
  // ===========================================================================
  function fmtTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  function renderLibrary() {
    const root = $('library');
    root.innerHTML = '';
    const builtIns = window.NonogramPuzzles.PUZZLES;
    const groups = new Map();
    builtIns.forEach((p, i) => {
      const key = `${p.width} × ${p.height}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ p, i });
    });
    for (const [key, list] of groups) {
      const solvedCount = list.filter(({ p }) => progress[p.id] && progress[p.id].solved).length;
      root.appendChild(groupEl(`${key}`, `${solvedCount} of ${list.length} solved`, list));
    }
    const custom = customPuzzles.map(prepareCustom);
    const g = groupEl('Your puzzles', custom.length ? '' : '', custom.map((p, i) => ({ p, i })), true);
    if (!custom.length) {
      const note = document.createElement('p');
      note.className = 'empty-note';
      note.innerHTML = 'You haven’t made any puzzles yet. ';
      const b = document.createElement('button');
      b.className = 'small'; b.textContent = 'Create one';
      b.onclick = () => openEditor(null);
      note.appendChild(b);
      g.appendChild(note);
    }
    root.appendChild(g);
  }

  function groupEl(title, sub, list, custom) {
    const sec = document.createElement('section');
    sec.className = 'lib-group';
    sec.innerHTML = `<h2>${title} <span class="muted small-text">${sub}</span></h2>`;
    const grid = document.createElement('div');
    grid.className = 'lib-grid';
    list.forEach(({ p, i }) => grid.appendChild(cardEl(p, i, custom)));
    sec.appendChild(grid);
    return sec;
  }

  function cardEl(p, index, custom) {
    const pr = progress[p.id];
    const info = puzzleInfo(p);
    const card = document.createElement('div');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    const canvas = document.createElement('canvas');
    if (pr && pr.solved) drawPicture(canvas, p, null, 'solution');
    else drawPicture(canvas, p, pr ? decodeGrid(pr.g, p.height, p.width) : null, 'progress');
    card.appendChild(canvas);
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = displayName(p, index);
    card.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const diff = document.createElement('span');
    diff.className = 'diff-' + info.difficulty.split(' ')[0];
    diff.textContent = `${p.width}×${p.height} · ${info.difficulty}`;
    meta.appendChild(diff);
    const badge = document.createElement('span');
    if (pr && pr.solved) { badge.className = 'badge solved'; badge.textContent = '✓ ' + fmtTime(pr.t); }
    else if (pr && /[12]/.test(pr.g)) { badge.className = 'badge progress'; badge.textContent = 'In progress'; }
    if (badge.textContent) meta.appendChild(badge);
    card.appendChild(meta);
    const open = () => startGame(p.id);
    card.addEventListener('click', e => { if (!e.target.closest('button')) open(); });
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    if (custom) {
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.onclick = () => openEditor(p);
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.className = 'danger';
      del.onclick = async () => {
        if (!(await confirmBox(`Delete “${p.name}”? This can’t be undone.`, 'Delete'))) return;
        customPuzzles = customPuzzles.filter(x => x.id !== p.id);
        delete progress[p.id];
        store(KEY.custom, customPuzzles); store(KEY.progress, progress);
        renderLibrary();
      };
      actions.append(edit, del);
      card.appendChild(actions);
    }
    return card;
  }

  // ===========================================================================
  // Game
  // ===========================================================================
  const board = window.NonogramBoard.createBoard($('board'), $('board-wrap'), {
    onStrokeStart: gameStrokeStart,
    onStrokeEnd: gameStrokeEnd,
    crosshair: () => settings.crosshair,
  });

  let game = null; // { puzzle, clues, grid, undo, redo, time, hints, solved, hint }
  let tool = 'fill';

  function startGame(id) {
    const p = findPuzzle(id);
    if (!p) return;
    const pr = progress[p.id];
    const grid = pr ? decodeGrid(pr.g, p.height, p.width) : S.emptyGrid(p.height, p.width);
    const solutionGrid = p.solution.map(r => r.map(v => (v ? FILLED : EMPTY)));
    game = {
      puzzle: p,
      clues: S.cluesFromSolution(solutionGrid),
      grid,
      undo: [], redo: [],
      time: pr ? pr.t : 0,
      hints: pr ? pr.h || 0 : 0,
      solved: !!(pr && pr.solved),
      hint: null,
    };
    const index = window.NonogramPuzzles.PUZZLES.indexOf(p);
    $('game-title').textContent = displayName(p, index);
    $('game-meta').textContent = `${p.width}×${p.height} · ${puzzleInfo(p).difficulty}`;
    show('game');
    board.build(game.clues, p.height, p.width);
    board.renderGrid(grid);
    board.setSolved(game.solved);
    updateAllClues();
    closeHint();
    updateButtons();
    updateTimer();
    applyMistakeSetting();
  }

  function setTool(t) {
    tool = t;
    $('tool-fill').classList.toggle('active', t === 'fill');
    $('tool-x').classList.toggle('active', t === 'x');
    $('tool-fill').setAttribute('aria-checked', t === 'fill');
    $('tool-x').setAttribute('aria-checked', t === 'x');
  }
  $('tool-fill').onclick = () => setTool('fill');
  $('tool-x').onclick = () => setTool('x');

  // ----- strokes -------------------------------------------------------------
  function gameStrokeStart(r, c, button) {
    if (!game || game.solved) return null;
    const toolValue = button === 2 || tool === 'x' ? EMPTY : FILLED;
    const start = game.grid[r][c];
    const target = start === toolValue ? UNKNOWN : toolValue;
    const changes = new Map();
    return {
      changes,
      visit(rr, cc) {
        const key = rr * 1000 + cc;
        if (changes.has(key)) return;
        const cur = game.grid[rr][cc];
        const isStart = rr === r && cc === c;
        let ok;
        if (target === UNKNOWN) ok = cur === toolValue;          // erasing: only squares like the first one
        else ok = isStart ? cur !== target : cur === UNKNOWN;  // painting: never overwrite other marks
        if (!ok) return;
        changes.set(key, { r: rr, c: cc, from: cur, to: target });
        game.grid[rr][cc] = target;
        board.setCell(rr, cc, target);
        clearWrong(rr, cc);
      },
    };
  }

  function gameStrokeEnd(stroke) {
    if (!stroke.changes.size) return;
    commit([...stroke.changes.values()]);
  }

  /** Record a change list (already applied to the grid) and react to it. */
  function commit(changes) {
    game.undo.push(changes);
    if (game.undo.length > 500) game.undo.shift();
    game.redo = [];
    afterChange(changes);
  }

  function applyChanges(changes, dir) {
    for (const ch of changes) {
      const v = dir === 'undo' ? ch.from : ch.to;
      game.grid[ch.r][ch.c] = v;
      board.setCell(ch.r, ch.c, v);
      clearWrong(ch.r, ch.c);
    }
  }

  function undo() {
    if (!game || game.solved || !game.undo.length) return;
    const ch = game.undo.pop();
    applyChanges(ch, 'undo');
    game.redo.push(ch);
    afterChange(ch);
  }
  function redo() {
    if (!game || game.solved || !game.redo.length) return;
    const ch = game.redo.pop();
    applyChanges(ch, 'redo');
    game.undo.push(ch);
    afterChange(ch);
  }
  $('btn-undo').onclick = undo;
  $('btn-redo').onclick = redo;

  function afterChange(changes) {
    const rows = new Set(changes.map(x => x.r)), cols = new Set(changes.map(x => x.c));
    rows.forEach(r => updateClue('row', r));
    cols.forEach(c => updateClue('col', c));
    closeHint();
    updateButtons();
    scheduleMistakeCheck();
    if (checkWin()) return;
    saveGame();
  }

  function updateButtons() {
    const active = game && !game.solved;
    $('btn-undo').disabled = !active || !game.undo.length;
    $('btn-redo').disabled = !active || !game.redo.length;
    $('btn-hint').disabled = !active;
    $('btn-check').disabled = !active;
    $('btn-restart').disabled = !game;
    $('stat-hints').textContent = `Hints used: ${game ? game.hints : 0}`;
  }

  // ----- clues ---------------------------------------------------------------
  function updateClue(type, idx) {
    const line = S.getLine(game.grid, type, idx);
    const target = type === 'row' ? game.clues.rows[idx] : game.clues.cols[idx];
    const got = S.cluesFromLine(line);
    const done = settings.greyClues && got.length === target.length && got.every((v, i) => v === target[i]);
    board.setClueDone(type, idx, done);
  }
  function updateAllClues() {
    for (let r = 0; r < game.puzzle.height; r++) updateClue('row', r);
    for (let c = 0; c < game.puzzle.width; c++) updateClue('col', c);
  }

  // ----- mistakes ------------------------------------------------------------
  let mistakeTimer = null;
  function wrongCells() {
    const out = [];
    const sol = game.puzzle.solution;
    game.grid.forEach((row, r) => row.forEach((v, c) => {
      if ((v === FILLED && !sol[r][c]) || (v === EMPTY && sol[r][c])) out.push({ r, c, v });
    }));
    return out;
  }
  function showMistakes() {
    board.clearClass('wrong');
    const wrong = wrongCells();
    wrong.forEach(({ r, c }) => board.cellEl(r, c).classList.add('wrong'));
    return wrong.length;
  }
  function clearWrong(r, c) { const el = board.cellEl(r, c); if (el) el.classList.remove('wrong'); }
  function scheduleMistakeCheck() {
    clearTimeout(mistakeTimer);
    if (settings.mistakes === 'idle' && game && !game.solved) mistakeTimer = setTimeout(showMistakes, 3000);
  }
  function applyMistakeSetting() {
    $('btn-check').hidden = settings.mistakes !== 'manual';
    clearTimeout(mistakeTimer);
    if (!game) return;
    if (settings.mistakes === 'never') board.clearClass('wrong');
    else if (settings.mistakes === 'idle' && !game.solved) showMistakes();
  }
  $('btn-check').onclick = () => {
    if (!game || game.solved) return;
    const n = showMistakes();
    toast(n ? `${n} ${n === 1 ? 'square is' : 'squares are'} wrong (shown in red).` : 'No mistakes so far ✓');
  };

  // ----- restart -------------------------------------------------------------
  $('btn-restart').onclick = async () => {
    if (!game) return;
    if (!(await confirmBox('Start this puzzle again? Your progress and time on it will be cleared.', 'Restart'))) return;
    delete progress[game.puzzle.id];
    store(KEY.progress, progress);
    startGame(game.puzzle.id);
  };

  // ----- win -----------------------------------------------------------------
  function checkWin() {
    const sol = game.puzzle.solution;
    for (let r = 0; r < game.puzzle.height; r++) for (let c = 0; c < game.puzzle.width; c++) {
      if ((game.grid[r][c] === FILLED) !== !!sol[r][c]) return false;
    }
    game.solved = true;
    clearTimeout(mistakeTimer);
    board.clearClass('wrong');
    board.setSolved(true);
    closeHint();
    updateButtons();
    saveGame();
    const p = game.puzzle;
    setTimeout(() => {
      drawPicture($('win-canvas'), p, null, 'solution');
      $('win-title').textContent = p.builtIn ? `Solved: ${p.name}!` : `Solved: ${p.name || 'your puzzle'}!`;
      $('win-stats').textContent = `Time ${fmtTime(game.time)} · ${game.hints === 0 ? 'no hints' : game.hints === 1 ? '1 hint' : game.hints + ' hints'}`;
      $('game-title').textContent = displayName(p, window.NonogramPuzzles.PUZZLES.indexOf(p));
      $('dlg-win').showModal();
    }, 450);
    return true;
  }
  $('win-library').onclick = () => { $('dlg-win').close(); show('library'); };
  $('win-next').onclick = () => {
    $('dlg-win').close();
    const list = allPuzzles();
    const i = list.findIndex(p => p.id === game.puzzle.id);
    const ordered = list.slice(i + 1).concat(list.slice(0, i));
    const next = ordered.find(p => !(progress[p.id] && progress[p.id].solved)) || ordered[0];
    if (next) startGame(next.id); else show('library');
  };

  // ----- save & timer --------------------------------------------------------
  function saveGame() {
    if (!game) return;
    progress[game.puzzle.id] = { g: encodeGrid(game.grid), t: Math.floor(game.time), h: game.hints, solved: game.solved };
    store(KEY.progress, progress);
  }
  function updateTimer() { $('timer').textContent = game ? fmtTime(game.time) : '0:00'; }
  let tickCount = 0;
  setInterval(() => {
    if (!game || game.solved || currentView !== 'game' || document.hidden) return;
    if (document.querySelector('dialog[open]')) return;
    game.time += 1;
    updateTimer();
    if (++tickCount % 10 === 0) saveGame();
  }, 1000);
  window.addEventListener('beforeunload', saveGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

  // ===========================================================================
  // Hints
  // ===========================================================================
  function closeHint() {
    if (game) game.hint = null;
    $('hint-panel').hidden = true;
    board.clearClass('hint-line', 'hint-cell', 'hint-f', 'hint-x');
  }
  $('hint-close').onclick = closeHint;

  function mistakeHint(wrong) {
    const m = wrong[0];
    const what = m.v === FILLED ? 'is filled but should be empty' : 'is marked empty but should be filled';
    const n = wrong.length;
    return {
      kind: 'mistake',
      title: 'Check your marks',
      level1: `Before the next step, something needs fixing: there is a mistake in Row ${m.r + 1}.`,
      level2: `The square at ${H.cellName(m.r, m.c)} ${what}.`,
      level3: `Hints can only reason from correct marks. ${n === 1 ? 'This is the only mistake' : `There are ${n} mistakes in total`}. Remove ${n === 1 ? 'it' : 'them'} and ask for another hint.`,
      focus: { type: 'row', idx: m.r },
      focus2: { cell: m },
      applyLabel: n === 1 ? 'Remove the mistake' : `Remove all ${n} mistakes`,
      wrong,
    };
  }

  function requestHint() {
    if (!game || game.solved) return;
    if (game.hint && game.hint.level < 3) { game.hint.level++; renderHint(); return; }
    if (game.hint) return; // already fully shown
    const wrong = wrongCells();
    let hint;
    if (wrong.length) {
      hint = mistakeHint(wrong);
    } else {
      const step = S.findNextStep(game.grid, game.clues);
      if (step.technique === 'stuck' || step.technique === 'invalid' || step.technique === 'solved') {
        hint = { kind: 'none', title: 'Hint', level1: 'No logical step found from here. Try removing a few recent marks.', level2: '', level3: '' };
      } else {
        hint = Object.assign({ kind: 'step', title: 'Hint' }, H.buildHint(step));
      }
    }
    hint.level = 1;
    game.hint = hint;
    game.hints++;
    updateButtons();
    saveGame();
    renderHint();
  }
  $('btn-hint').onclick = requestHint;
  $('hint-more').onclick = requestHint;

  function renderHint() {
    const h = game.hint;
    if (!h) return;
    $('hint-panel').hidden = false;
    $('hint-title').textContent = h.kind === 'step' ? `Hint · ${h.techniqueName}` : h.title;
    if (h.kind === 'step' && h.level < 2) $('hint-title').textContent = 'Hint';
    const parts = [];
    parts.push(`<p class="hint-level"><span class="lvl">Where to look</span>${h.level1}</p>`);
    if (h.level >= 2 && h.level2) parts.push(`<p class="hint-level"><span class="lvl">${h.kind === 'mistake' ? 'Which square' : 'Technique'}</span>${h.level2}</p>`);
    if (h.level >= 3 && h.level3) {
      parts.push(`<div class="hint-level"><span class="lvl">${h.kind === 'mistake' ? 'What to do' : 'Why'}</span>${h.level3}${h.diagram ? `<div class="diagram">${h.diagram}</div>` : ''}</div>`);
    }
    $('hint-body').innerHTML = parts.join('');
    const more = h.kind !== 'none' && h.level < 3;
    $('hint-more').hidden = !more;
    $('hint-more').textContent = h.level === 1 ? 'Which technique?' : 'Explain it';
    if (h.kind === 'mistake') $('hint-more').textContent = h.level === 1 ? 'Which square?' : 'What do I do?';
    const canApply = h.level >= 3 && (h.kind === 'step' || h.kind === 'mistake');
    $('hint-apply').hidden = !canApply;
    $('hint-apply').textContent = h.kind === 'mistake' ? h.applyLabel : 'Apply to board';

    // board highlights
    board.clearClass('hint-line', 'hint-cell', 'hint-f', 'hint-x');
    const f = h.focus;
    if (f && f.type) board.lineEls(f.type, f.idx).forEach(el => el.classList.add('hint-line'));
    if (f && f.cell) board.cellEl(f.cell.r, f.cell.c).classList.add('hint-cell');
    if (h.kind === 'mistake' && h.level >= 2) h.wrong.slice(0, h.level >= 3 ? h.wrong.length : 1)
      .forEach(m => board.cellEl(m.r, m.c).classList.add('hint-cell'));
    if (h.kind === 'step' && h.level >= 3) {
      h.cells.forEach(({ r, c, v }) => board.cellEl(r, c).classList.add('hint-cell', v === FILLED ? 'hint-f' : 'hint-x'));
    }
    if ($('hint-panel').getBoundingClientRect().top > window.innerHeight) {
      $('hint-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  $('hint-apply').onclick = () => {
    const h = game && game.hint;
    if (!h) return;
    let changes;
    if (h.kind === 'mistake') {
      changes = h.wrong.map(({ r, c }) => ({ r, c, from: game.grid[r][c], to: UNKNOWN }));
    } else {
      changes = h.cells.filter(({ r, c }) => game.grid[r][c] === UNKNOWN)
        .map(({ r, c, v }) => ({ r, c, from: UNKNOWN, to: v }));
    }
    if (!changes.length) { closeHint(); return; }
    applyChanges(changes, 'redo');
    commit(changes);
  };

  // ===========================================================================
  // Editor
  // ===========================================================================
  const edBoard = window.NonogramBoard.createBoard($('editor-board'), $('editor-wrap'), {
    onStrokeStart: edStrokeStart,
    onStrokeEnd: () => {},
    crosshair: () => settings.crosshair,
  });
  let ed = { w: 10, h: 10, grid: null, editingId: null, checked: null };

  function edClues() {
    return S.cluesFromSolution(ed.grid.map(r => r.map(v => (v ? FILLED : EMPTY))));
  }
  function edRender(rebuild) {
    const clues = edClues();
    if (rebuild) edBoard.build(clues, ed.h, ed.w); else edBoard.setClues(clues);
    for (let r = 0; r < ed.h; r++) for (let c = 0; c < ed.w; c++) edBoard.setCell(r, c, ed.grid[r][c] ? FILLED : UNKNOWN);
    if (!rebuild) edBoard.fit();
  }
  function edDirty() {
    ed.checked = null;
    $('ed-save').disabled = true;
    $('ed-result').hidden = true;
    edBoard.clearClass('alt-diff', 'stuck');
  }
  function edStrokeStart(r, c, button) {
    const target = button === 2 ? 0 : (ed.grid[r][c] ? 0 : 1);
    return {
      visit(rr, cc) {
        if (ed.grid[rr][cc] === target) return;
        ed.grid[rr][cc] = target;
        edBoard.setCell(rr, cc, target ? FILLED : UNKNOWN);
        edBoard.setClues(edClues());
        edDirty();
      },
    };
  }

  function openEditor(p) {
    if (p) {
      ed = { w: p.width, h: p.height, grid: p.solution.map(r => r.slice()), editingId: p.id, checked: null };
      $('ed-name').value = p.name || '';
    } else {
      ed = { w: 10, h: 10, grid: Array.from({ length: 10 }, () => new Array(10).fill(0)), editingId: null, checked: null };
      $('ed-name').value = '';
    }
    $('ed-w').value = ed.w; $('ed-h').value = ed.h;
    show('editor');
    edRender(true);
    edDirty();
  }

  $('ed-resize').onclick = () => {
    const w = Math.max(3, Math.min(25, +$('ed-w').value || 10));
    const h = Math.max(3, Math.min(25, +$('ed-h').value || 10));
    $('ed-w').value = w; $('ed-h').value = h;
    ed.grid = Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => (ed.grid[r] && ed.grid[r][c]) || 0));
    ed.w = w; ed.h = h;
    edRender(true); edDirty();
  };
  $('ed-clear').onclick = () => { ed.grid = ed.grid.map(r => r.map(() => 0)); edRender(false); edDirty(); };
  $('ed-invert').onclick = () => { ed.grid = ed.grid.map(r => r.map(v => (v ? 0 : 1))); edRender(false); edDirty(); };

  $('ed-check').onclick = () => {
    const res = $('ed-result');
    edBoard.clearClass('alt-diff', 'stuck');
    if (!ed.grid.some(r => r.some(Boolean))) {
      res.className = 'ed-result bad'; res.hidden = false;
      res.textContent = 'Draw something first.';
      return;
    }
    const ev = S.evaluatePuzzle(ed.grid);
    res.hidden = false;
    if (!ev.unique) {
      res.className = 'ed-result bad';
      res.innerHTML = '<b>More than one solution.</b> The squares outlined in red could also be drawn differently and still match the clues. Change the picture around them.';
      if (ev.altSolution) ev.altSolution.forEach((row, r) => row.forEach((v, c) => {
        if ((v === FILLED) !== !!ed.grid[r][c]) edBoard.cellEl(r, c).classList.add('alt-diff');
      }));
    } else if (!ev.logical) {
      res.className = 'ed-result bad';
      res.innerHTML = '<b>Needs guessing.</b> The puzzle has one solution, but the hint techniques get stuck on the highlighted squares. Adjust the picture there.';
      const ls = S.logicalSolve(ev.clues, ed.h, ed.w);
      ls.grid.forEach((row, r) => row.forEach((v, c) => { if (v === UNKNOWN) edBoard.cellEl(r, c).classList.add('stuck'); }));
    } else {
      res.className = 'ed-result good';
      res.innerHTML = `<b>✓ Good puzzle.</b> One solution, solvable without guessing. Difficulty: <b>${ev.difficulty}</b>.`;
      ed.checked = ev;
    }
    $('ed-save').disabled = !ed.checked;
  };

  $('ed-save').onclick = () => {
    if (!ed.checked) return;
    const name = $('ed-name').value.trim() || 'My puzzle';
    const rows = ed.grid.map(r => r.map(v => (v ? '#' : '.')).join(''));
    const id = ed.editingId || 'c-' + Date.now().toString(36);
    const entry = { id, name, rows };
    const i = customPuzzles.findIndex(p => p.id === id);
    if (i >= 0) customPuzzles[i] = entry; else customPuzzles.push(entry);
    delete progress[id];
    store(KEY.custom, customPuzzles); store(KEY.progress, progress);
    startGame(id);
  };

  // ----- codes ---------------------------------------------------------------
  function encodePuzzle(name, grid) {
    const bits = grid.flat().map(v => (v ? 1 : 0));
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += ((bits[i] << 3) | ((bits[i + 1] || 0) << 2) | ((bits[i + 2] || 0) << 1) | (bits[i + 3] || 0)).toString(16);
    }
    return `NONO1.${grid[0].length}x${grid.length}.${hex}.${encodeURIComponent(name || '')}`;
  }
  function decodePuzzle(code) {
    const m = /^NONO1\.(\d+)x(\d+)\.([0-9a-f]+)\.?(.*)$/i.exec(code.trim());
    if (!m) throw new Error('That doesn’t look like a puzzle code.');
    const w = +m[1], h = +m[2];
    if (w < 3 || h < 3 || w > 25 || h > 25) throw new Error('Puzzle size must be between 3 and 25.');
    const bits = [];
    for (const ch of m[3]) { const n = parseInt(ch, 16); bits.push((n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1); }
    if (bits.length < w * h) throw new Error('The code is incomplete.');
    const grid = Array.from({ length: h }, (_, r) => bits.slice(r * w, r * w + w));
    let name = '';
    try { name = decodeURIComponent(m[4] || ''); } catch (_) { name = ''; }
    return { name, grid };
  }

  function codeDialog({ title, help, text, readOnly }) {
    return new Promise(resolve => {
      const dlg = $('dlg-code');
      $('code-title').textContent = title;
      $('code-help').textContent = help;
      $('code-text').value = text || '';
      $('code-text').readOnly = !!readOnly;
      $('code-error').hidden = true;
      dlg.returnValue = '';
      dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('code-text').value : null);
      dlg.showModal();
      if (readOnly) $('code-text').select(); else $('code-text').focus();
    });
  }

  $('ed-export').onclick = async () => {
    const code = encodePuzzle($('ed-name').value.trim(), ed.grid);
    let copied = false;
    try { await navigator.clipboard.writeText(code); copied = true; } catch (_) { /* ignore */ }
    await codeDialog({
      title: 'Puzzle code',
      help: copied ? 'Copied to the clipboard. Send it to someone so they can paste it into their editor.' : 'Copy this code and send it to someone so they can paste it into their editor.',
      text: code, readOnly: true,
    });
  };
  $('ed-import').onclick = async () => {
    const text = await codeDialog({ title: 'Paste a puzzle code', help: 'Paste a code that starts with NONO1.', text: '' });
    if (text == null) return;
    try {
      const { name, grid } = decodePuzzle(text);
      ed = { w: grid[0].length, h: grid.length, grid, editingId: null, checked: null };
      $('ed-name').value = name; $('ed-w').value = ed.w; $('ed-h').value = ed.h;
      edRender(true); edDirty();
      toast('Puzzle loaded. Check it, then save it to play.');
    } catch (err) {
      toast(err.message);
    }
  };

  // ===========================================================================
  // Settings
  // ===========================================================================
  $('btn-settings').onclick = () => {
    document.querySelectorAll('input[name="mistakes"]').forEach(i => { i.checked = i.value === settings.mistakes; });
    $('set-crosshair').checked = settings.crosshair;
    $('set-greyclues').checked = settings.greyClues;
    $('dlg-settings').showModal();
  };
  document.querySelectorAll('input[name="mistakes"]').forEach(i => i.addEventListener('change', () => {
    settings.mistakes = i.value; store(KEY.settings, settings); applyMistakeSetting();
  }));
  $('set-crosshair').onchange = e => { settings.crosshair = e.target.checked; store(KEY.settings, settings); };
  $('set-greyclues').onchange = e => {
    settings.greyClues = e.target.checked; store(KEY.settings, settings);
    if (game) updateAllClues();
  };
  $('btn-reset-all').onclick = async () => {
    $('dlg-settings').close();
    if (!(await confirmBox('Clear progress and times for every puzzle? Your own puzzles are kept.', 'Reset progress'))) return;
    progress = {};
    store(KEY.progress, progress);
    if (game) startGame(game.puzzle.id);
    if (currentView === 'library') renderLibrary();
    toast('All progress cleared.');
  };

  // ===========================================================================
  // Keyboard & resize
  // ===========================================================================
  document.addEventListener('keydown', e => {
    if (currentView !== 'game' || document.querySelector('dialog[open]')) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === 'h') requestHint();
    else if (k === 'f') setTool('fill');
    else if (k === 'x') setTool('x');
    else if (k === 'escape') closeHint();
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentView === 'game') board.fit(); if (currentView === 'editor') edBoard.fit(); }, 100);
  });

  // ===========================================================================
  // Start
  // ===========================================================================
  updateButtons();
  show('library');

  // read-only handle for debugging in the browser console
  window.__nonogram = { get game() { return game; }, get settings() { return settings; } };
})();
