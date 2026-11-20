# Nonograms

A browser nonogram game whose hints teach you how to solve, instead of just revealing squares.

## Play

Double-click `index.html`. It runs in any modern browser with no install or build step. Progress, settings and your own puzzles are saved in the browser.

- **Fill / Mark empty**: switch tools, or left-click to fill and right-click to mark a square empty. Drag to paint a whole run in one row or column.
- **Keys**: `H` hint, `F` fill tool, `X` mark-empty tool, `Ctrl+Z` / `Ctrl+Y` undo and redo, `Esc` close the hint.
- **Mistakes** (in ⚙ Settings): shown after 3 seconds without a move (default), only when you press Check, or never.

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

**Create** opens the editor. Draw, then press **Check puzzle**. The editor only allows saving when the puzzle has exactly one solution and can be solved with the techniques above, so hints always work. If it can't be saved, the editor highlights the problem: squares that could be drawn another way, or squares where logic gets stuck. **Copy code** and **Paste code** let you share puzzles.

## Files

```
index.html        page
css/style.css     styles (light and dark)
js/solver.js      technique-based solver, uniqueness check, difficulty rating
js/hints.js       turns solver steps into explanations and diagrams
js/puzzles.js     built-in puzzles ('#' filled, '.' empty)
js/board.js       board rendering and drag input
js/app.js         library, game, hints panel, editor, settings
tests.html        solver tests + validation of every built-in puzzle
tools/serve.ps1   optional local web server (used for automated testing)
```

To add a built-in puzzle, add it to `js/puzzles.js`. Then open `tests.html` (through `tools/serve.ps1`, or directly in a browser) to confirm it is unique and needs no guessing.
