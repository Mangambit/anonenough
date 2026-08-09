# Devpost submission — every field, ready to paste

Paste-ready, but **read each one out loud first**. If a sentence isn't how you'd say it,
change it. Judges can tell.

---

## Project name
```
AnonEnough
```

## Tagline / elevator pitch (Devpost caps this ~200 chars)
```
Deleting the names is not anonymizing. AnonEnough finds who your "anonymous" survey still points at, and the least destructive way to fix it — entirely in your browser.
```

## Built with (tags)
```
javascript, html, css, vercel, k-anonymity, l-diversity, privacy, statistics, no-dependencies
```

## Links
- **Try it:** https://anonenough.vercel.app
- **Code:** https://github.com/Mangambit/anonenough
- **Video:** _(paste your Vimeo link once uploaded)_

---

## Inspiration

My school runs anonymous surveys — sleep, stress, whether you've been offered a vape,
whether you feel safe at school. People answer honestly *because* they were promised
anonymity.

If the results get published, the obvious first step is deleting the name column. But the
other columns have to stay, because those are the breakdowns the survey was run for. And in
a school of 800, being the only 12th-grader in Track points at exactly one person. You
delete the name and the row still describes them.

I went looking for something that would check this before you hit publish. There's academic
software for statisticians who already know the term "k-anonymity," and there is nothing at
all for the student editor holding the file.

## What it does

Load a survey — the built-in demo, or drag on your own CSV. Every row that still describes
exactly one person turns red. Click one and it writes the sentence somebody could actually
use to find them:

> *This is the only 10th-grader in Band in homeroom C1 in the data.*

Then it fixes it. It searches every way to blur the file — banding grades, grouping
activities, dropping a column — throws out any policy that would destroy a table you said
you needed to publish, and keeps the one that changes your numbers least. The same row
becomes:

> *This is one of 55 students in grades 9–10 in Band.*

On the demo file that moves the smallest group from **1 to 6**, worst-case re-identification
from **100% to 17%**, and the tables declared for release still keep **97%** of their shape.

It works on files it's never seen. Drop in any CSV and it detects likely direct identifiers,
infers what an outsider would plausibly recognize, and picks the sensitive question — then
prints **every** assumption it made in a strip above the sheet, so you can argue with it.
On an uploaded file it says "assumed tables," never "declared," because nobody declared
anything.

And it refuses to overstate itself. There's a panel that never collapses listing the
attacker model it assumes and four things it doesn't cover. The word "safe" appears nowhere
in the interface.

## How I built it

Vanilla ES modules — no framework, no build step, no dependencies — deployed as static
files on Vercel. There is no backend and no LLM anywhere in it. Every number on screen is
arithmetic you could check by hand, which is what makes "it works with Wi-Fi off" literally
true instead of a slogan. After the page's own assets load it makes zero network requests.

The engine is pure and separately tested: equivalence classes and *k* (Sweeney 2002),
prosecutor re-identification risk (El Emam & Dankar 2008), analysis fidelity as
1 − total variation distance over the specific tables you declared, distinct and entropy
ℓ-diversity for how predictable answers are inside a group (Machanavajjhala et al. 2007),
and an exhaustive search over the generalization lattice. The CSV reader is RFC-4180 by
hand: quotes, escaped quotes, embedded delimiters and newlines, CRLF, delimiter sniffing.

62 tests, no install — `git clone`, then `node --test`.

## Challenges I ran into

**The bug that broke the guarantee.** The search is only trustworthy if generalizing always
*merges* groups and never splits them — that's what makes *k* rise as you blur. I had band
widths of 2 and 5, and they don't nest: at width 2, ages 14 and 15 share a band; at width 5
they split into 10–14 and 15–19. So "generalizing" could actually split a group and *lower*
k, quietly breaking the property the whole recommendation rests on.

My test passed anyway, because it watched *k* on one dataset that happened to contain no
violating pair. I only caught it when a review asked why a 5-wide band should count as
coarser than a 2-wide one. Widths are powers of two now — they nest by construction — and
the test asserts the nesting property **directly** over thousands of value pairs instead of
inferring it from one lucky example. I swept the shipped data afterwards and found zero
actual violations, so what I'd shipped was a latent bug rather than an active one. That
distinction seemed worth being precise about rather than dressing up as a catch.

**The one that would have mattered most.** My CSV parser trimmed whitespace off every field,
including quoted ones — so `"  A  "` and `"A"` collapsed into the same value, merging two
equivalence classes and reporting a *higher* k than the file actually had. A privacy tool
whose parser rounds in the reassuring direction is worse than no tool at all. Quoted fields
are now preserved byte-for-byte, with a test that fails if that ever inverts.

**Claiming more than I'd proven.** Three separate places where the interface said something
the math didn't support: it called `1/k` a stand-in for both the prosecutor and journalist
framings (journalist risk needs population group sizes, which one file can't supply); it
said "no group gives a single identical answer" while a 9-person group had split 8-to-1;
and on uploads it called its own inferred output tables "declared." Each took much longer to
notice than to fix.

## Accomplishments that I'm proud of

That it works on a file it has never seen, and tells you what it assumed instead of hiding
it. A demo that only works on rigged data isn't a tool.

And that it never says "safe." The strongest claim in the whole interface is "k is at least
6 under this stated attacker model, and here is what that model doesn't cover."

## What I learned

The hard part of a privacy tool isn't computing the number — it's refusing to overstate it.
Most of my time went into making sure every figure on screen carries the assumption it
depends on, and that there's no path through the interface that leaves someone believing
they're protected when they aren't.

The bugs that scare me now are the ones that fail *toward* good news. A crash is obvious. A
parser that quietly makes your data look safer than it is will never announce itself.

## What's next for AnonEnough

Letting the editor declare their real output tables through the UI — right now the demo's
are fixed and an upload's are inferred, and that's the input that decides which fixes are
even permissible. After that: targeting ℓ-diversity in the search rather than only reporting
it, moving the exhaustive search into a worker so large files don't block the tab, and
exporting the anonymized file plus a written audit trail.

---

## Common Devpost extras

**Which category / track?** Best Use of Data · Social Good · Web. (Not a Featherless AI or
SelfCAD entry — it deliberately contains no AI.)

**Team members / roles**
```
Dariush Afshar — sole builder. Design, engine, interface, tests, deployment.
```

**Is this a new project built during the hackathon?**
```
Yes. First commit 2026-08-07, last 2026-08-09 — the full history is public at
github.com/Mangambit/anonenough and every commit is timestamped.
```

**Did you use AI tools?**
```
Yes, as a reviewer and pair — and it's disclosed in the repo. The k-anonymity engine,
the interface and the tests are mine; I used AI to review the math, to argue with my
assumptions, and to catch two bugs I'd missed (the non-nesting generalization ladders
and the CSV parser trimming quoted fields). Every fix I understood and can defend, and
the honesty corrections in the interface came out of that review process.
```
*(Answer this one honestly and in your own words — NGN's rules only require that the main
idea and work are yours, which they are. Don't overclaim in either direction.)*
