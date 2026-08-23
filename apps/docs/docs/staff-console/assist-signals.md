---
sidebar_position: 13
title: Assist Signal
description: The docs-gap and cost board behind Assist — how the ranking is ordered, why ungrounded questions are counted separately, and what the cache-read rate says about margin.
---

# Assist Signal

:::warning Staff only
This board reads every workspace's assist telemetry. It requires a staff claim and
is not reachable from a customer console.
:::

Assist Signal is the read side of the Assist data loop. Every assist turn writes two
documents: the **exchange**, which holds the question a customer typed and the answer
they got, and the **signal**, which holds what the turn cited, how it stopped, what it
cost and how it was rated. The board mines the signals.

The split matters for reading this page. The signal carries no prose and no user id and
never expires; the exchange carries both and is deleted after 180 days. So an old
failure still shows its counts long after its words are gone, and a row with no
question attached is not a bug.

## The workflow this board exists for

**A top row of Docs gaps becomes a docs issue.** That is the whole loop: the assistant
tells you which pages are failing, you fix those pages, and the assistant gets better
because its corpus did. Nothing else on the board is a task list — the cost panels are
for tuning, and the prose panel is evidence you read while writing the fix.

Work the board in this order:

1. **Questions the docs could not answer** — these are missing pages. Highest value,
   because no amount of editing an existing page creates one.
2. **Docs gaps** — these are pages that exist and are not doing their job.
3. **What people actually asked** — the words behind the failures in 1 and 2, to work
   out *what* to write.

## Fleet

Totals across the scanned sample: messages, tokens, estimated cost, the thumbs
tally, and how turns stopped.

**Answered free** is the share of turns served with no model call at all —
either quoted straight from the docs index or replayed from the answer cache —
with the count beside it. It is the number that decides whether Assist is
affordable to leave switched on, and it is the one to watch after a docs
rewrite: writing a page that people were asking about moves this figure up and
the estimated cost down, in the same week.

Read it against **estimated cost**, never on its own. The two can move the same
way for opposite reasons: a rise in the free share is good news, but so is a
fall in it when the reason is that people have stopped asking questions the
docs already answered.

Two of these read differently from the rest. **Stop reasons** separate a refusal from
a truncation — both look like a short answer in the data, but a rising refusal rate is
a prompt problem and a rising `max_tokens` rate is a ceiling problem, and they need
different fixes. And the **unrated** count is usually the largest of the three thumbs
figures; that is normal, not a broken control. Ratings are volunteered.

### The cache-read rate, and what a bad number looks like

The **cache-read rate** is the share of billable prompt tokens served from the prompt
cache rather than charged at full input rates. It is the single most load-bearing
margin number on the board, and it is on the board because it could not be settled any
other way.

Assist sends a large static system prompt on every turn, ordered so the unchanging part
comes first and carries the cache breakpoints. That prefix measures close to the
model's minimum cacheable length — near enough that whether it caches at all is an
empirical question rather than an arithmetic one, and it moves with the model, because
the minimum differs between model tiers.

**A prefix below the minimum does not cache, and it does not say so.** There is no
error and no warning; the requests simply cost full input rates. The bill is the only
place it shows, and this rate is the bill's early warning.

What the numbers mean:

- **A healthy rate is high** — most turns after the first should be reading the prefix
  from cache, so expect a clear majority of prompt tokens to be cache reads.
- **A rate at or near zero, with real traffic, means the prefix is not caching at
  all.** That is the failure. The usual cause is the static prefix having shrunk below
  the model's minimum, or a per-workspace value having been edited into a block that is
  supposed to be identical for everyone — one per-org byte inside a cached block gives
  every workspace its own copy, and a copy that is written and never read costs
  strictly more than not caching.
- **A rate that falls after a prompt change or a model change** points at that change.
  Both are the things that move it.

Cache writes cost more than plain input tokens and cache reads cost far less, so a
prefix that is written on every turn and read on none is the worst of the three
outcomes — and it looks, from every other panel, exactly like normal traffic.

