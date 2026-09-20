---
sidebar_position: 11
title: "A/B tests by AI: write variants, read the result"
description: "Have Aglyn AI write two to four variants for a screen, section or email experiment, and put a finished test into plain language — with the verdict decided from the counts before the model is asked anything."
---

# A/B tests by AI

:::caution Rolling out
A/B tests by AI is a **release-flagged feature, currently being rolled out** — it is
not available in your workspace yet. This page says what it does, and grows with the
feature.
:::

The test itself is yours. The experiment, its variants, the traffic split, the
conversion goal and the counters all belong to the **Experiments** card on your site's
**Marketing** page. Two AI cards sit inside that card: one writes variants while you are
setting a test up, and one reads a finished test's figures back in plain words.

Neither of them starts a test, pauses one, finishes one or moves a visitor.

## It proposes; you write {#it-proposes-you-write}

**Write variants with AI** fills the experiment editor's own fields, unsaved. The
dialog's **Save** is the only write — the same one a variant you typed yourself takes,
and **Cancel** leaves the test exactly as it was.

**Explain this result with AI** has nothing to apply at all. It is words about figures
that were already counted.

Nothing either card returns sets a traffic weight, a goal or a schedule, and nothing it
returns reaches a visitor.

## Write variants {#write-variants}

The card sits in the experiment editor, beneath the list of variants it writes for.

1. Give it **the copy under test** — the headline and copy as they stand on the page, or
   the subject line and message as they stand. For an email the control's subject and
   body are filled in from the first variant, so usually there is nothing to paste.
2. **Write variants.** It writes between **two and four**: a test needs a first variant
   and at least one to compare against it, and the card stores no more than four. The
   first one it writes is your copy unchanged, so the test has something to measure
   against.
3. Each variant comes back with a name, its copy, and one sentence saying what it changes
   and what that is testing.

What a variant varies depends on what the test varies. An email variant varies its
subject line, its preheader and its body; a screen or a section variant varies the copy
on it. A variant that fills the other kind's fields has them dropped.

### Putting them in {#putting-them-in}

**Put into the variants** places the proposal in the editor's own fields, unsaved:

- For an **email**, each variant takes its name, subject and body.
- For a **screen or a section**, each variant takes its **name** only. The copy itself is
  a screen version, so you make one per variant in the editor and pin it above — read the
  proposed copy on the card and build from it.

Then review them and **Save** the experiment, or **Cancel**.

The editor's list is the test's shape, and the card does not change it: a proposal is
mapped onto the variants you already have, in order, and anything past them is ignored.
Add a variant row first if you want a fourth.

Two things are refused rather than pasted. The fields are plain text, so a variant
carrying markup is dropped; and a variant whose copy repeats another's is dropped, since
two identical arms are not a test.

### What it will not write {#what-it-will-not-write}

It writes copy and nothing else — no weight, no traffic split, no goal and no schedule.
It is also told never to invent a fact, a price, a name, a statistic or a guarantee that
the copy under test did not give it, and to write in that copy's own language.

## Read a result {#read-a-result}

The second card sits in a test's results dialog, below the figures. **Explain this
result with AI** reads the same figures you are looking at.

### The verdict is decided before the model is asked {#the-verdict}

This is the part worth understanding, because it is the opposite of how it looks. The
product does not ask a model what your test showed and print the answer. It works out
what the figures support from the counts alone, and only then asks for the words.

Three things have to hold before a comparison is read at all:

- **Enough visitors.** Every variant needs at least **200 exposures**. Below that the
  test is *early* rather than *inconclusive*, and those are different instructions: one
  says wait, the other says stop.
- **Enough conversions.** At the pooled rate across the test, each variant must expect at
  least five conversions *and* five non-conversions — the condition the comparison behind
  the confidence figure rests on. This is what stops a test with a hundred thousand
  visitors and four conversions reading as a decided one.
