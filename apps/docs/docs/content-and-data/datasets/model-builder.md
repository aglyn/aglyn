---
sidebar_position: 2
title: Build a data model
description: Define a dataset model with typed fields and edit records in the typed editor.
---

# Build a data model

A **model** is the shape of a dataset — its fields and their types. Records you add or
import in the console, or write through the REST API, are validated against it.

:::info Plan availability
**Starter** and above. Free plans have no data store; add-ons raise the dataset cap.
:::

![The data page with a dataset open](/img/datasets/data-page.png)

## Define the model

1. In **Data**, create a dataset and open the **schema dialog**.
2. Add **typed fields** — text, number, date, reference, and more.
3. Save. The model is stored on the dataset. The console and the REST API validate
   records against it; form submissions and automation steps store values as text
   without checking them.

### Display name vs reference ID

Every field has two names:

- **Display name** — the human label shown in the record editor, table headers, and
  anywhere the field appears. Rename it any time.
- **Reference ID** — the stable key used in [bindings](../../building-sites/bindings/overview.md)
  (`{{item.reference_id}}`), form field mappings, and CSV import/export.

When you create a field, the Reference ID **auto-fills from the display name** (for
example, *Roast preference* → `roast_preference`). Edit it in the same dialog to set your
own — handy when you want a short, code-friendly key that differs from the label. Once the
field is created the ID is **fixed**: records, bindings, and forms all point at it, so it
can't change without orphaning that data. Pick it deliberately, then rename the display
name freely afterward.

## Edit records

Open the **typed document editor** to add and edit records. Each field renders the input for
its type (a date picker for dates, a number field for numbers, and so on), which keeps data
consistent.

## Tips

- Model the data first, then bind it — a clean model makes [repeatable
  components](overview.md#repeatable-components) and
  [bindings](../../building-sites/bindings/overview.md) straightforward.
- Give fields a **description** in the schema dialog — it appears as a hint in
  the record editor, as a tooltip on table headers, and under the field's name
  in the schema dialog itself. See
  [naming & describing fields](../../guides/datasets-and-schema.md#naming--describing-fields).
- Use a **reference** field to link records; see [relations](relations.md).

## Related

- [Relations](relations.md)
- [Import & export](import-export.md)
- [Datasets overview](overview.md)
