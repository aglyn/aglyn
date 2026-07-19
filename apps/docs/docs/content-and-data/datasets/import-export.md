---
sidebar_position: 4
title: Import & export
description: Round-trip dataset records through CSV and JSON with validation on import.
---

# Import & export

Datasets **round-trip** through CSV and JSON, so you can edit data in bulk elsewhere and
bring it back.

:::info Plan availability
**Starter** and above (datasets need the data store).
:::

![The data page toolbar carries import and export](/img/datasets/data-page.png)

## Export

Export a dataset's records to **CSV** or **JSON** — useful for backups, bulk edits in a
spreadsheet, or moving data into another tool.

## Import

Import CSV or JSON back into a dataset. Imports are **validated** against the
[model](model-builder.md) on the way in, so malformed rows are caught rather than silently
corrupting your data.

### Upsert on a key field

Pick a **"Match on field"** in the import dialog to de-duplicate: rows whose key value
(say, an email) matches an existing record **update it in place** instead of appending
a duplicate, and repeated keys within the same file collapse to the last row. Only
genuinely new rows count against your record limit.

## Tips

- Export first to get the exact column shape, edit that file, then re-import.
- Keep reference fields pointing at valid record ids so [relations](relations.md) survive the
  round-trip.

## Related

- [Build a data model](model-builder.md)
- [Relations](relations.md)
