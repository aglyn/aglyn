---
sidebar_position: 8
title: Import and export
description: Move records and packages in and out of your workspace — choose the fields you export, match columns and existing records on import, decide every conflict, review a dry run, and undo an import for seven days.
---

# Import and export

Everything you can move in or out of your workspace is listed in one place:
**Settings → Import & export**. Each import works the same way. It shows you
what it would do before it writes anything, asks you how to handle every
conflict, and can be undone for seven days.

You need the **Manage data** permission to open the page. Owners, admins and
editors have it by default, and a custom role can grant or withhold it.

## What you can move

The page lists every kind of data your workspace's plugins can move, grouped
by plugin. A plugin your workspace doesn't run isn't listed.

- **Records** are things like contacts, leads and list members. They import
  from CSV, JSON or NDJSON files, one row per record, and export to the same
  formats.
- **Packages** are things you build rather than collect: sequences,
  campaigns, org automations, email templates and email topics. A package is one JSON
  file. It can hold several kinds of item together, so a sequence and the
  email templates it uses travel as a set.
- **Site packages** hold a site's pages, emails, forms, theme and content.
  Each site has its own, under **Backup & restore**, linked from this page.
  See [Site backup and packages](../building-sites/site-backup-and-packages.md).

Some records belong to the whole workspace and others to one site. To work
with a site's records, pick the site first. The site's own plugins decide
what is listed for it.

Some data also depends on your plan. The CRM is included from Starter, so on
Free its companies, deals, tasks, activities, pipelines, custom fields and
email templates are listed with the plan that includes them instead of
Import and Export, and contacts and leads can't be imported. Exporting your
contacts and leads works on every plan, here and in
**Settings → Privacy**.

## Export records

1. Click **Export** beside the records.
2. Choose the fields. You can pick from every field, including custom,
   calculated and system fields. Search the list, select or clear all, and
   reorder fields to set the column order.
   - **Re-importable** (the default) starts with the Aglyn ID and the fields
     records are matched on, followed by every field an import can write.
     Importing the file again updates the same records.
   - **Everything** is every field, and **Minimal** is the fewest that still
     identify each record.
   - **Save these fields as** stores your selection as a preset of your
     own. Your last choice is remembered for next time.
3. Choose what to export: the records you selected, the list's current
   filter, or everything.
4. Choose the format: CSV, JSON or NDJSON. For CSV you can add a byte-order
   mark so spreadsheet apps read accented characters correctly.

In a CSV, a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
return is written with a leading `'` (an apostrophe), so a spreadsheet app
shows it as text instead of running it as a formula. This matters most for
text visitors typed, such as form answers. Numbers in number, currency and
percent fields are written as they are, so `-5` stays a number. Importing the
file again takes the apostrophe back off. JSON and NDJSON files keep every
value exactly as stored.

The download says how many rows it should hold. If fewer arrive, it is
treated as incomplete and you're told.

## Import records

Click **Import** beside the records. The wizard takes you through eight steps,
and nothing is written before step 7.

### 1. Upload

Pick or paste a file. The wizard detects its format, encoding, separator and
header row, and shows you a preview. You can change any of these. A file that
is too large is refused before it is sent.

### 2. Columns

Each column gets a proposed field with a confidence badge:

- **Exact** means the header is a known name for the field, including the
  headers other products use in their exports (Salesforce, HubSpot, and
  others).
- **Close** means the header is similar to a field's name.
- **From the values** means the header said nothing, but the cells look
  like the field (email addresses, dates, phone numbers).

You can change the field for any column, ignore a column, or create a custom
field from it. Two columns can't map to the same field. Every required field
needs a column before you can continue.

### 3. Values

This step shows how each column will be read:

- **Changed values.** The wizard lists how many cells it reformatted and
  how, with examples. For instance, it may put a date in order, read a
  number's separators, or split a full name. Guesses that could be wrong
  are flagged.
- **Dates that could go either way.** When `03/04/2026` could be March 4 or
  April 3, you choose the order.
- **List values your workspace doesn't have.** For each one, choose to use
  an existing value, add it to the list, leave it blank, or refuse those
  rows.
- **Names that match no record.** A company or owner that doesn't match an
  existing record can be created, mapped to a record you choose, left
  blank, or have its rows refused.

### 4. Matching

Choose how rows find the records you already have. The options are the
Aglyn ID, an external ID, email, domain, name or another key, in an order
you set. The step counts how many rows are new, how many match one record,
how many match several (ambiguous), and how many repeat an earlier row in
the same file.

### 5. Conflicts

Decide what happens:

- **When a row matches a record:** update it, skip it, or create a
  duplicate.
- **When a row matches nothing:** create a record or skip the row.
- **When a row matches several records:** skip it, or pick the record
  yourself.
