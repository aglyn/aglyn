---
sidebar_position: 15
title: Repeat over data
description: Make any element render once per record of a dataset or a connected service — a list, a grid, a gallery — see the real copies on the canvas, and bound them with a filter, a sort and a limit.
---

# Repeat over data

Any element on a page can repeat. Point it at a dataset — or at what a
[connected service](#repeat-over-a-connected-service) last synced — and it
renders once per record on the published page, with each copy filled in from
that record.
A row of cards, a gallery, a team list, a price table — one design, as many
copies as you have rows.

## Turn it on

1. Select the element on the canvas.
2. Open the **Attributes** tab in the right-hand panel.
3. Scroll to **Repeat over dataset** and pick a dataset.

The rest of the repeat fields appear once a dataset is chosen. The canvas
starts drawing the real copies straight away.

## What repeats: the element, or what's inside it

Two things can sensibly repeat, and which one you want depends on the element:

- **What is inside this element** — the element stays as one frame and its
  contents are the item template. This is what you want for a Stack, a grid or
  a gallery: the element *is* the list, and each record fills it with one more
  item.
- **This element** — the element itself is copied, with everything inside it.
  This is what you want for a card, an image, a row or a placed component: the
  element *is* the item, and each record gets its own.

The **Repeat** field chooses between them. It only appears on an element that
has something inside it, because an element with nothing inside it has only
one possible reading — it repeats itself. So a leaf element, an image, and a
placed component need no choice: they are copied, one per record.

:::tip
If your copies come out nested inside one frame when you wanted them side by
side, you picked the wrong scope. Switch **Repeat** to **This element**.
:::

## Fill each copy in

Inside the repeating element, write `{{item.field}}` wherever a record's value
belongs — `{{item.name}}`, `{{item.price}}`, `{{item.photo}}`. Anything you
can type into a field can hold one, and the **Insert binding** button lists
the dataset's fields for you.

A reference field goes one hop further: `{{item.author.name}}` follows the
reference and reads the field on the record it points at. One hop only.

A token naming a field the dataset doesn't have stays on the page as written,
which is how you spot a typo rather than shipping a blank.

## See the copies while you design

The canvas draws the copies from your real records, the same ones the
published page will render, in the same order. A **repeat badge** in the
top-right corner of the repeating element names what it repeats over and how
many records it found — for example **⟳ Repeats Team · 3 records**.

When no record matches — the dataset is empty, or the filter rules every
record out — the badge turns amber and says **no records match · not shown on
your site**. The canvas still shows your design so you can keep editing it, with
each `{{item.*}}` drawn as a named chip, but the published page renders no copies
at all rather than a card full of `{{item.name}}` placeholders.

Hover a badge to read what it means and how to fix it. Click it and the
repeating element is selected, with **Repeat over dataset** opened in the
Attributes panel.

The first copy is the element you edit. Change a color, retype a heading,
drag something in — every copy changes with it, because there is only ever one
design. The copies beside it are pictures: hovering one says so. Click any
part of a copy — a heading in the third card, say — and the outline goes round
exactly what you clicked, while the panels edit the element it copies, so the
change shows in every copy at once. To type new text in place, double-click it
in the first copy.

## Bound what renders

Three optional fields decide which records appear, and they apply on the
canvas exactly as they apply on the published page:

| Field | What it does | Example |
| --- | --- | --- |
| **Repeat filter** | Keeps only matching records | `price <= 20`, `tier == plus`, `tags contains red` |
| **Repeat sort** | Orders them | `price desc`, `name` |
| **Repeat limit** | Caps how many render | `6` |

Filter operators are `==`, `!=`, `>`, `>=`, `<`, `<=` and `contains`. A filter
or sort that can't be read is ignored rather than emptying the page.

### The hundred-record ceiling

A single repeat renders **at most 100 records**, whatever the limit says. It
is a page, not a database export: one that tried to render ten thousand
rows would be slower than any visitor would wait for. Records with an explicit
order come first, in that order; the rest follow by creation.

For a bigger collection, give each record a page of its own instead of a
hundred rows on one: see [Service and location pages from a
dataset](../../guides/service-and-location-pages-from-a-dataset.md). When the
dataset has a record template on the site, each repeated row carries its
record's page as `{{item.url}}`, so a card links to it with that token.

## What you can't do

- **Repeats don't nest.** A repeat inside another repeat's template renders
  once inside each copy, using its own record — it does not multiply out.
- **A copy is not a page.** Copies share one design by definition. If one
  record needs to look different, that's a condition on the design, not a
  second design.

## Repeat over a connected service

A plugin that connects to a service — Google reviews, say — keeps a small copy
of what that service last sent: a list of items (each review) and a summary
(the overall rating and the number of reviews). Any element can repeat over
that copy the same way it repeats over a dataset, so you design the reviews
with ordinary elements — a Card, a Stack, Typography, an image, a link —
instead of styling one closed block.

1. Install the plugin and connect it to the service on the site's page for
   that plugin.
2. Select the element on the canvas and open the **Attributes** tab.
3. In **Repeat over a connection**, pick what to repeat over. Each
   connection is listed twice, by its name:
   - **each item** (for example **Google: each item**) — one copy per item,
     such as one card per review;
   - **summary** (for example **Google: summary**) — one copy holding the
     summary, such as a "4.8 stars from 120 reviews" header.

The picker lists only the connections this site has. On a site with none, it
does not appear at all.

Inside the repeating element, **Insert binding** lists the fields the plugin
provides — for example `{{item.author}}`, `{{item.rating}}`,
`{{item.text}}`. Dates read as **Nov 3, 2026**; each date also comes as
`…Iso` (for example `{{item.publishedAtIso}}`) when you need the exact
moment rather than the words.

Filter, sort and limit work exactly as they do for a dataset: **Repeat limit**
`3` shows the first three reviews, **Repeat filter** `rating >= 4` only the
good ones, and **Repeat sort** `publishedAtIso desc` the newest first.

Until the plugin has synced for the first time, there is nothing to show: a
repeat over the items renders no copies, and a repeat over the summary renders
none either, so the published page never shows an empty card.

## Hide part of a copy when a field is empty

Some records fill a field and others don't — a review the owner replied to,
and one they didn't. To draw a block only on the copies that have the value,
bind its visibility to the field:

1. Select the block inside the repeating element (for example a Box holding
   a "Response from the owner" caption and `{{item.reply}}`).
2. In the **Attributes** tab, set **Hide unless** to `{{item.reply}}` (the
   **Insert binding** button lists the fields). Every element inside a
   repeating element has this field.

Each copy whose review has a reply draws the block; every other copy leaves
it out, caption included. **Hide when** works the other way round: the block is
left out of each copy where the field holds a value. Both work the same way
inside a repeat over a dataset.

A field that is empty, `false`, `0`, `no` or `off` counts as no value. On the
canvas, the copy you edit always shows the block so you can keep designing it;
the copies beside it, Preview and the published page leave it out where the
record has no value.

## When a dataset goes away

A repeat stores the dataset's **id**, so renaming the dataset never breaks it.

If the dataset is deleted, or stops being shared with this site, the element
renders **no copies** on the published page, and its badge on the canvas says
**not available · not shown on your site**. Click the badge to choose another
dataset. A published page never goes down because its data
went away, and it never shows visitors raw `{{item.*}}` placeholders either. See
[who a dataset is shared with](../../content-and-data/datasets/overview.md#who-a-dataset-is-shared-with).

## Related

- [Datasets overview](../../content-and-data/datasets/overview.md)
- [Model builder](../../content-and-data/datasets/model-builder.md)
- [Relations](../../content-and-data/datasets/relations.md)
- [Reusable components](reusable-components.md)
- [Bindings](../bindings/overview.md)
