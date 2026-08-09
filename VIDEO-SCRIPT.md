# AnonEnough — narration script

**Read this over `anonenough-demo.mp4`.** The video is silent and already cut to these
timings; you just talk. Total spoken: **248 words ≈ 99 seconds** at a natural pace. The
video runs **1:49**, so you have ~10 seconds of slack — you do not need to rush.

Two models drafted this independently (Claude Opus 5 and GPT‑5.6 Sol) and it's merged from
both: Opus's voice and structure, Sol's bug story.

---

## How to record it

Talk like you're explaining it to a friend who asked what you made. **Slightly slower than
feels natural** — everyone rushes their first take. Pause at the `//` marks; those are
where the video is doing the work and silence is good.

If a sentence doesn't sound like you, change it. The judges are engineers; they can tell
the difference between someone reading and someone explaining.

---

| Time | On screen | What you say |
|---|---|---|
| **0:00–0:14** | Hero, then the sheet scrolls in — red rows | "My school runs anonymous surveys. Sleep, stress, whether you've been offered a vape, whether you feel safe. People answer honestly *because* they were promised anonymity. // Then someone deletes the name column and calls it anonymous." |
| **0:14–0:27** | `survey-responses.csv`, 431 rows · 7 columns. Red rows, status line | "The other columns have to stay — that's what the survey was for. So this reads the file, in your browser, and finds the rows that still point at exactly one person. // Thirty-eight out of four hundred thirty-one." |
| **0:27–0:41** | Click a red row → the serif sentence appears | "It doesn't just hand you a score. It writes the sentence somebody could actually say out loud: // *this is the only tenth-grader in Band in homeroom C1.* // Anyone who knows who that is can now read their answers." |
| **0:41–0:57** | **Apply the recommended fix** — the same row's sentence rewrites in place | "One click. It tried all forty-eight ways to blur this table, threw out every one that would destroy a table the school said it needed to publish, and kept the cheapest thing left. // Same row. Now it's one of fifty-five." |
| **0:57–1:12** | Metrics band: k 1→6 · 100%→17% · 97% | "Smallest group goes from one to six. Worst-case re-identification, a hundred percent down to seventeen. And the tables they actually wanted to publish keep ninety-seven percent of their shape. That's the trade — measured, not guessed." |
| **1:12–1:28** | HR CSV drops in. `Full name` flagged. Assumption strip. 93 of 180 red | "Different file. An HR burnout survey, a hundred eighty rows, and the code has never seen it. It finds 'Full name' and drops it, works out what an outsider would recognize, and prints every assumption it made right above the sheet — because those assumptions are the arguable part, not the math." |
| **1:28–1:40** | Limits panel scrolling | "It never says the word 'safe.' It says k is at least six under a stated attacker model, then lists what that model misses. // A privacy tool that rounds toward reassurance is worse than no tool." |
| **1:40–1:49** | Advisor note, then the network-requests chip | "No backend, no AI, no dependencies, and zero network requests after it loads. Whatever you drop in never leaves your laptop — which for this, is kind of the whole point." |

---

## If you run long, cut these first, in this order

1. **"Anyone who knows who that is can now read their answers."** (~4s) — the sentence on
   screen already lands it. This is the encore.
2. **"That's the trade — measured, not guessed."** (~3s) — the three numbers are on screen
   in huge type and engineers read faster than you talk.
3. **"because those assumptions are the arguable part, not the math"** (~5s) — true and
   good, but it's the one clause a judge will still get from the README.

Cutting all three saves ~12 seconds and removes nothing the product does.

## If you have room and want one more beat

After the limits panel you can add the bug — it's the strongest Technical Quality signal
you have, and it's *true*:

> "One thing I got wrong: my age bands didn't nest. Widths of two and five — fourteen and
> fifteen share a band at width two, then split apart at width five. So 'generalizing'
> could actually split a group and *lower* k, which breaks the whole guarantee. My test
> passed anyway, because it watched k on one dataset that happened not to contain a
> violating pair. Widths are powers of two now, and the test checks the nesting property
> directly instead of inferring it."

(+43 words ≈ 17s. Only use it if you cut the three lines above.)

## Two things not to do

- **Don't open with "Hi, my name is Dariush and today I'll be showing you…"** The video
  starts on the problem. You introduce yourself in the Devpost writeup, not here.
- **Don't apologize for anything or hedge.** The honesty section is a *strength* — deliver
  "it never says safe" as confidence, not as a disclaimer.