## Where the money goes

Costs on this board are **our estimated provider cost at the serving model's list
rates**. They are telemetry for tuning price against margin. They are not a bill, they
are not charged to anyone, and they are not revenue — Assist spend is recorded as cost
of goods sold and deliberately never billed per token.

This panel splits spend two ways, and both splits carry dollars *and* message counts,
because the questions are money questions that a count cannot answer:

- **By tier** settles "is the free tier eating the margin, or are paying workspaces?"
  A tier can be a minority of turns and a majority of spend, and in exactly that case a
  turn count says the opposite of the truth.
- **By model** settles "would a cheaper model on the common path fix this?" — where the
  entire point is that turns and dollars do not move together.

Both lists are ordered dearest first, so the expensive line is the top line.

## Docs gaps

Cited pages ranked by **thumbs-down first, then by how often a question landed there**.
Not by volume.

Volume alone would produce a popularity list. The most-cited page in the corpus is
whichever page answers the most common question, and that page is usually *working* —
it gets cited constantly precisely because retrieval keeps finding it and it keeps
being right. Ranking by volume puts your best page on top and buries the one that is
being found and is not answering, which is the only row that tells you to do something.

Volume is still the tiebreak, and it is doing real work there. Between two pages with
the same number of thumbs-down, the one more people hit is the more expensive one to
leave broken.

Read a top row as: *this page is being found, and it is not answering.* The docs issue
writes itself, with its evidence attached.

## Questions the docs could not answer

A turn with no cited docs paths is a question the corpus could not match at all, so the
model answered ungrounded — from its own knowledge of the product, with nothing to
link.

These **cannot** appear in the Docs gaps ranking, and the reason is structural rather
than a filtering choice: that ranking is keyed on the docs paths a turn cited, and a
missing page cites nothing. A gap in the documentation is therefore invisible to any
path-keyed ranking, no matter how the sort is written. It has to be counted on a
different key or it is not counted at all.

So ungrounded turns are counted by **route** — the console screen the person was
looking at when they hit the gap. That is deliberately the most useful key available:
there is no page to name, but there is a screen, and "eleven people asked something
ungroundable from the bookings settings screen" is a docs assignment.

This is the sharper of the two gap signals. A thumbs-down means an answer was
unsatisfying; an ungrounded question means the documentation had nothing to say.

## What people actually asked

The verbatim question behind each failing turn, with the answer it got.

The shortlist is deliberately **not** every turn. Words are fetched only for turns that
failed — rated thumbs-down, or grounded in nothing — because those are the ones where
the counts cannot say what went wrong and the words can. Reading the successful ones
would be surveillance with a dashboard on it.

Prose is kept for 180 days and then deleted, so an older failure shows its counts with
the words gone. If a row you want the words for has none, it is past its retention
period, and that is the retention working rather than a fault.

## What Assist costs, by workspace

The same estimated cost as [Where the money goes](#where-the-money-goes), per
workspace, dearest first, with each workspace's thumbs-down count beside it.

This is where a single workspace burning an unusual amount shows up before the monthly
staff margin alert fires. A workspace high on this list *and* high on thumbs-down is
the worst combination on the board: expensive turns that are not landing.

## Reading the sample honestly

The board scans up to 20,000 signal documents. When there are more, a warning appears
at the top and **every number below it describes that sample, not the fleet**.

This is surfaced rather than hidden because a ranking cut short looks exactly like a
complete one, and this ranking decides where documentation effort goes. Treat a
truncated run as a sample: the ordering is usually still informative, the totals are
not fleet totals.

## Related

- [Feature Flags](./feature-flags.md) — Assist is behind a release flag as well as a
  plan entitlement, so a workspace sees it only when both allow it.
- [Lockdown](./lockdown.md) — the `ai-assist` feature kill switch, for a provider
  incident or a cost runaway.
- [Platform Health](./platform-health.md) — where the staff margin alert for assist
  spend is surfaced.
