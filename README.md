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

62 tests covering the engine (ladders, equivalence classes, fidelity, distortion, the
lattice search, the attacker sentence, the word diff) and the upload path (RFC-4180
parsing, delimiter sniffing, schema inference, auto-ladder nesting). The numbers pinned in
the tests were measured from the engine, not copied from the design handoff — see
`NOTES.md`.

## Layout

```
index.html          page structure; every dynamic region carries a data- hook
styles.css          design tokens and layout
src/schema.js       column names, labels, and the demo file's vocabularies
src/survey.js       seeded synthetic roster + responses (no real student answers)
src/csv.js          RFC-4180 CSV reader: quotes, embedded newlines, delimiter sniffing
src/infer.js        schema inference for uploads — ladders, identifiers, assumed tables
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
   smallest group is `k`. When `k` is 1, that row describes exactly one person *in this
   file* — which is what makes them findable by someone who already knows them. It is not
   proof that anyone has been identified.
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

## Auditing your own file

Drag a CSV onto the sheet, or press **Load your CSV**. It is read with the `File` API and
parsed in the tab; there is no upload endpoint, and the page makes no network request after
its own assets load. Reloading forgets the file.

Inference then has to guess four things, and it states every guess in a notice strip above
the sheet rather than burying it:

| Guess | Rule | How to override |
|---|---|---|
| Direct identifiers | non-numeric and ≥90% distinct (≥50% if the header says name/email/id) | — removed before the audit; reload to start over |
| Attacker-known columns | the three lowest-cardinality recognizable columns | the chips |
| Sensitive answer | the last informative column | the dropdown |
| Tables you would publish | sensitive × each attacker column, minus the highest-cardinality one | — |

The last row is the one to be careful with. On the demo file the publisher *declares* their
output tables, so fidelity means something specific. On an upload nobody declared anything,
so the page says **assumed tables**, never *declared*, and the notice names exactly which
tables the fidelity percentage is measured against.

Two limits, stated because they are real: the first 5,000 rows are audited (the lattice
search is exhaustive), and at most 6 attacker columns can be active at once. Both are
reported on screen when they bind.

## Not built yet

See `NOTES.md`. The short version: the declared-tables set cannot be edited through the UI,
only the prosecutor risk framing is reported (journalist risk needs a population roster),
the search optimizes for `k` and reports ℓ-diversity separately rather than targeting it,
and there is no export of the anonymized file.
