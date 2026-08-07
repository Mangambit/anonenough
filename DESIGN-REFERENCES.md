# AnonEnough — Design Reference Pack

*Paste section 5 into a fresh Claude design session. All 21 URLs load-checked 2026-08-07.*

## 1. Direction

Build a forensic lab report, not a dashboard. Light, paper-like surface — near-black ink, hairline rules, dense tables set in mono — so that alarm red is the only loud thing on screen and lands like evidence, not decoration. The genre is the security-scanner results page (SSL Labs, Cover Your Tracks) crossed with privacy journalism (The Markup): every finding written as a plain-English sentence with the numbers to back it. Two registers, both designed: alarm (red row, attacker sentence, "1 of 1") and resolution (teal, "one of 14") — the transition between them is the product. Everything else stays quiet and instant, including a permanently visible panel stating what the tool cannot do. Never the word "safe."

## 2. References

### Scanners and audit-result pages (this is the genre — study these hardest)

- **Cover Your Tracks (EFF)** — https://coveryourtracks.eff.org — browser-fingerprint uniqueness tester. **Steal:** the results table's "one in x browsers have this value" ratio column per characteristic — that column IS the "1 of 14" column — and the verdict written as a full sentence, not a badge.
- **Have I Been Pwned** — https://haveibeenpwned.com — breach lookup. **Steal:** one input flips the whole header's color and mood (neutral → red result); giant tabular count numerals. Model for the moment a CSV loads and the reds appear.
- **Blacklight (The Markup)** — https://themarkup.org/blacklight — real-time website privacy inspector from a newsroom. **Steal:** findings delivered as prose sentences with expandable raw evidence beneath each; serif editorial type on scanner output. The direct ancestor of the attacker sentence.
- **SSL Labs Server Test** — https://www.ssllabs.com/ssltest/ — deep TLS audit. **Steal:** the huge single letter-grade on a colored block, then unapologetically dense findings tables below. Working engineers trust density.
- **Internet.nl** — https://internet.nl — open-standards test suite. **Steal:** pass/fail rows that each expand into a plain-language "why this matters" paragraph.
- **AboutMyInfo** — https://aboutmyinfo.org — "How unique am I?" demo from the Harvard lab of Latanya Sweeney, who invented k-anonymity. **Steal:** the three-field input → uniqueness verdict flow; cite it in the app for credibility.
- **Can you be re-identified?** (Imperial College) — https://aisp.doc.ic.ac.uk/individual-risk/ — **Steal:** second-person verdict sentences ("that person would be you X% of the time") and "this runs only in your browser" placed right beside the input. This is AnonEnough's academic twin.
- **AmIUnique** — https://amiunique.org — fingerprint uniqueness with global statistics. **Steal:** per-attribute distribution pages → inspiration for showing which columns do the identifying.

### Data-table-heavy developer tools

- **Linear** — https://linear.app — **Steal:** 36px rows, hover as a 2% tint (no border noise), one accent at a time; its side-by-side structural diffs are a good template for the fix preview.
- **Observable** — https://observablehq.com — **Steal:** the tiny distribution histogram in each column header — do exactly this so risky quasi-identifier columns are visible before any row is clicked.
- **PlanetScale** — https://planetscale.com — **Steal:** hairline-bordered tables, monospace numerals, restrained one-accent charts on white. Technical texture without cosplay.

### Editorial data journalism

- **The Pudding** — https://pudding.cool — **Steal:** one idea per scroll step; annotations placed directly on the data with leader lines instead of legends.
- **Reuters Graphics** — https://www.reuters.com/graphics/ — **Steal:** gray-base charts where a single alarm color carries the whole story.
- **Distill** — https://distill.pub — **Steal:** generous margins, margin notes for caveats, muted links — the visual tone of "peer-reviewed," ideal for the limitations panel.

### Privacy-brand products (trust without corniness)

- **Signal** — https://signal.org — **Steal:** trust claims as short declarative sentences ("We can't read your messages"), zero padlock clip-art.
- **Mullvad VPN** — https://mullvad.net — **Steal:** the bluntness; limits acknowledged, nothing oversold. Copy the voice for the attacker-model panel.
- **Plausible Analytics** — https://plausible.io — **Steal:** one-page restraint; the privacy claim lives permanently in the page, never in a dismissible modal.
- **Obsidian** — https://obsidian.md — **Steal:** making local-first concrete ("your files, on your device") — pair with a live "network requests: 0" counter.

### Before/after, diffs, tradeoffs

