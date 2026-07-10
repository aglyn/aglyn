---
sidebar_position: 2
title: Build a data model
description: Define a dataset model with typed fields and edit records in the typed editor.
---

# Build a data model

A **model** is the shape of a dataset — its fields and their types. Records are validated
against it, so your data stays clean.

:::info Plan availability
**Pro**. Free sites get a limited number of datasets; add-ons raise the cap.
:::

## Define the model

1. In **Data**, create a dataset and open the **schema dialog**.
2. Add **typed fields** — text, number, date, reference, and more.
3. Save. The model is backed by the site's `dod.ts` blueprint at runtime, so records are
   validated on the way in.

## Edit records

Open the **typed document editor** to add and edit records. Each field renders the input for
its type (a date picker for dates, a number field for numbers, and so on), which keeps data
consistent.

## Tips

- Model the data first, then bind it — a clean model makes [repeatable
  components](../datasets/overview.md#repeatable-components) and
  [bindings](../bindings/overview.md) straightforward.
- Use a **reference** field to link records; see [relations](relations.md).

## Related

- [Relations](relations.md)
- [Import & export](import-export.md)
- [Datasets overview](overview.md)
