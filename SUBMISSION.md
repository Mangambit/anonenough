# Devpost submission pack — AnonEnough

**Draft copy in your voice to edit, not text to paste unread.** The writeup and the
narration have to sound like you. Change anything that doesn't.

Live: <https://anonenough.vercel.app> · Repo: _(see "Before you submit")_

---

## Project title

**AnonEnough**

## Short description (one line)

Deleting the names is not anonymizing. AnonEnough finds who your "anonymous" survey still
points at, and the least destructive way to fix it — entirely in your browser.

## The problem it solves

Our school ran surveys asking about sleep, stress, whether you'd been offered a vape,
whether you felt safe. They were anonymous, and people answered honestly *because* they
were anonymous.

If the paper publishes the results, the obvious first step is deleting the name column. But
the other columns stay, because you need them for the breakdowns. And in a school of 800,
being the only 12th-grader in Track is enough to point at exactly one person. Delete the
name and the row still describes them.

There's academic software for statisticians who already know the term "k-anonymity," and
there's nothing at all for the student editor who is actually about to hit publish.

## What it does

Open the demo survey, or drop in your own CSV. Every row that still describes exactly one
person turns red. Click one and it writes the sentence someone could use to find them:

> *This is the only 10th-grader in Band in homeroom C1 in the data.*

Then it fixes it. It searches every combination of ways to blur the file — banding grades,
grouping activities, dropping a column — throws out any that would destroy a table you said
you needed to publish, and keeps the one that changes your numbers least. The same sentence
becomes:

> *This is one of 55 students in grades 9–10 in Band.*

On the demo file that takes the smallest group from **1 to 6**, worst-case re-identification
from **100% to 17%**, and still keeps **97%** of the tables that were declared for release.

It also refuses to overstate itself. There's a panel that never collapses, stating the
attacker model it assumes and four things it does not cover. The word "safe" appears nowhere
in the interface.

## The part I'd point a judge at

**It works on your file, not just mine.** Drag any CSV on and it parses it, guesses which
column is a direct identifier, which columns an outsider would recognize, and which question
is the sensitive one — then *tells you every guess it made* in a strip above the sheet, so
you can correct it. On an uploaded file it says "assumed tables," never "declared," because
nobody declared anything.

No backend, no LLM, no dependencies. Nothing you drop in ever leaves the tab — the page
makes zero network requests after its own assets load, and you can verify that in DevTools
or by turning off Wi-Fi.

## How I built it

Vanilla ES modules, no framework and no build step, deployed as static files on Vercel.
Every number is arithmetic you can check by hand, which is what makes "works offline"
literally true rather than a slogan.

The maths: equivalence classes and *k* (Sweeney 2002); prosecutor re-identification risk
(El Emam & Dankar 2008); analysis fidelity as 1 − total variation distance over the specific
tables you declared; distinct and entropy ℓ-diversity for how predictable answers are inside
a group (Machanavajjhala et al. 2007); and an exhaustive search over the generalization
lattice. 62 tests.

## Challenges

**The one worth telling.** The search only works if generalizing always *merges* groups and
never splits them — that's what makes *k* rise as you blur. I had band widths of 2 and 5,
and they don't nest: at width 2 ages 14 and 15 share a band, and at width 5 they split into
10–14 and 15–19. So "generalizing" could actually split a group and *lower* k, quietly
breaking the guarantee the whole recommendation rests on.

My test passed anyway, because it watched *k* on one dataset that happened to contain no
violating pair. I only found it when a review asked why a 5-wide band should count as
coarser than a 2-wide one. Widths are now powers of two, which nest by construction, and the
test asserts the nesting property **directly** over thousands of value pairs instead of
inferring it from one example. I swept the shipped data afterwards: zero actual violations —
so I'd shipped a latent bug, not an active one. That distinction felt worth being honest
about rather than dressing it up as a catch.

**The honesty bugs.** Three separate times the interface claimed more than the maths proved,
and each took longer to notice than the code took to fix:

- It said "no group gives a single identical answer" after a fix — true, and misleading,
  because a 9-person group had split 8-to-1, where guessing is right 89% of the time.
- It called `1/k` a stand-in for both the prosecutor and journalist framings. It isn't:
  journalist risk needs population group sizes, which a single file cannot supply. It now
  names the framing it actually computed and says the other is not reported.
- The upload path called its inferred output tables "declared." Nobody declared them.

**The one that would have mattered most.** The CSV parser trimmed whitespace off every
field, including quoted ones — so `"  A  "` and `"A"` collapsed into the same value, merging
two equivalence classes and reporting a *higher* k than the file actually had. A privacy tool
whose parser rounds in the reassuring direction is worse than no tool. Quoted fields are now
preserved byte-for-byte, with a test that fails if they aren't.

## What I learned

That the hard part of a privacy tool isn't computing the number, it's refusing to overstate
it — and that the bugs which scare me are the ones that fail *toward* good news.

## Built with

`javascript` `html` `css` `vercel` `k-anonymity` `l-diversity` `privacy` `no-dependencies`

---

## ~90-second video script

Record in your own voice. The one uncut take that matters is the flip.

| Time | On screen | Say roughly |
|---|---|---|
| 0:00–0:12 | The demo sheet, red rows visible | "Our school ran anonymous surveys — sleep, stress, vaping. People answered honestly because they were promised anonymity. The names are already gone from this file." |
| 0:12–0:26 | Click a red row; the sentence appears | "Thirty-eight rows still describe exactly one person. This one is the only 10th-grader in Band in homeroom C1. Anyone who knows who that is can now read their answers." |
| 0:26–0:42 | **Apply the recommended fix** — one uncut take | "It searched all forty-eight ways to blur this table, threw out every one that would destroy a table we said we'd publish, and picked the cheapest survivor. Same row. Now it's one of fifty-five." |
| 0:42–0:54 | Metrics band | "Smallest group one to six. Worst case a hundred percent down to seventeen. And the tables we meant to publish keep ninety-seven percent of their shape — that's the trade, measured, not guessed." |
| 0:54–1:12 | **Drag on your own CSV** | "And it's not just my file. Here's an HR survey I've never opened. It found the name column, guessed what an outsider would recognize, and told me every assumption it made — because those assumptions are the arguable part, not the maths." |
| 1:12–1:24 | Limitations panel | "It never says 'safe.' It says k is at least six under a stated attacker model, and lists what that model misses — like a group where everyone gave the same answer anyway." |
| 1:24–1:32 | Wi-Fi off, reload, drop a file | "Wi-Fi's off. Still works. Nothing you drop in ever leaves your browser." |

## Screenshots to capture

1. The demo sheet with red rows and the attacker sentence — the finding
2. The same sentence after the flip, side by side if you can
3. **An uploaded CSV with the notice strip visible** — this is the differentiator
4. The frontier chart with the recommended point ringed
5. The limitations panel

## Before you submit

- [ ] **Decide the repo.** `github.com/Mangambit/anonenough` currently holds the earlier
      React build, not what's live. Either force-push this version over it, or make a new
      repo — but the link in the submission must match the site the judges open.
- [ ] Check <https://anonenough.vercel.app> loads in a private window
- [ ] Video uploaded and playable (unlisted is fine)
- [ ] Screenshots attached
- [ ] Read the whole writeup out loud once — if a sentence isn't how you'd say it, change it
