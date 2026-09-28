# Judging

How a project gets from a submission to a place on a results page, and what
Hackerly does about the fact that judges are people.

## Assignment

A judge is admitted by an organiser sending a one-time access code
(`/judge/verify/<event>`). Until that code is verified, the account attached to
the judge's email address can read nothing about the event — not the project
list, not a project page, not the API. Verification is a server-side state
change, and it is the only thing that grants access.

An organiser then assigns projects, either one at a time from the assignment
matrix or automatically by track. The automatic pass prefers judges who cover a
project's track, and round-robins so one judge does not absorb the whole
queue.

A judge who declares a conflict has the assignment revoked and the project
leaves their queue. The organiser can see who withdrew, and why, in the
activity log.

## The workspace

Everything a judge needs is on one page: the demo video or live demo, the
repository, the write-up, the submission answers the panel is allowed to see,
the technology, and the rubric. The write-up is not behind a tab — it is the
second thing a judge reads after the demo.

Scores save as you type. A draft is not a submission: a judge can leave half
a review and come back, and nothing is visible to anybody else while it is in
that state. Submitting requires every criterion and a written summary, and a
refusal to submit says which of those is missing rather than quietly saving a
draft.

The queue stays visible in the sidebar, so a judge moving between projects
never loses their place.

## Comparison

Three ways, because they answer different questions.

**Side by side.** Two, three or four projects in aligned rows — tagline,
material, stack, write-up excerpt, then your score for each criterion with
the best one marked. The point is that the difference becomes obvious rather
than something you have to hold in your head while flicking between tabs.

**Head to head.** One pair, one decision, with a reason. Useful because some
judgements are relative and only become clear when the two are adjacent. A
judge's wins and losses are collected into a Bradley–Terry model and reported
as a relative strength score, normalised so the strongest reads 100. A perfect
record drives the unconstrained value to infinity, which is why the number
shown is the ratio to the leader rather than the raw parameter.

**Your own progress.** Per judge, per project, per event — and per-judge
progress across the panel, so an organiser can see who is behind.

## Scoring

Each criterion has a weight and a maximum. Weights are relative and do not
have to add up to 1; Hackerly normalises them against the total.

For one judge and one project:

```
weighted = Σ(score × weight) ÷ Σ(max × weight) × 100
```

That is the judge's own view: how they scored it, on their own terms.

## Normalisation

Raw rubric totals are not comparable across judges. One panelist reserves the
top mark for work that changes their mind; another hands out fours to anything
that runs. Averaging those numbers rewards the lenient judge, not the good
work.

So Hackerly reports two figures for every project:

1. **The weighted score**, as above.
2. **The adjusted score** — the same total rescaled against that judge's own
   distribution of reviews. Concretely, the total's z-score across everything
   that judge has submitted, mapped so that z = −2 becomes 0 and z = +2
   becomes 100, then clamped.

Standings blend them: **60% weighted, 40% adjusted**. The blend is stated on
the results page and on the organiser's console, and the raw components are
exported alongside the final figure so the ranking can be reconstructed.

Both figures are exposed through `/api/export.csv` and
`/api/export/standings.csv`, along with the per-judge normalised value, so an
organiser can check the arithmetic rather than trust it.

### When normalisation declines

If a judge scored every project identically, their scores have no spread.
There is no personal scale to correct against, and inventing one would
manufacture a difference that is not there. In that case the adjusted figure
falls back to the weighted one and Hackerly says so, in the API response and
on the results page.

The same applies with fewer than two completed reviews.

### Why not something fancier

A rank-based or Borda method would be defensible too. The z-score was chosen
because it is easy to explain to a judge in one sentence, easy to check by
hand from a spreadsheet, and degrades honestly when the data will not support
it. A method nobody can reproduce is not much use at a results ceremony.

## Privacy

- A judge can read their own review and nothing else.
- A peer returns **403**, not a filtered 200. A judge has no legitimate reason
  to ask for another judge's numbers, and a filter would confirm the peer
  exists while appearing to comply.
- Organisers of the event can read every review. They are accountable for the
  outcome, and a panel that cannot see its own coverage cannot be managed.
- Participants cannot read any of it until results are published.
- Published standings are the only thing that becomes public: a name, a team,
  a track, a rank and a score.

`tests/authorization.test.js` asserts each of these over HTTP rather than
trusting the code to look right.

## Publication

Computing standings and publishing them are separate acts. Compute fills the
`results` table and shows the ranking to organisers. Publish sets
`events.results_released` and `results.published`, and only then does anything
appear on the public results page or through the public API.

A clock never publishes anything. If an organiser never presses the button,
the results stay private indefinitely, which is the correct behaviour for a
platform that a judge has to be able to trust.

## What the CSV contains

One row per submitted review:

```
event, project, project_slug, team, track, judge, state,
<one column per criterion>, weighted_score, normalised_score,
recommend, summary, strengths, improvements, concerns, submitted_at
```

The rubric is flattened into columns, so the file opens in a spreadsheet
without a join. Cells are quoted and internal quotes doubled, and any cell
starting with `=`, `+`, `-` or `@` is prefixed with a quote so a participant's
text cannot become a formula. There is a test for that.