- **A bar that rises with the number of challengers.** One comparison is called at 95%,
  the same confidence the card's own auto-winner uses. But testing three challengers at
  95% each would call a winner by chance about one time in seven, so the bar is corrected
  upward for every extra chance taken. Four variants are held to a stricter bar than two.

What comes out is one of five readings:

| What the figures support | What the card says |
| --- | --- |
| A challenger is ahead by more than chance explains | **One variant is ahead** |
| Every challenger is behind by more than chance explains | **The first variant is ahead** |
| A variant has not been shown to enough visitors, or too little has converted | **No result yet** |
| Enough has happened, and nothing separates the variants | **No winner** |
| These are not a first variant and something to compare against it | **Nothing to read** |

A challenger the card could not compare against the control can never win — and it leaves
the control undecided too. Not knowing is not evidence either way.

### The model gets the words, not the verdict {#the-words}

The explanation is then held to that reading:

- It may name a variant only where the reading named one, and only **that** variant. A
  different one is removed from the answer.
- On an undecided result, a sentence claiming a winner is **dropped, not softened** — a
  hedge in front of a claim still reads as the claim. So is a sentence that tells you to
  ship, roll out, adopt or switch to one, because recommending a variant is naming a
  winner whatever words it avoids.
- On an undecided result the **what to do next** line is the product's own sentence
  rather than the model's, so the one field that invites a recommendation cannot carry a
  smuggled winner.
- Every number in the explanation is one from the figures it was given. It computes none.

### An undecided result reads as undecided {#undecided}

A card can undo all of that silently — a confident heading, a highlighted row, a badge
saying which to ship — and you would take the layout for the claim. So where the reading
named no variant:

- the chip states the absence — **No result yet**, **No winner**, **Nothing to read** —
  in a neutral color rather than a positive one;
- a sentence saying what the test did not settle sits **above** the explanation, so that
  someone who reads one line reads that one;
- **no variant is marked ahead**, including the one with the best rate;
- **no confidence level is quoted.** The "called at" line appears only where a variant is
  actually named.

Below the words, the test's own figures are laid out unchanged whatever the verdict —
shown, conversions, rate, lift and confidence for each variant, as totals since the test
started, exactly as the results dialog reports them. You can always see what the reading
was made from.

The short version: **it will not name a winner your numbers do not support.** An
overconfident explanation of noise is worse than no explanation, so the one judgment the
model is never trusted with is whether there is anything to explain.

## What is sent {#what-is-sent}

- **For variants** — the copy you gave it, up to 4,000 characters, along with the test's
  name, what it varies and the conversion goal it is trying to move.
- **For an explanation** — the test's name and each variant's counts: exposures,
  conversions, rate, lift and confidence, as the results already report them.

No contact, lead, deal, form submission or list member is read for either.

## Who can use it {#who-can-use-it}

A/B testing is a plan feature of its own: it starts at the **Business** plan and is not
included below it. Where a workspace does not have it, the Experiments card offers an
upgrade note in place of the editor and the list — so there is no experiment to open, and
neither AI card has anywhere to appear.

Above that, both cards need what every generative surface needs: AI generation open on
your workspace and the **Generate with AI** permission on your role — see
[Custom roles & permissions](../workspace-and-billing/teams-and-roles/custom-roles.md#ai-permissions).
Where either is missing the card is simply absent rather than shown and disabled, so an
experiment editor looks as it always did.

Both cards draw on your workspace's AI credits like any other AI request, and the same
[allotments and caps](ai-allotments.md) apply.

## Related

- [How Aglyn AI builds](how-aglyn-ai-builds.md)
- [Marketing overlays](../marketing-and-automation/marketing-overlays/overview.md)
- [Email campaigns](../marketing-and-automation/email-campaigns/overview.md#experiments)
- [Rewrite and write copy with AI](copy-assist.md)
- [AI allotments, usage and model choice](ai-allotments.md)
- [Aglyn AI](overview.md)