- **For each field:**
  - **Fill blanks** (the default) writes only where the record has no
    value.
  - **Overwrite** replaces the record's value.
  - **Keep** never changes the field.
  - **Append** adds to a list.
  - You also choose whether a blank cell leaves the value alone or clears
    it.

By default, nothing is overwritten or cleared unless you choose it. Every
row where the file and the record disagree is listed with both values, and
you can change the decision for any row or field.

A plugin's own rules are shown locked, with the reason. For example, a
contact's lifecycle stage only moves forward.

### 6. Dry run

The server plans every row without writing anything. You get counts of what
would be created, updated, left unchanged, skipped or fail, plus a
before-and-after table you can filter. Every kind of warning is listed, such
as values that will be overwritten or cleared, guesses made while reading
cells, and rows that will fail. You acknowledge each kind before **Import**
is enabled. If a change you make alters a warning's count, you're asked to
acknowledge it again.

### 7. Import

The import runs in chunks, and each row is written exactly once. Rows that
fail are listed as they happen. You can pause and resume. If you close the
tab, the import finishes on its own.

### 8. Results

You see the counts, and you can download a result file that is your file
plus three columns: what happened to each row, why, and the record it wrote.
**Undo** is available for seven days.

## Export a package

1. Click **Export package**, or **Export** beside one kind of package item.
2. Pick the items. Leave **Include what they need** on to add what the
   picked items use. For example, a sequence's email templates are added
   when the template is in your workspace, and so is the topic a campaign
   or an automation sends under.
3. Download the file.

A package carries how things are built, never what they did. It carries a
sequence's steps and settings but not who was enrolled. It carries a
campaign's copy but not its sends or results, and an automation's trigger
and steps but not its run history. It carries what an email topic is
called and what it promises, but not who chose it or who left it.

## Import a package

1. Click **Import package** and choose the file. A file that was edited
   after it was exported is refused.
2. **Items.** Each item is compared with what your workspace has, matched by
   ID, then by slug, then by name. It is marked **New**, **Same as yours** or
   **Differs from yours**. New items are created, and identical ones are
   skipped. Items that differ wait for you to choose, because a replace is
   never assumed:
   - **Replace yours** writes the package's version over yours. Undo puts
     yours back.
   - **Keep both** adds a copy with "(copy)" after its name, and points the
     package's other items at the copy. For example, a campaign in the
     package sends under the copied topic, not yours.
   - **Skip** leaves it out. Anything in the package that uses it uses yours
     instead.

   If an item's plugin would refuse it, the item is marked **Fails** with the
   reason. For example, a sequence might send from a mailbox you can't
   send from.
3. **Things this workspace doesn't have.** Items can name things that
   neither the package nor your workspace has, such as a mailbox, a site, an
   email list, an email topic or an email design. A campaign whose topic you
   leave out sends under your default topic. Choose what each one becomes:
   - **Use one you have:** pick the replacement.
   - **Leave it out:** remove the reference from every item that names it.
   - **Skip what needs it:** skip every item that names it.
   - **Import the package's copy:** available when the package has the item
     and you had skipped it.
4. **Rules every import keeps.** Each plugin lists what an import will never
   do:
   - An imported sequence arrives as a draft, and nobody is emailed until
     someone activates it. A sequence you replace keeps its status.
   - An imported org automation arrives switched off. One you replace keeps
     whether it was on.
   - Every imported campaign email is a draft, with no audience and no send
     time.
   - A personal email template becomes yours.
   - Importing an email topic never signs anybody up, asks anybody to
     confirm or sends any email. Nobody's choices change: a topic you
     replace keeps its ID, so everyone who left it stays left, and every
     unsubscribe link already sent still works.
5. **Before importing.** Acknowledge each warning (replacing, leaving
   references out, or items that fail), then click **Import**.

Each choice re-plans the package on the server, so what you review is
exactly what is written.

## Undo an import

Every import can be undone for seven days, from its results or from
**History**:

- Records an import created are deleted.
- Records and items it changed are put back the way they were.
- Anything edited since the import is listed first. You choose, one by one,
  whether to keep the edit or undo it too. Nothing edited since is undone
  unless you say so.

Some things can't be undone because of what happened since. A sequence that
has started sending stays, and so does a campaign with an email that has
been scheduled or sent. These are counted as kept.

An email topic the import added is retired rather than deleted, because an
email sent under it since carries it in its unsubscribe link. A retired
topic leaves the composer and the preference page.

## History

**History** lists every import the workspace ran, newest first. It includes
record imports, packages, and each site's package imports. For each one you
see:

- what was imported
- its status
- what it did
- who ran it, and when

Each import also offers:

- **Results**: download its result file, while it's still kept
- **Open**: reopen a record import in the wizard, to resume it or see its
  results
- **Undo**: available while undo is still open

Seven days after an import, its file and undo snapshot are cleared. The
import and its counts stay in the history.
