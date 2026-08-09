# Implementation notes

Built from the `AnonEnough v2.dc.html` design handoff (Claude Design project
*AnonEnough Report Screen Built*, also exported as `~/Downloads/AnonEnough Report Screen
Built.zip`). The handoff's own instruction was to **recreate the UI** in the target
environment but **port the analysis engine rather than redesign it** — that is what this
does.

Stack: zero dependencies, no build step, ES modules. There was no existing web codebase to
inherit from (no `package.json` anywhere in the vault), and `support.js` in the design
export is a design-tool runtime that expects `window.React` to be injected from outside, so
it was not a production stack to adopt. This matches the convention already set by
`CC-Dashboard-v2`.

## Where the handoff was wrong

**Pitfall 4 does not reproduce.** The handoff says turning the **Age** chip on "correctly
produces the *no publishable policy exists* empty state." It does not. Every one of the 31
non-empty quasi-identifier subsets yields a non-empty frontier on the seed-4207 file —
Age + Grade + Activity + Homeroom returns four points with a knee at k=3, keeping 88% of
the declared statistics. Verified by sweeping all 31 subsets.

The empty state is still implemented, because the engine can genuinely return an empty
frontier (there is a test that constructs one), but **it is unreachable from the UI as
shipped**. If that state matters — and it should, it is the honest answer when privacy and
utility genuinely cannot both be had — it needs either a stricter declared-tables set or a
dataset where one is unavoidable.

Everything else in the handoff checked out. The recommended fix for the default model is
`Grade → paired grades · Homeroom → removed` at k=6 keeping 97%, and the demo does open in
the alarming state (k=1, 38 of 431 rows describing exactly one person) that the whole
narrative depends on.

## Deliberate departures from the prototype

- **Age bands are 2 then 4 years, not 2 then 5.** The design specified 2/5, and 2/5 is not
  a hierarchy: ages 14 and 15 share the band `14–15` at width 2 and then split into `10–14`
  and `15–19` at width 5. A coarsening step that *splits* an equivalence class breaks
  k-monotonicity, which is the whole justification for calling the search's answer the
  least destructive fix. Powers of two nest by construction.

  Worth being precise about the severity: sweeping all 31 attacker models over the shipped
  seed-4207 file, 3,950 coarsening steps, **k never actually fell** — the flaw was latent,
  not active. It becomes live the moment the file-upload gap below is closed and the age
  distribution is no longer this one. `test/engine.test.mjs` now asserts the nesting
  property directly over 40 values per column rather than inferring it from k on one
  dataset, because every k-watching check passed while the ladder was broken.

- **Column headers follow the previewed policy, not the applied one.** In the prototype a
  header's label turns blue on `policy`, while its cells generalize on `effPolicy`, so
  during the initial preview the cells changed but the headers did not. Both now follow
  `effPolicy`; the dashed "preview · not applied" pill and the "Would leave …" status line
  still carry the distinction.
- **The metrics band snaps instead of tweening when the tab is hidden.** A backgrounded tab
  starves `requestAnimationFrame`, which left the band showing the *previous* audit's
  numbers indefinitely. Correct beats animated. (Found while verifying in a hidden
  preview pane — it is a real bug, not just a harness artifact.)
- **Modest responsive breakpoints at 1100px and 860px.** The design is desktop-first and
  the handoff lists responsiveness as a known gap; these only stop the surrounding page
  from breaking. The sheet keeps its own horizontal scroll, as designed.
- **Keyboard and screen-reader affordances** that the prototype had no way to express:
  chips are `aria-pressed` toggles, tabs are a `role="tablist"`, rows and chart points are
  focusable and respond to Enter/Space, and the sentence panel is `aria-live="polite"`.

## Known gaps

- ~~**No file upload.**~~ **Built.** `src/csv.js` (RFC-4180: quotes, escaped quotes,
  embedded delimiters and newlines, CRLF, delimiter sniffing) and `src/infer.js` (numeric
  detection, direct-identifier detection, power-of-two auto-ladders, initial attacker
  model, assumed tables). Both zero-dependency. The demo file and an uploaded CSV now
  produce the same *dataset descriptor* shape, so nothing downstream knows which is loaded.

  Two bugs this shook out, both of which the demo file had been hiding:
  1. `tablesFor` declared a table over **every** attacker column. A table dies when its
     group-by column is suppressed, and the search refuses any policy that kills a table —
     so every route to a larger group was forbidden and the search returned empty. The demo
     only worked because `homeroom` happens to sit in no table. Fix: leave the
     highest-cardinality column out of the declared set (it is also the least plausible
     publication axis).
  2. `describePolicy` looked labels up in the demo's `SHORT` table, so an uploaded file's
     recommendation rendered as `undefined → removed`. It now takes a label map and falls
     back to the column name.

- **The declared-tables set still cannot be edited through the UI.** For the demo it is
  hardcoded; for an upload it is inferred. Inference is disclosed in the notice strip and
  the labels say **assumed tables**, never *declared* — but letting the user state their
  real output tables remains the single highest-value thing left to build. It is the input
  that decides which fixes are even permissible.
- **Only the prosecutor risk framing is reported.** This was previously described as both
  framings "shown as the same upper bound", which overstated it: journalist risk is defined
  against *population* equivalence-class sizes and a single file cannot supply them. The
  page now names the prosecutor framing explicitly and says journalist risk is not computed,
  noting only that it would be no higher, since the file is a subset of the roster.
- **No export.** A real audit should emit a JSON or PDF report.
- ~~**Fonts come from Google Fonts.**~~ **Fixed.** The three families are now self-hosted
  in `assets/fonts/` (latin + latin-ext woff2, 272 KB, generated from the Google Fonts CSS
  at build time and committed). Verified on the live deployment from a cold browser: the
  only host the page contacts is its own origin, so the "network requests 0" chip is now
  literally true rather than true-of-the-survey-data-only. This mattered because a judge
  who opens devtools and finds the chip lying loses trust in every other number on the
  page — and the whole product is an argument about not overstating what you know.
- **`assets/stakes.jpg` is a generated editorial photograph**, carried over from the design
  export. Replace it with a licensed photograph if this ships publicly.
- **`src/app.js` and `src/chart.js` are not unit-tested** — they are DOM rendering, and the
  logic worth testing was kept out of them. They were verified by driving the running page
  (every control, both animations, all three sheet tabs, all 31 attacker models), and the
  upload path was verified end-to-end on the live deployment with a synthesized drop of an
  HR survey the code had never seen.
- **Whitespace handling in the parser was a near-miss worth recording.** The first version
  trimmed every field, so `"  A  "` and `"A"` collapsed to one value — merging two
  equivalence classes and reporting a *higher* k than the file has. A privacy tool whose
  parser rounds toward reassurance is worse than no tool. Quoted fields are now preserved
  byte-for-byte, unquoted ones are trimmed, and a test fails if that inverts. Found by an
  external code review, not by the test suite.
- **The exhaustive search runs synchronously on the main thread.** Capped at 5,000 rows and
  6 active attacker columns, both stated on screen when they bind. A larger file would want
  a worker; the cap is honest rather than silent, but it is a cap.
