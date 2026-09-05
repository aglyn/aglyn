---
sidebar_position: 2
title: Import contacts from CSV
description: Bring a spreadsheet of people into the Contacts CRM — map its columns, preview the result, and import in batches with a report of what was added, updated and skipped.
---

# Import contacts from CSV

**Import CSV**, on the Contacts section of the CRM, takes a spreadsheet of people —
an export from another CRM, a sign-up sheet, a customer list — and adds each
person to your contacts. Someone already in your contacts is **updated** rather
than added twice: the file's phone, title, tags and other details are merged onto
the record you already have.

The address is `…/hosts/{site}/crm/contacts`. Importing needs the same
**Manage data** permission as editing a contact.

## Three steps

1. **Choose the file.** A CSV with a header row. Up to **5,000 rows** per file —
   split a larger one and import the pieces. Nothing is sent until you press
   Import.
2. **Match the columns.** Each column in the file is matched to a contact field.
   Aglyn proposes a match from the header names (`Email`, `Phone`, `Company`,
   `Tags` and their usual variants) and shows the first row's value beside each
   one so you can correct it. Choose **Do not import** for a column you do not
   want. The **email** column is required; every other column is optional.
   A **preview** of the first ten rows shows exactly what each mapping produces.
3. **Import.** Rows are sent in batches of 200 with a progress bar. When it
   finishes, the result says how many people were **added**, how many existing
   contacts were **updated**, and how many rows were **skipped** — with a
   **Download skipped rows** button that gives you those rows back as a CSV, with
   a last column saying why, so you can fix them and import that file again.

Closing the drawer during an import stops it after the batch in progress. Rows
already imported stay imported; run the same file again to finish, and the rows
from the first run are reported as updated.

## What each column can hold

| Field | What is read |
| --- | --- |
| **Email** | Required. Trimmed and lowercased; a row whose email is not a valid address is skipped. |
| **Name** | The display name. |
| **Phone** | Stored in international format (`+15125550123`). A ten-digit number is read as US/Canada; anything else needs its country code. A number that cannot be read is dropped and reported. Importing a phone number never sends anything to it. |
| **Job title** | Free text. |
| **Company name** | Matched to an existing company of yours by name, or a new company is created — the result counts the new ones. |
| **Address line 1, line 2, city, state or region, postal code, country** | The postal address. Country must be a two-letter code (`US`, `GB`); a spelled-out country name is dropped and reported. |
| **Tags** | Separated by `,` or `\|`, lowercased. Added to any tags the contact already has. |
| **Owner** | The email address of a member of your organization. An address that matches nobody on the team leaves the contact without an owner, and the result names those addresses. |
| **Lifecycle stage** | One of `subscriber`, `lead`, `marketing-qualified`, `sales-qualified`, `opportunity`, `customer`, `evangelist`, `other` — by id or by label. |
| **Marketing consent** | `yes`, `true` or `1` records a marketing opt-in for this site, dated today. Anything else records nothing. This is your statement that the person agreed; it is not a substitute for their own opt-in. |
| **Custom fields** | Every custom field you have defined under **Fields** is offered as a target. A value that does not fit the field's type — a word in a number field, a choice a dropdown does not offer — is dropped and reported. |

A value that cannot be read never stops the row: the person is imported without
it, and the result names the values it could not keep, by field.

## What is skipped, and why

| Reason | Meaning |
| --- | --- |
| **Not a valid email address** | The email cell is empty or not an address. |
| **Appears earlier in the file** | The same address is on an earlier row; the first row wins. |
| **Contact limit reached** | Your plan's contact band is full. Only the Free tier's band is a hard limit — see [Billing & plans](../../workspace-and-billing/billing-and-plans/overview.md). |
| **Could not be saved** | Something went wrong writing the record. Try that row again. |

Every imported person shows **Import** as a source on their contact and
"Imported from CSV" at the top of their activity. Contacts are shared across
your organization the same way captured ones are: a person imported on one
site is visible to that site (and any sites declared to be one sender with
it), not to every site in the account.

## Related

- [Contacts CRM](./overview.md)
- [Import a list into an email audience](../../marketing-and-automation/email-campaigns/overview.md#import-a-list) — for adding people to a mailing list rather than to the CRM
