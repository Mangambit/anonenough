# AnonEnough

A browser-only re-identification audit for a spreadsheet of survey responses that is about
to be published. It reports, row by row, how many people each combination of answers could
belong to, names the smallest group (**k**), and recommends the least destructive way to
raise it without destroying the statistics the publisher said they intended to release.

The file never leaves the tab.

## Run it

No build step and no dependencies. Any static server will do:

```bash
python3 -m http.server 8123 --directory "Personal Projects/anonenough"
```

Then open <http://localhost:8123>. (ES modules need a server — opening `index.html` over
`file://` is blocked by the browser's module CORS rules.)

From Claude Code, `preview_start` with the `anonenough` entry in the vault's
`.claude/launch.json` does the same thing.

## Test it

```bash
node --test 'test/*.test.mjs'
```

40 tests covering the engine: ladders, equivalence classes, fidelity, distortion, the
lattice search, the attacker sentence, and the word diff. The numbers pinned in the tests
were measured from the engine, not copied from the design handoff — see `NOTES.md`.

## Layout

```
index.html          page structure; every dynamic region carries a data- hook
styles.css          design tokens and layout — no border radius anywhere, deliberately
src/schema.js       column names, labels, and the demo file's vocabularies
src/survey.js       seeded synthetic roster + responses (no real student answers)
src/engine.js       the analysis engine — pure, no DOM, fully tested
src/narrate.js      the plain-English attacker sentence and its word-level diff
src/chart.js        the privacy/fidelity frontier plot (hand-built SVG)
src/app.js          state, memoization, rendering, the two animations
test/               node:test suite for everything under src/ except app.js and chart.js
assets/stakes.jpg   the editorial photograph behind the "If this fails" band
```

## How the audit works

1. **You declare what an outsider already knows.** The chips above the sheet mark columns
   as *quasi-identifiers* — things a classmate, parent or teacher could recognize on sight.
   Nothing else is assumed. This declaration, not the maths, is the arguable part.
2. **Rows are grouped with the rows that look identical to that outsider.** The size of the
   smallest group is `k`. When `k` is 1, a row belongs to exactly one identifiable person.
3. **The cheapest way to raise `k` is searched exhaustively.** Every combination of
   coarsening in the lattice is evaluated; any policy that would destroy a table the
   publisher declared for release is discarded; what survives is ranked by how much of the
   declared statistics it keeps.

### Three decisions that carry the result

Each is marked `WHY` at the point it matters in `src/engine.js`, and each has a test.

- **A suppressed group-by or breakdown column kills its table outright** (`dead`, TVD 1).
  Being unable to publish a table is categorically worse than publishing a distorted one,
  so the search will never recommend the policy that caused it.
- **Fidelity is `1 - mean(tvd)`, not `1 - max(tvd)`.** Max saturates: once the worst table
  is wrecked, further damage elsewhere becomes invisible and the tradeoff curve flattens
  into a meaningless plateau.
- **Distortion is `mean((level / maxLevel)²)`.** The square makes deleting a column
  categorically more expensive than a mild generalization. Under a linear cost the search
  happily buys privacy with free column deletions.

## What it does not do

The audit reports risk under a *stated* set of assumptions. It never says a file is safe.

- It cannot know what an attacker actually knows — only the model you declared.
- It does not cover free-text answers, timestamps read as attendance, or anything about
  these students published elsewhere.
- A group can hide *who* you are and still reveal *what you said*: a group that answered
  the sensitive question unanimously leaks the answer without ever identifying anyone. The
  page counts those groups but does not defend against them (that would need ℓ-diversity).
- Releasing two versions of the same file, one stricter than the other, can undo all of it.

Method: k-anonymity after Sweeney (2002); the two risk framings after El Emam & Dankar
(2008); fidelity measured as total variation distance.

## Not built yet

See `NOTES.md` for the full list and for where this implementation knowingly departs from
the design handoff. The short version: there is no file upload (the sheet is synthetic data
from a seed), the declared-tables set is hardcoded, only the prosecutor risk framing is
reported, and there is no export.
