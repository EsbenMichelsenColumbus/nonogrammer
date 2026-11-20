/*
 * Turns solver steps into plain-English hints with small diagrams.
 *
 * Each hint has three levels:
 *   1. where to look (a row, column or square)
 *   2. which technique to use there
 *   3. the full explanation, the squares it proves, and a diagram
 */
(function (global) {
  'use strict';

  const S = global.NonogramSolver;
  const { FILLED, EMPTY, UNKNOWN, TECHNIQUES } = S;

  // ---------------------------------------------------------------------------
  // Wording helpers
  // ---------------------------------------------------------------------------
  const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function lineName(type, idx) { return (type === 'row' ? 'Row ' : 'Column ') + (idx + 1); }
  function lineNameLower(type, idx) { return (type === 'row' ? 'row ' : 'column ') + (idx + 1); }
  function posWord(type, plural) { return type === 'row' ? (plural ? 'columns' : 'column') : (plural ? 'rows' : 'row'); }
  function pos(type, i) { return `${posWord(type)} ${i + 1}`; }
  function range(type, a, b) { return a === b ? pos(type, a) : `${posWord(type, true)} ${a + 1}–${b + 1}`; }
  function startWord(type) { return type === 'row' ? 'left' : 'top'; }
  function endWord(type) { return type === 'row' ? 'right' : 'bottom'; }
  function clueText(clues) { return clues.length ? clues.join(' ') : '0'; }
  /** "the clue 3" / "the clues 2 1" */
  function cluesPhrase(clues) { return (clues.length > 1 ? 'the clues ' : 'the clue ') + clueText(clues); }
  function squares(n) { return n === 1 ? '1 square' : `${n} squares`; }
  function cellName(r, c) { return `row ${r + 1}, column ${c + 1}`; }

  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  /** Group indices into consecutive ranges and describe them. */
  function rangesText(type, indices) {
    const sorted = [...indices].sort((a, b) => a - b);
    const groups = [];
    for (const i of sorted) {
      const g = groups[groups.length - 1];
      if (g && g[1] === i - 1) g[1] = i; else groups.push([i, i]);
    }
    const words = groups.map(([a, b]) => (a === b ? String(a + 1) : `${a + 1}–${b + 1}`));
    const plural = sorted.length > 1;
    return `${posWord(type, plural)} ${listJoin(words)}`;
  }

  function blockName(clues, b) {
    const L = clues[b];
    if (clues.filter(x => x === L).length === 1) return `the ${L}-block`;
    return `the ${ORDINALS[b] || (b + 1) + 'th'} block (${L})`;
  }

  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------------------------------------------------------------------------
  // Diagrams: a line drawn as a strip of small squares
  // ---------------------------------------------------------------------------
  const BLOCK_COLOURS = 6;

  /** cells: [{ cls, text }] */
  function strip(label, cells) {
    return `<div class="strip"><div class="strip-label">${esc(label)}</div><div class="strip-cells">${
      cells.map(c => `<span class="sc ${c.cls || ''}">${c.text != null ? esc(c.text) : ''}</span>`).join('')
    }</div></div>`;
  }

  function lineStrip(label, line, highlight) {
    const hl = new Set(highlight || []);
    return strip(label, line.map((v, i) => ({
      cls: (v === FILLED ? 'f' : v === EMPTY ? 'x' : 'u') + (hl.has(i) ? ' hl' : ''),
    })));
  }

  function arrangementStrip(label, clues, starts, n) {
    const owner = new Array(n).fill(-1);
    clues.forEach((L, b) => { for (let j = 0; j < L; j++) owner[starts[b] + j] = b; });
    return strip(label, owner.map((b, i) => (b < 0
      ? { cls: 'x' }
      : { cls: `blk b${b % BLOCK_COLOURS}`, text: owner[i - 1] === b ? '' : clues[b] })));
  }

  function resultStrip(line, cells) {
    const after = line.slice();
    const changed = cells.map(x => x.i);
    cells.forEach(({ i, v }) => { after[i] = v; });
    return lineStrip('After', after, changed);
  }

  function enumerateArrangements(clues, line, limit) {
    const n = line.length, out = [];
    let total = 0;
    const starts = [];
    function rec(b, from) {
      if (b === clues.length) {
        for (let c = from; c < n; c++) if (line[c] === FILLED) return;
        total++;
        if (out.length < limit) out.push(starts.slice());
        return;
      }
      const L = clues[b];
      for (let s = from; s + L <= n; s++) {
        // squares skipped before this block must be allowed to be empty
        if (s > from && line[s - 1] === FILLED) break;
        let fits = true;
        for (let j = s; j < s + L; j++) if (line[j] === EMPTY) { fits = false; break; }
        if (!fits) continue;
        if (s + L < n && line[s + L] === FILLED) continue;
        starts[b] = s;
        rec(b + 1, s + L + 1);
        if (total > 5000) return;
      }
    }
    rec(0, 0);
    return { arrangements: out, total };
  }

  // ---------------------------------------------------------------------------
  // Explanations per technique
  // ---------------------------------------------------------------------------
  function describeCells(step) {
    const filled = step.lineCells.filter(x => x.v === FILLED).map(x => x.i);
    const empty = step.lineCells.filter(x => x.v === EMPTY).map(x => x.i);
    return { filled, empty };
  }

  function provesText(type, filled, empty) {
    const parts = [];
    if (filled.length) parts.push(`fill ${rangesText(type, filled)}`);
    if (empty.length) parts.push(`mark ${rangesText(type, empty)} as empty`);
    return capital(listJoin(parts)) + '.';
  }

  const explainers = {
    'empty-line'(step) {
      const N = lineName(step.type, step.idx);
      return {
        text: `${N} has the clue 0, so it contains no filled squares at all. Every square in it is empty.`,
        diagram: resultStrip(step.line, step.lineCells),
      };
    },

    'perfect-fit'(step) {
      const { clues, line, type } = step;
      const n = line.length, total = clues.reduce((a, b) => a + b, 0);
      const N = lineName(type, step.idx);
      const gaps = clues.length - 1;
      if (clues.length === 1) {
        return {
          text: `${N} has a single block of ${total}, and the line is exactly ${n} squares long. The block fills the whole line.`,
          diagram: arrangementStrip('Only fit', clues, step.data.starts, n) + resultStrip(line, step.lineCells),
        };
      }
      return {
        text: `${N} has the clues ${clueText(clues)}. The blocks need ${clues.join(' + ')} = ${total} squares` +
          (gaps ? `, plus ${gaps} empty ${gaps === 1 ? 'square' : 'squares'} between them` : '') +
          `, which is ${total + gaps} squares: exactly the length of the line. There is only one way to place them.`,
        diagram: arrangementStrip('Only fit', clues, step.data.starts, n) + resultStrip(line, step.lineCells),
      };
    },

    'line-complete'(step) {
      const { clues, type } = step;
      const N = lineName(type, step.idx);
      const total = step.data.total;
      return {
        text: `${N} needs ${clues.length > 1 ? clues.join(' + ') + ' = ' : ''}${total} filled ${total === 1 ? 'square' : 'squares'}, and ` +
          `${total === 1 ? 'it is' : total === 2 ? 'both are' : `all ${total} are`} already filled. ` +
          `Every other square in ${lineNameLower(type, step.idx)} must be empty.`,
        diagram: resultStrip(step.line, step.lineCells),
      };
    },

    'overlap'(step) {
      const { clues, line, type, data } = step;
      const n = line.length;
      const N = lineName(type, step.idx);
      const minLen = clues.reduce((a, b) => a + b, 0) + clues.length - 1;
      let text = `${N} is ${n} squares long. ${capital(cluesPhrase(clues))} ${clues.length > 1 ? 'need' : 'needs'} at least ${minLen} squares` +
        (clues.length > 1 ? ` (the blocks plus one empty square between each)` : '') +
        `, leaving ${squares(data.slack)} of room to move. `;
      const parts = data.blocks.map(({ block, from, to }) => {
        const L = clues[block];
        const l = data.left[block], r = data.right[block];
        return `Pushed all the way to the ${startWord(type)}, ${blockName(clues, block)} covers ${range(type, l, l + L - 1)}; ` +
          `pushed all the way to the ${endWord(type)}, it covers ${range(type, r, r + L - 1)}. ` +
          `Either way it covers ${range(type, from, to)}, so ${from === to ? 'that square' : 'those squares'} must be filled.`;
      });
      text += parts.join(' ');
      return {
        text,
        diagram: arrangementStrip(`Pushed ${startWord(type)}`, clues, data.left, n) +
          arrangementStrip(`Pushed ${endWord(type)}`, clues, data.right, n) +
          resultStrip(line, step.lineCells),
      };
    },

    'gap-too-small'(step) {
      const { type, data } = step;
      const N = lineName(type, step.idx);
      const gapTexts = data.gaps.map(g => `${range(type, g.from, g.to)} ${g.len === 1 ? 'is a gap of only 1 square' : `form a gap of only ${g.len} squares`}`);
      return {
        text: `In ${N}, ${listJoin(gapTexts)}, closed in by empty squares or the edge of the grid. ` +
          `The smallest block in this line is ${data.minClue}, so no block fits there. ` +
          `${data.gaps.length === 1 && data.gaps[0].len === 1 ? 'That square' : 'Those squares'} must be empty.`,
        diagram: lineStrip('Now', step.line, step.lineCells.map(x => x.i)) + resultStrip(step.line, step.lineCells),
      };
    },

    'block-complete'(step) {
      const { clues, type, data } = step;
      const N = lineName(type, step.idx);
      const parts = data.runs.map(run => {
        let why;
        if (run.isMax) {
          why = `No block in ${lineNameLower(type, step.idx)} is longer than ${run.len}, so this run is already a complete block.`;
        } else {
          const names = listJoin(run.candidates.map(b => blockName(clues, b)));
          why = `Given where it is, it can only be ${names}, which is exactly ${run.len} long, so the block is complete.`;
        }
        return `The filled run at ${range(type, run.from, run.to)} is ${run.len} long. ${why}`;
      });
      return {
        text: `In ${N}: ${parts.join(' ')} A complete block must have an empty square on each side.`,
        diagram: lineStrip('Now', step.line, data.runs.flatMap(r => {
          const out = []; for (let i = r.from; i <= r.to; i++) out.push(i); return out;
        })) + resultStrip(step.line, step.lineCells),
      };
    },

    'constrained-overlap'(step) {
      const { clues, line, type, data } = step;
      const n = line.length;
      const N = lineName(type, step.idx);
      const parts = data.blocks.map(({ block, from, to }) => {
        const L = clues[block];
        const e = data.earliest[block], l = data.latest[block];
        if (e === l) {
          return `${capital(blockName(clues, block))} has only one possible position: ${range(type, e, e + L - 1)}, so it must be filled there.`;
        }
        return `${capital(blockName(clues, block))} can start no earlier than ${pos(type, e)} (covering ${range(type, e, e + L - 1)}) ` +
          `and no later than ${pos(type, l)} (covering ${range(type, l, l + L - 1)}). ` +
          `Both positions cover ${range(type, from, to)}, so ${from === to ? 'it' : 'they'} must be filled.`;
      });
      return {
        text: `Look at the squares already filled and crossed out in ${N}. They limit where each block can go. ${parts.join(' ')}`,
        diagram: lineStrip('Now', line) +
          arrangementStrip('Earliest', clues, data.earliest, n) +
          arrangementStrip('Latest', clues, data.latest, n) +
          resultStrip(line, step.lineCells),
      };
    },

    'unreachable'(step) {
      const { clues, line, type, data } = step;
      const n = line.length;
      const N = lineName(type, step.idx);
      const reach = clues.map((L, b) => `${blockName(clues, b)} stays within ${range(type, data.earliest[b], data.latest[b] + L - 1)}`);
      const idx = step.lineCells.map(x => x.i);
      return {
        text: `Using the squares already marked in ${N}, each block can only move within a limited range: ${listJoin(reach)}. ` +
          `No block can reach ${rangesText(type, idx)}, so ${idx.length === 1 ? 'it' : 'they'} must be empty.`,
        diagram: lineStrip('Now', line) +
          arrangementStrip('Earliest', clues, data.earliest, n) +
          arrangementStrip('Latest', clues, data.latest, n) +
          resultStrip(line, step.lineCells),
      };
    },

    'line-analysis'(step) {
      const { clues, line, type } = step;
      const N = lineName(type, step.idx);
      const { filled, empty } = describeCells(step);
      const en = enumerateArrangements(clues, line, 4);
      const statements = [];
      if (filled.length) statements.push(`${rangesText(type, filled)} ${filled.length === 1 ? 'is' : 'are'} filled in every one of them`);
      if (empty.length) statements.push(`${rangesText(type, empty)} ${empty.length === 1 ? 'is' : 'are'} empty in every one of them`);
      let diagram = lineStrip('Now', line);
      en.arrangements.forEach((st, k) => { diagram += arrangementStrip(`Option ${k + 1}`, clues, st, line.length); });
      if (en.total > en.arrangements.length) diagram += `<div class="strip-more">…and ${en.total - en.arrangements.length} more</div>`;
      diagram += resultStrip(line, step.lineCells);
      return {
        text: `None of the simpler patterns works in ${N}, so list every way ${cluesPhrase(clues)} can fit with the squares already marked. ` +
          `There ${en.total === 1 ? 'is only 1 way' : `are ${en.total} ways`}, and ${listJoin(statements)}.`,
        diagram,
      };
    },

    'contradiction'(step) {
      const d = step.data;
      const assumedWord = d.assumed === FILLED ? 'filled' : 'empty';
      const actualWord = d.assumed === FILLED ? 'empty' : 'filled';
      const shown = d.steps.slice(0, 6).map(st => {
        const at = x => (st.type === 'row' ? x.c : x.r);
        const f = st.cells.filter(x => x.v === FILLED).map(at);
        const e = st.cells.filter(x => x.v === EMPTY).map(at);
        const bits = [];
        if (f.length) bits.push(`${rangesText(st.type, f)} filled`);
        if (e.length) bits.push(`${rangesText(st.type, e)} empty`);
        return `<li>${lineName(st.type, st.idx)} would then need ${listJoin(bits)}.</li>`;
      });
      const more = d.steps.length > 6 ? `<li>…and ${d.steps.length - 6} more forced moves.</li>` : '';
      const fl = d.failedLine;
      const html =
        `No line can be solved on its own right now, so try an assumption. ` +
        `Suppose the square at ${cellName(d.r, d.c)} were <b>${assumedWord}</b>.` +
        (shown.length ? ` Following the clues from there:<ul>${shown.join('')}${more}</ul>` : ' ') +
        `Then ${lineName(fl.type, fl.idx)} (${cluesPhrase(d.failedClues).replace('the ', '')}) could no longer be completed. ` +
        `The assumption leads to an impossible line, so the square at ${cellName(d.r, d.c)} must be <b>${actualWord}</b>.`;
      return { html, diagram: '' };
    },
  };

  // ---------------------------------------------------------------------------
  // Public: build the three-level hint for a solver step
  // ---------------------------------------------------------------------------
  function buildHint(step) {
    const tech = TECHNIQUES[step.technique];
    let where, focus;
    if (step.technique === 'contradiction') {
      const d = step.data;
      where = `Look at the square at ${cellName(d.r, d.c)}. What would happen if it were ${d.assumed === FILLED ? 'filled' : 'empty'}?`;
      focus = { cell: { r: d.r, c: d.c } };
    } else {
      where = `Look at ${lineName(step.type, step.idx)} (${step.clues.length > 1 ? 'clues' : 'clue'} ${clueText(step.clues)}).`;
      focus = { type: step.type, idx: step.idx };
    }
    const ex = explainers[step.technique](step);
    let body = ex.html || esc(ex.text);
    if (step.technique !== 'contradiction') {
      const { filled, empty } = describeCells(step);
      body += `<p class="proves">${esc(provesText(step.type, filled, empty))}</p>`;
    }
    return {
      technique: step.technique,
      techniqueName: tech.name,
      level1: where,
      level2: `Try the <b>${esc(tech.name)}</b> technique. ${esc(tech.summary)}`,
      level3: body,
      diagram: ex.diagram,
      focus,
      cells: step.cells,
    };
  }

  global.NonogramHints = { buildHint, lineName, cellName, clueText };
})(typeof window !== 'undefined' ? window : globalThis);
