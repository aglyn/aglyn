---
sidebar_position: 1
title: Datasets & Dynamic Content
description: Model structured content with typed fields and relations, then bind it into repeatable components.
---

# Datasets & Dynamic Content

**Datasets** are your structured content: a typed **model** plus the **records** that fill
it. Screens read from datasets to render dynamic, repeatable content, and
[forms](../forms/overview.md) write new records back in.

Datasets belong to your **organization**, not to a single site — every site in the
organization shares the same collections. Manage them from the organization **Data**
page (next to Media in the organization tabs), or from any site's Data page; both edit
the same data. Dataset limits, storage, and add-ons are billed at the organization
level.

![The Data page in the Aglyn console: an organization-shared dataset with its records table, filter and sort inputs, and Import/CSV/JSON actions](/img/datasets/data-page.png)

```mermaid
flowchart LR
  Model["Model<br/>(typed fields)"] --> Records[(Records)]
  Forms[Forms] --> Records
  Records --> Repeat["Repeatable component<br/>on a screen"]
  Records --> Import["CSV / JSON<br/>import & export"]
```

:::info Plan availability
**Starter** and above. Free plans have no data store; higher tiers raise the dataset
and record caps, and extra-dataset add-ons are available.
:::

## Model builder

Define a model in the schema dialog with **typed fields** (text, number, date, reference,
and more). The model is stored on the dataset itself, and records are validated against
it on every server-side write.

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

## Who a dataset is shared with

Datasets belong to the **workspace**, not to a single site, so one dataset can drive pages
on every site you run. When that isn't what you want, the **Sharing** control on each
dataset decides which sites can see it:

- **All sites** — everyone in the workspace, on every site. The default, and what every
  existing dataset already uses.
- **This site only** — the dataset is usable on one site and invisible everywhere else.
- **Selected sites…** — pick the sites that share it, up to 30.

This matters most for agencies. If you run three internal sites alongside twelve client
sites, your rate card can be shared with the internal three and stay invisible to the
clients — including to the client collaborators you have invited, who will not see it in
the Data page, the pickers, or anywhere else.

Sharing is enforced on the **server**, not just in the console. A site cannot render a
dataset it hasn't been shared with even if a page explicitly asks for it by name.

A few consequences worth knowing:

- **Narrowing sharing can empty a live page.** If a published page repeats over a dataset
  and you remove that site, the page renders with no rows. The console warns before saving
  a change that takes a site's access away.
- **Reference fields need both sides.** A reference from one dataset to another only
  resolves on sites that can see both, so the target's sharing has to cover the source's.
- **Limits are workspace-wide.** Your dataset and record allowances count everything the
  workspace owns, whether or not you can see it all. Sharing decides visibility, not
  billing.
- **Deleting is a workspace action.** A dataset shared with more than one site can't be
  deleted from a single site's Data page — narrow its sharing instead, or delete it from
  the workspace Data page.

## Import & export

Datasets round-trip via **CSV and JSON**: export your records, edit them elsewhere, and
re-import with validation on the way in.

A whole-site export includes the datasets and media **that site can see**, and nothing
else — an agency exporting a client site gets that client's data only. On restore,
everything comes back shared with **the site you restored into**, not with whatever it was
shared with before. Widen it afterwards if you meant to share it. That direction is
deliberate: a bundle can be restored into a different site or a different workspace
entirely, and quietly re-publishing one client's data across another's sites would be far
worse than an extra click.

## Related

- [Forms & lead capture](../forms/overview.md)
- [Bindings, variables & functions](../../building-sites/bindings/overview.md)
- [Content collections & blog](../../building-sites/site-templates/overview.md)
