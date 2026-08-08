# AnonEnough

**Deleting names is not anonymizing.**

Live: **https://anonenough.vercel.app** · Runs entirely in your browser. Nothing is uploaded — turn off your Wi-Fi and it still works.

---

## The problem

A school paper runs an anonymous survey: hours of sleep, stress, whether you've been offered a vape, whether you feel safe. People answer honestly *because* they were promised anonymity.

Before publishing the results, the editor deletes the **Name** column. That feels like enough. It isn't.

The other columns are still there, because you need them for the breakdowns. And if only one respondent is a *12th-grader in Track*, then that row — with no name on it — still points at exactly one real person. Anyone at the school who knows who that is can now read their answers.

AnonEnough is the tool for the moment right before you hit publish.

## What it does

1. **Finds who is still identifiable.** Groups rows by the combination of things an outsider would recognise, and turns red every row that describes exactly one person. A column reads `1 of 1` / `1 of 14`.
2. **Says it out loud.** Click a red row and it writes the sentence someone could use: *"This is the only 12th-grader in Track."*
3. **Fixes it, at the smallest possible cost.** It searches every combination of ways to blur the data — banding grades, rolling activities up to categories, dropping a column — and picks the one that protects everyone while changing your published statistics least. The same sentence then reads *"one of 10 students in grades 9–12 in Track."*
4. **Tells you what it does not cover.** A permanently visible panel states the assumed attacker and the limits. It never says "safe."
5. **Lets you be the attacker.** Pick the two things you'd plausibly know about a classmate and watch the survey narrow — sometimes to one person, with their answers attached.

## The maths, and where it comes from

| What | How it's computed |
|---|---|
| **k** | Group rows by their generalized quasi-identifier tuple; k is the smallest group size. This is minimum **sample** equivalence-class size — it assumes one row per person and is not population uniqueness (Sweeney 2002). |
| **Prosecutor risk** | 1 ÷ k. Assumes the attacker already knows their target answered. |
| **Journalist risk** | 1 ÷ (smallest matching group in the *population*), using a school roster. Always ≤ prosecutor risk. With no roster supplied the app reports prosecutor risk and labels it an upper bound (El Emam & Dankar 2008). |
| **Analysis fidelity** | 1 − total variation distance between the tables you declared you'd publish, computed from the raw data versus reconstructed from the anonymized release. TVD = ½·Σ\|P−Q\|, so it reads as the largest error you could make in any single published proportion. Measured **only** over declared tables — never a general claim that the data is "still good". |
| **l-diversity** | Distinct and entropy l-diversity over the sensitive answer within each group. k protects identity, not answers: a 9-person group that splits 8-to-1 is k-anonymous and still gives an attacker the answer 89% of the time (Machanavajjhala et al. 2007). |
| **The search** | Every combination of generalization levels is evaluated, and for each privacy target the app keeps the one with the highest surviving fidelity. |

### The generalization ladders are nested, on purpose

The search is only correct if moving one rung up **merges** groups and never splits them — that's what makes k monotone.

Band widths are therefore powers of two. Arbitrary widths do not nest: at width 2, ages 4 and 5 share the band `4–5`, but at width 5 they split into `0–4` and `5–9`. That splits a group while ostensibly generalizing, which would make k *fall* as you coarsen.

This project shipped that bug. The original test watched k on one dataset and passed, because that dataset happened to contain no violating pair. `scripts/verify-ladders.ts` now asserts the nesting property directly, over 28,560 value pairs per column including fractional and negative inputs.

Band **labels** are named after the values actually in them, so a band reads `grades 9–12` rather than its arithmetic bounds `8–15`. That is presentation only — grouping is unchanged.

## What it does NOT claim

- **Not a guarantee of anonymity.** It measures risk under a stated attacker model. The strongest sentence it will produce is "every group has at least k people in it, under this model."
- **Does not model** free-text answers, submission timestamps, joins against any other published list, or knowledge beyond the declared columns.
- **k says nothing about answers.** The app reports the worst group's answer predictability separately, because reporting only perfectly-unanimous groups reads as reassurance exactly where it shouldn't.
- **Non-integer and negative values** get mathematically correct but awkwardly-labelled bands. Known limitation.
- The suppression sentinel is `∗` (U+2217) and tuple keys join on U+0000; a CSV containing those characters could in principle collide.

## Demo data

Synthetic. Generated by `src/lib/generate.ts` from a committed seed, labelled as generated on every screen. **No real student's answers appear anywhere in this tool** — demonstrating a re-identification tool on real classmates' survey answers would be the exact harm the tool exists to prevent.

The seed was chosen by a search in `scripts/verify.ts` against a stated acceptance predicate (a handful of unique rows, at least one homogeneous group, a knee that keeps most of the published tables). That's disclosed rather than hidden: the maths is identical on any CSV you drop in, which you can check by dropping in your own.

There's also a **hand-written 12-row sample** whose job is to be checkable without trusting the app — count the groups on your fingers and confirm every number on screen.

## Run it

```bash
npm install
npm run dev            # development
npm run build          # production build
npx tsx scripts/verify.ts          # engine + seed search
npx tsx scripts/verify-ladders.ts  # the nesting proof
```

## Built with

React 19, TypeScript, Vite, PapaParse, and no backend. No LLM anywhere in the product — every number is arithmetic you can check by hand, and that's what makes "works with Wi-Fi off" true.

## References

- Sweeney, L. (2002). *k-anonymity: a model for protecting privacy.* IJUFKS.
- Sweeney, L. (2000). *Simple Demographics Often Identify People Uniquely.*
- Machanavajjhala, A. et al. (2007). *l-diversity: Privacy beyond k-anonymity.*
- El Emam, K. & Dankar, F. (2008). *Protecting privacy using k-anonymity.*
