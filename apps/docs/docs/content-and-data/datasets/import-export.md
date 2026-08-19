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
spreadsheet, or moving data into another tool. The **CSV** and **JSON** buttons on the
data toolbar export the **whole dataset**, not the page of records currently on screen.

### What you get {#export-contents}

- **Every record**, in a stable order that is the same on every export of the same data.
- **Every field in the model, in model order** — the CSV's header row is the field ids,
  and the JSON is an array of objects keyed by the same ids. A field with no value comes
  out empty rather than being omitted.
- **Values in their portable form**, which is the form the importer reads back: dates as
  ISO-8601, coordinates as `latitude, longitude`, lists and references comma-joined, and
  map fields as JSON. That is what makes the round-trip lossless.

The file is named after the dataset. Nothing is filtered out — a search or sort you have
applied in the table does not narrow the export.

### Large datasets {#large-exports}

The server streams the file rather than assembling it in your browser, so the size of the
dataset is not the limit it used to be. Two things follow:

- The button reads **Exporting…** while it runs. A large dataset takes a while; leave the
  page open until the download starts.
- The download is **checked before it is saved**. The server states how many records it
  is sending, and if fewer arrive — a dropped connection mid-transfer — the export is
  refused with *"Export incomplete"* and nothing is saved. Run it again. A short file is
  otherwise perfectly well-formed and gives you no way to notice it is short.

Records added while an export is running may or may not be included; the count is taken
when the export starts.

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
