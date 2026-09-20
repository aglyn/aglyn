---
sidebar_position: 15
title: Repeat over data
description: Make any element render once per record — a list, a grid, a gallery — see the real copies on the canvas, and bound them with a filter, a sort and a limit.
---

# Repeat over data

Any element on a screen can repeat. Point it at a dataset and it renders once
per record on the published page, with each copy filled in from that record.
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
corner of the element names what it repeats over and how many records it
found.

The first copy is the element you edit. Change a color, retype a heading,
drag something in — every copy changes with it, because there is only ever one
design. The copies beside it are pictures: they can't be selected, dragged or
edited, and nothing you do to them is saved, because there is nothing there to
save.

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
is a page, not a database export: a screen that tried to render ten thousand
rows would be slower than any visitor would wait for. Records with an explicit
order come first, in that order; the rest follow by creation.

For a bigger collection, give it a screen per record instead of a hundred rows
on one.

## What you can't do

- **Repeats don't nest.** A repeat inside another repeat's template renders
  once inside each copy, using its own record — it does not multiply out.
- **A copy is not a page.** Copies share one design by definition. If one
  record needs to look different, that's a condition on the design, not a
  second design.

## When a dataset goes away

A repeat stores the dataset's **id**, so renaming the dataset never breaks it.

If the dataset is deleted, or stops being shared with this site, the element
renders **once, as you designed it** — tokens and all. A published page never
goes down because its data went away. See [who a dataset is shared
with](../../content-and-data/datasets/overview.md#who-a-dataset-is-shared-with).

## Related

- [Datasets overview](../../content-and-data/datasets/overview.md)
- [Model builder](../../content-and-data/datasets/model-builder.md)
- [Relations](../../content-and-data/datasets/relations.md)
- [Reusable components](reusable-components.md)
- [Bindings](../bindings/overview.md)
