---
sidebar_position: 2
title: Datasets & schema deep-dive
description: Field ids vs display names, the typed model, per-plan record quotas, import/export, repeatables with item bindings, and every writer that can append records.
---

# Datasets & schema deep-dive

This guide goes one level below the
[datasets overview](../content-and-data/datasets/overview.md): how the typed
model actually works, what the limits are, and every path data takes in and
out of a dataset.

<!-- regenerate: node tools/e2e/capture-docs-shots.mjs -->

## Display names vs field ids

A dataset field has two names, and the distinction matters everywhere:

- The **display name** is what you type in the schema dialog and what table
  headers and record editors show. Rename it freely.
- The **field id** is a slug generated **once** from the display name when the
  field is created (`Visit frequency` → `visitFrequency`). It never changes
  afterwards. Records store values keyed by field id, and it's the key you use
  in `{{item.fieldId}}` bindings and form **Field name** properties.

The schema dialog shows both — each field row reads `Display name · fieldId`.
The dataset itself likewise has a **Singular name** and a **Plural name**; the
plural is the dataset's display name, which is what forms'
"[Write to dataset](build-and-publish-a-survey.md#5-point-the-form-at-the-dataset)"
matches on.

![The schema dialog's field editor with Display name, Type, Required, Description, and Default value inputs](/img/guides/datasets-schema-field-editor.png)

## The typed model

A dataset's **model** is a map of field definitions plus a display order.
Each field definition carries its type, whether it's **Required**, an optional
**Description** and **Default value**, validation (regex pattern, min/max
length, an enum of **Options**), and — for reference fields — the target
dataset and delete behavior.

The types you can author:

| Type | Holds |
| --- | --- |
| **Text** | Strings; optionally pattern-, length-, or enum-constrained |
| **Boolean** | true / false |
| **Integer** | Whole numbers |
| **Number** | Floating-point numbers |
| **Date & time** | Timestamps |
| **Coordinates** | Latitude / longitude pairs |
| **List** | Ordered arrays |
| **Reference** | A link to a record in another dataset — see [relations](../content-and-data/datasets/relations.md) |

Plugins can register **custom field types**, which appear in the type picker
suffixed with the plugin id. Records are validated and coerced against the
model on every server-side write.

:::info Legacy datasets
Datasets created before typed models (a flat comma-separated field list) still
work: the runtime derives an *effective model* where every column is an
optional text field whose id equals the column name. Open the schema dialog
and re-type the fields to upgrade — ids are preserved.
:::

Reference fields configure what happens **when a referenced document is
deleted**: *Clear the reference* (default) or *Block the delete*. Tick
*Allow multiple* for many-to-many relations.

## Record quotas per plan

Dataset counts and records per dataset are entitlements of your organization's
plan:

| Plan | Datasets | Records per dataset |
| --- | --- | --- |
| Free | — (no data store) | — |
| Starter | 3 | 1,000 |
| Pro | 15 | 10,000 |
| Business | 100 | 100,000 |
| Advanced | 500 | 1,000,000 |

- Creating datasets on Free is rejected with *"Datasets require a Starter plan
  or higher."*
- Hitting the record cap surfaces *"Record limit reached — see Billing to
  upgrade"* in the console, and imports that would overflow are refused with
  the exact slot math.
- **Form submissions never fail on quota** — if the dataset is full the record
  write is skipped silently, but the inbox copy is always kept.
- [Add-ons](../workspace-and-billing/billing-and-plans/add-ons.md) raise the
  dataset count beyond the base allowance, up to a hard per-plan ceiling.

## Import & export

The Data page round-trips **CSV and JSON**:

- **Export** — the **CSV** and **JSON** toolbar buttons download the loaded
  records with one column per model field.
- **Import** — the **Import records** dialog takes pasted **CSV (with a header
  row) or a JSON array**. Columns match by field id first, then
  case-insensitively by display name; rows are validated against the model on
  the way in.
- **Upsert** — pick a **Match on field (upsert)** key (say, an email field) and
  matching rows update records in place instead of appending duplicates. Only
  genuinely new rows count against the record quota.

![The Import records dialog with the CSV/JSON textarea and the Match on field upsert select](/img/guides/datasets-import-dialog.png)

See [import & export](../content-and-data/datasets/import-export.md) for
round-trip tips.

## Repeatables

Containers (like a Stack) have a **Repeat over dataset** property. Set it and
the container's children become an **item template**, rendered once per record
on the published site:

1. Select the container and set **Repeat over dataset** to your dataset
   (stored by id, so renames never break it).
2. Inside the children, reference record values with `{{item.fieldId}}` —
   e.g. `{{item.name}}`, `{{item.price}}`.
3. Reference fields support one hop: `{{item.author.name}}` resolves the
   referenced record's field.
4. Optionally set a **Repeat limit**, a **Repeat filter**
   (`price <= 20`, operators `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`),
   and a **Repeat sort** (`price desc`).

The canvas doesn't expand rows while designing — it shows a repeat notice on
the container ("children render once per record on the live site") so you
design a single template. Up to 100 records render per repeatable.

![A Stack selected in the Besigner with its Repeat over dataset, Repeat limit, and Repeat filter properties shown in the inspector](/img/guides/datasets-repeat-binding.png)

## Everything that writes records

| Writer | How it behaves |
| --- | --- |
| **Console** — **Add record** / record editor | Typed inputs per field; validated and quota-checked. |
| **Console** — **Import records** | Bulk CSV/JSON with validation, upsert, and quota math. |
| **Forms** — the Form element's **Write to dataset** | Appends on each submission, mapping fields by name; best-effort (quota-full submissions keep only the inbox copy). See the [survey guide](build-and-publish-a-survey.md). |
| **Automations** — the **Write to a dataset** step | Appends a record from a workflow/action run. |
| **Automations** — the **Update a dataset record** step | Updates a matching record (by email) or appends when none matches. |

Automation steps live in the **Do** list of an action — see
[workflows & actions](../marketing-and-automation/workflows-and-actions/overview.md).

## Related

- [Build & publish a survey](build-and-publish-a-survey.md)
- [Datasets overview](../content-and-data/datasets/overview.md)
- [Build a data model](../content-and-data/datasets/model-builder.md)
- [Relations](../content-and-data/datasets/relations.md)
- [Bindings, variables & functions](../building-sites/bindings/overview.md)
