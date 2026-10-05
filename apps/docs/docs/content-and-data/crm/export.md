---
sidebar_position: 3.5
title: Export CRM records
description: Choose every field you want, custom fields included, and the records — the selection, the list's filter or everything — as a CSV, JSON or NDJSON file that imports back in.
---

# Export CRM records

**Export…**, in the header of the Contacts, Companies, Leads, Deals and Tasks
sections and on every [bulk bar](./bulk-actions.md), opens the export dialog. You choose the
fields, the records and the format; the file is read from the whole
collection on the server, not from the rows the list has loaded, and arrives
checked: it carries how many rows it should hold, and a download that came
up short is refused rather than saved.

Exporting the people your workspace holds — contacts and leads — is open on
every plan. Companies, deals, tasks, activities and the CRM's setup are part
of the **CRM**, included from **Starter**.

| What | Where its Export… is |
| --- | --- |
| Contacts, companies, leads, deals, tasks | The section's header (the list's filter, or every record) and its bulk bar (the selection) |
| Activities — every call, email, meeting and note the team logged | The [Recent activity](./activities.md#the-recent-activity-feed) card |
| Pipelines and their stages, one row per stage | **Export pipelines…** in the [Pipelines](./deals.md#pipelines) dialog |
| Your custom fields — name, key, record, type, choices | The [Fields](./custom-fields.md#export-fields) section |

Activities, pipelines and custom fields are exported only: each is logged or
set up on its own page, never imported from a file.

## The fields

Every field is offered, grouped as the record shows them — the person, their
phones, work, the two addresses, the CRM's own fields, activity — and your
[custom fields](./custom-fields.md) after them. Search, select all or none,
and move a field up or down to set the column order.

Presets fill the picker:

| Preset | What it holds |
| --- | --- |
| **Re-importable** (the default) | The **Aglyn ID** and the fields records are matched by first, then every field an import can write — a file you can edit and bring back in. |
| **Everything** | Every field, the ones only the platform writes included: where a person was captured, the last interaction and engagement, a company's contact count, when each record was made and changed. |
| **Minimal** | The ID and the match fields. |
| Your own | **Save these fields as…** keeps a choice under a name. The dialog remembers your last choice per section either way. |

Links to other records are written as words a file can carry back: a
contact's **company** by name, **reports to** by email, the **owner** by
email; a company's **parent** by name. The lifecycle stage and every list
value are written as your organization labels them. A company's annual
revenue is written with its currency (`1250000.00 USD`).

## The records

- **The selected records** — the rows you ticked (up to 10,000), from the
  bulk bar.
- **The current filter** — the records the list's filters and search show,
  read with the same query the list runs.
- **All contacts** (or companies) — every record the list can see.

Under a site, a contact is written through **that site's** profile of them —
its name, stage, owner and notes for the person — and only the people the
site sees are exported. At the organization level, each person is written
through their primary site, as the organization-level list shows them. A
collaborator whose access is some sites exports only what those sites see.

## The format

**CSV** (headed by the field names, so it maps straight back in; add a
byte-order mark for Excel), **JSON** (an array of records keyed by field id)
or **NDJSON** (one record per line). Each export is recorded in your
workspace's audit log — what was exported and how many rows, never the
content.

## Bringing it back in

A file exported with **Re-importable** imports into the records it came from:
the **Aglyn ID** column finds each record, and every other column is matched
to its field by name. See [Import contacts and companies](./import.md), and
the imports of [leads](./leads.md#import-from-csv), [deals](./deals.md#import-from-csv)
and [tasks](./tasks.md#import-from-csv).

## Related

- [Import contacts and companies](./import.md)
- [Bulk actions](./bulk-actions.md)
- [Privacy requests](../../workspace-and-billing/signing-in-and-sessions.md#privacy-requests) — every contact and lead as one file, from Settings
