# Devpost submission pack — AnonEnough

Everything below is **draft copy in your voice to edit, not text to paste unread.** The Devpost writeup and the video narration have to be yours. Change anything that doesn't sound like you.

Live: https://anonenough.vercel.app · Repo: (push to github.com/Mangambit/anonenough)

---

## Project title
**AnonEnough**

## Short description (one line)
Deleting names is not anonymizing — AnonEnough finds who your "anonymous" survey still identifies, and the least destructive way to fix it. Runs entirely in your browser.

## The problem it solves

Our school ran surveys asking about sleep, stress, whether you'd been offered a vape, whether you felt safe — and things more sensitive than that. They were anonymous, and people answered honestly *because* they were anonymous.

If the paper publishes the results, the obvious first step is deleting the name column. But the other columns stay, because you need them for the breakdowns. And in a school of 800, being the only 12th-grader in Track is enough to point at exactly one person. Delete the name and the row still describes them.

There is no tool for a student editor at that moment. There's academic software for statisticians who already know the term "k-anonymity," and there's nothing at all for the person actually about to hit publish.

## What it does

Drop in a survey export. Every row that still describes exactly one person turns red. Click one and it writes the sentence someone could use to find them: *"This is the only 12th-grader in Track."*

Then it fixes it. It searches every combination of ways to blur the data — banding grades, grouping activities into categories, dropping a column — and picks the one that protects everyone while changing the numbers you meant to publish the least. The same sentence becomes *"one of 10 students in grades 9–12 in Track."*

It also reports what it can't do. There's a panel that never collapses stating what attacker it assumes and what it doesn't model, and the app never uses the word "safe" — the strongest thing it will say is "every group has at least k people in it, under this model."

And you can play the attacker yourself: pick the two things you'd know about a classmate and watch it narrow.

## How I built it

React + TypeScript + Vite, deployed on Vercel. No backend and no LLM anywhere — every number is arithmetic you can check by hand, which is what makes "works with Wi-Fi off" literally true.

The maths: equivalence classes and k (Sweeney 2002); prosecutor and journalist re-identification risk (El Emam & Dankar 2008); analysis fidelity as 1 − total variation distance over the specific tables you declared you'd publish; distinct and entropy l-diversity for how predictable the answers are inside a group (Machanavajjhala et al. 2007); and an exhaustive search over the generalization lattice.

## Challenges

**The one worth telling.** The search only works if generalizing always merges groups and never splits them — that's what makes k go up as you blur more. I had band widths of 2, 5 and 10, and they don't nest: at width 2 ages 4 and 5 share a band, and at width 5 they split apart. So "generalizing" could actually *split* a group and lower k, quietly breaking the guarantee the whole recommendation rests on.

My test passed anyway, because it watched k on one dataset that happened not to contain a violating pair. I only found it when an external review asked why a 5-wide band should count as coarser than a 2-wide one. Widths are now powers of two, which nest by construction, and the test asserts the nesting property directly over ~28,000 value pairs instead of inferring it from one example.

**The honesty bug.** The app used to say "no group gives a single identical answer" after applying a fix. True — and misleading, because at that same setting there was a 9-person group that split 8-to-1, where guessing is right 89% of the time. Reporting only perfect leaks reads as reassurance exactly where you shouldn't be reassured. It now reports the worst group's actual predictability.

## What I learned

That the hard part of a privacy tool isn't computing the number, it's refusing to overstate it. Most of the work went into making sure every figure on screen carries the assumption it depends on, and that there's no path through the interface that leaves someone thinking they're protected when they aren't.

## What's next

Real l-diversity *targets* in the search (right now it optimizes for k and reports diversity separately), and letting the editor declare their published tables through the UI instead of in config.

## Built with
`react` `typescript` `vite` `papaparse` `vercel` `k-anonymity` `l-diversity` `privacy`

---

## 90-second video script

Record in your own voice. The one uncut take that matters is the flip.

| Time | On screen | Say roughly |
|---|---|---|
| 0:00–0:10 | The survey with names visible | "Our school ran anonymous surveys — sleep, stress, vaping, and more personal things than that. People answered honestly because they were promised anonymity." |
| 0:10–0:18 | Click **Delete the names** → reds appear | "If we publish this, the first thing you do is delete the names. Watch what's left." |
| 0:18–0:30 | Click a red row; the sentence appears | "Seven rows still describe exactly one person. This one is the only 12th-grader in Track. Anyone who knows who that is can now read their answers." |
| 0:30–0:40 | 12-row sample | "Don't trust me — here's the same maths on twelve rows. Count the groups yourself." |
| 0:40–0:55 | **Apply recommended fix** — the flip, one uncut take | "It searched all fifteen ways to blur this table and picked the one that costs the least. Same row. Now it's one of ten." |
| 0:55–1:10 | Risk tiles, fidelity, frontier | "Worst-case risk drops from a hundred percent to fourteen. And the tables we actually meant to publish keep eighty-nine percent of their shape — that's the trade, measured, not guessed." |
| 1:10–1:22 | Limitations panel | "It never says 'safe.' It says k is at least seven under a stated attacker model, and lists what that model doesn't cover — like a group where everyone gave the same answer anyway." |
| 1:22–1:30 | Wi-Fi off, drop a CSV | "Wi-Fi's off. It still works. Nothing you drop in ever leaves your browser." |

## Screenshots to capture
1. Names visible, before deleting — the starting state
2. Red rows + the attacker sentence — the finding
3. The sentence after the flip, side by side if you can
4. The frontier chart with the recommended point ringed
5. The limitations panel

## Before you submit
- [ ] Push the repo public and put the link in the submission
- [ ] Check https://anonenough.vercel.app loads in a private window
- [ ] Video uploaded and playable (unlisted is fine)
- [ ] Screenshots attached
- [ ] Read the whole writeup out loud once — if a sentence isn't how you'd say it, change it
