# Nonograms

A browser nonogram game whose hints teach you how to solve, instead of just revealing squares.

## Play

Double-click `index.html`. It runs in any modern browser with no install or build step. Progress, settings and your own puzzles are saved in the browser.

- **Fill / Mark empty**: switch tools, or left-click to fill and right-click to mark a square empty. Drag to paint a whole run in one row or column.
- **Keys**: `H` hint, `F` fill tool, `X` mark-empty tool, `Ctrl+Z` / `Ctrl+Y` undo and redo, `Esc` close the hint.
- **Mistakes** (in ⚙ Settings): shown in red after a pause without a move (10 seconds by default; 5 seconds to 1 minute), only when you press Check, or never.
- **Finished clue numbers** grey out once their block is filled, can only be in that place, and is closed off by an X (or the edge) on both sides.
- **Zoom**: the −, Fit and + buttons above the board, or Ctrl + mouse wheel. On big puzzles the clues stay visible while you scroll, and a hint scrolls the board to the right place.

## Hints

Each hint opens in three steps. Press the button again to see the next one:

1. **Where to look**: a row, column or square.
2. **Which technique** to use there, with a short description.
3. **Why**: the full reasoning, a small diagram, and an *Apply to board* button.

Hints always use the simplest technique that makes progress:

| Technique | Idea |
|---|---|
| Empty line | A clue of 0 means every square is empty |
| Perfect fit | Blocks plus gaps fill the line exactly |
| Line complete | All filled squares found, so the rest are empty |
| Overlap (simple boxes) | Push blocks to each end; squares covered both ways are filled |
| Gap too small | A gap shorter than the smallest block is empty |
| Finished block | A run as long as its only possible block gets an empty square on each end |
| Overlap using existing marks | Overlap, using the earliest and latest positions allowed by current marks |
| Unreachable squares | Squares no block can reach are empty |
| All possibilities | A square that is the same in every valid arrangement of the line is certain |
| Contradiction | Assume a square, follow the consequences, find an impossible line |

If the board has a mistake, the hint points that out first, because no reasoning is valid from a wrong board.

## Create puzzles

**Create** opens the editor. Draw, then press **Check puzzle**. The editor only allows saving when the puzzle has exactly one solution and can be solved with the techniques above, so hints always work. If it can't be saved, the editor highlights the problem: squares that could be drawn another way, or squares where logic gets stuck. **Copy code** and **Paste code** let you share puzzles. Empty rows and columns at the edges of a drawing are removed when you save, so the puzzle is only as big as the picture.

Puzzles can be up to 100×100. Puzzles larger than 30×30 must be solvable with line techniques alone (no Contradiction steps): searching for contradictions on a board that size is too slow to do for every check and hint. Auto-fix aims for that automatically.

**Import picture…** turns a picture into a puzzle (you can also drop a picture on the editor or paste one with Ctrl+V). Choose the size (up to 100×100), how dark a pixel must be to fill a square, and whether to invert, trim the border or remove stray squares, with a live preview. The picture never leaves your computer.

If a drawing has more than one solution or needs guessing, **Auto-fix** changes as few squares as possible until it solves without guessing. It outlines the changed squares in blue, and **Undo auto-fix** puts the drawing back.

## Puzzle quality

A valid puzzle is not automatically a fun one. After **Check puzzle**, the editor also shows how interesting the puzzle is to solve, measured against these targets:

| Measure | Target | Why |
|---|---|---|
| Symmetry | at most 85% | Mirror-image pictures have mirror-image clues, so solving one half solves the other |
| Filled squares | 30–60% | Big solid areas give large overlaps straight away |
| Given away at the start | at most 40% | The share of squares you can work out from single lines on the empty board |
| Tricky moments | at least 5% of steps | Steps where only one or two lines can make progress, so you have to find them |
| Techniques used | at least 6 | Variety in the reasoning needed |

This is advice only: you can save a puzzle that misses targets. Puzzles under 10×10 are warm-ups and aren't judged. Every built-in puzzle of 10×10 and larger meets all targets, and `tests.html` checks this. Within each size group the built-in puzzles go from easier to harder, and every group of 10×10 and up has at least one Hard or Expert puzzle (also checked by `tests.html`).

## Files

```
index.html        page
css/style.css     styles (light and dark)
js/solver.js      technique-based solver, uniqueness check, difficulty rating
js/hints.js       turns solver steps into explanations and diagrams
js/quality.js     puzzle quality measures and targets
js/puzzles.js     built-in puzzles ('#' filled, '.' empty)
js/board.js       board rendering and drag input
js/image-import.js picture to grid: sampling, threshold, clean-up
js/app.js         library, game, hints panel, editor, settings
tests.html        solver tests + validation of every built-in puzzle
tools/serve.ps1   optional local web server (used for automated testing)
```

To add a built-in puzzle, add it to `js/puzzles.js`. Then open `tests.html` (through `tools/serve.ps1`, or directly in a browser) to confirm it is unique, needs no guessing and meets the quality targets.