- **Squoosh** — https://squoosh.app — **Steal:** the draggable before/after split with a live "% smaller" readout that updates as you drag — the exact interaction model for the k-vs-statistics chart. Same "never leaves your device" promise.
- **Diffchecker** — https://www.diffchecker.com — **Steal:** word-level inline highlighting — only changed words get color. Apply precisely to the sentence flip.

### The honesty panel

- **EFF Surveillance Self-Defense** — https://ssd.eff.org — **Steal:** the plain-question skeleton (what am I protecting, from whom, what happens if it fails) as the literal structure of the attacker-model panel.

## 3. Anti-references

- **The hacker dashboard** (neon on black, glassmorphism, Matrix-Grafana cosplay). Judges read it as costume, and alarm red has nowhere to land on a dark theatrical UI.
- **The default Tailwind/shadcn SaaS template** (Inter everywhere, rounded-2xl cards, gradient hero, emerald buttons). It's what judges review all day — and "success green" whispers *safe*, the one word the product is forbidden to say.
- **Consumer antivirus scare-ware** (pulsing shields, "97 THREATS FOUND!"). Alarm detached from evidence destroys trust; red must always attach to a specific row and its sentence.
- **Playful productivity pastels** (blob mascots, confetti). The demo includes a teenager's sensitive answers; whimsy is the wrong register.

## 4. Concrete specs

**Type (all Google Fonts)**
- **IBM Plex Sans** 400/500/600 — UI, labels, panel prose.
- **IBM Plex Mono** 400/500 — every data cell, count, k value. `font-variant-numeric: tabular-nums` globally.
- **Newsreader** 500 italic — the attacker sentence ONLY, 28–34px, like a pull-quote. It should read as a line someone could publish about a real student.

**Palette (single light theme — a lab report is paper; skip dark mode)**
- Page `#F6F5F1` · panels `#FFFFFF` · ink `#1A1D21` · secondary `#5D6169` · hairlines `#DAD7CE`
- **Alarm red `#B42318`** with row wash `#FBEAE7` — deep print red, never neon
- **Resolved teal `#0E7C66`** with wash `#E3F1EC` — deliberately not success-green; it means "reduced risk," not "safe"
- Amber `#B7791F` for exactly one thing: the recommended-tradeoff marker
- Hard rule: hue encodes privacy state and nothing else.

**Layout**
- 8px grid, 36px table rows, 13px mono cells, 64px between sections, ~1120px max width.
- The limitations panel is an always-visible right rail (~300px), never a modal or accordion.
- Footer strip: "network requests: 0 · your file never left this tab."

**The one motion moment — the sentence flip (~600ms)**
Only the changed phrases strike through with a red wash and dissolve; replacements fade in rising 8px, washed teal; teal cools to ink over ~1.2s like highlighter fading on paper. Simultaneously the row's red drains (300ms) and "1 of 1" ticks to "1 of 14." Easing `cubic-bezier(0.2, 0, 0, 1)`, no bounce. Everything else ≤150ms. Honor `prefers-reduced-motion` by swapping without movement.

## 5. Paste-ready brief

> Design the UI for **AnonEnough**, a browser-only privacy debugger for spreadsheets about to be published. An editor loads a survey CSV (fully client-side — works with Wi-Fi off); every row that still describes exactly one real person turns red, with a mono "1 of 1 / 1 of 14" uniqueness column. Clicking a red row writes the attacker's sentence in large Newsreader italic: "This is the only 11th-grader in Robotics." One click applies a fix and the same sentence flips — word-level diff, red strike out, teal in, ~600ms, no bounce — to "one of 14 students in a STEM activity." That flip is the hero moment. Include a chart plotting privacy (k) against how much the published statistics survive (Squoosh-style live readout, amber marker on the best tradeoff) and a permanently visible right-rail panel stating the assumed attacker and what the tool does NOT protect against. It never says "safe."
>
> Look: forensic lab report, not SaaS. Paper `#F6F5F1`, ink `#1A1D21`, hairlines `#DAD7CE`, alarm red `#B42318` on wash `#FBEAE7`, resolved teal `#0E7C66` on wash `#E3F1EC`; color encodes privacy state only. IBM Plex Sans UI, IBM Plex Mono data (tabular-nums), 36px table rows, Observable-style column-header histograms. Reference the register of ssllabs.com/ssltest (grade block + dense findings), coveryourtracks.eff.org ("one in x" ratio column), themarkup.org/blacklight (findings as prose), reuters.com/graphics (one alarm color), diffchecker.com (word-level diff). No dark mode, no gradients, no rounded-2xl cards, no success green, no shield icons.
