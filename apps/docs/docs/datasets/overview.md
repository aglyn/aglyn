---
sidebar_position: 1
title: Datasets & Dynamic Content
description: Model structured content with typed fields and relations, then bind it into repeatable components.
---

# Datasets & Dynamic Content

**Datasets** are your structured content: a typed **model** plus the **records** that fill
it. Screens read from datasets to render dynamic, repeatable content, and
[forms](../forms/overview.md) write new records back in.

![The Data page in the Aglyn console, showing the empty state with an "Add dataset" button — datasets are created here, then repeated over with `{{item.field}}` bindings](/img/datasets/data-page.png)

```mermaid
flowchart LR
  Model["Model<br/>(typed fields)"] --> Records[(Records)]
  Forms[Forms] --> Records
  Records --> Repeat["Repeatable component<br/>on a screen"]
  Records --> Import["CSV / JSON<br/>import & export"]
```

:::info Plan availability
**Pro**. Free sites get a limited number of datasets; Pro and above raise the cap, and
extra-dataset add-ons are available.
:::

## Model builder

Define a model in the schema dialog with **typed fields** (text, number, date, reference,
and more). The model comes from the site's `dod.ts` blueprint at runtime, so records are
validated against it.

## Typed documents

Edit records in the **typed document editor** — each field renders the right input for its
type, so data stays clean.

## Relations

Fields can **reference** other records, including **many-to-many** relations, letting you
model real structures (posts ↔ authors, products ↔ categories).

## Query layer

A **dataset query layer** powers both the editor and screen bindings, so the same data is
available to design-time previews and the live site.

## Repeatable components

Bind a component over a dataset to repeat it per record — a list, grid, or gallery driven
by your data. The Besigner shows a **repeat badge** so you know a component is data-driven.

## Import & export

Datasets round-trip via **CSV and JSON**: export your records, edit them elsewhere, and
re-import with validation on the way in.

## Related

- [Forms & lead capture](../forms/overview.md)
- [Bindings, variables & functions](../bindings/overview.md)
- [Content collections & blog](../site-templates/overview.md)
