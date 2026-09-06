---
sidebar_position: 4
title: Bulk actions
description: Select rows in any CRM table — contacts, companies, deals or tasks — and act on all of them at once, or export them as a CSV that re-imports.
---

# Bulk actions

Every table in the CRM has a checkbox on each row. Tick one or more — or the
checkbox in the header for the whole page — and a bar appears above the table
saying how many are selected, with one action for all of them. The rows on
offer are the ones the open [view](./views.md) shows, so narrowing to "my leads
in Texas" first and ticking the header checkbox acts on exactly those. Each
section's bar offers what that record can do; every bar has **Export CSV** and
**Clear**.

## Contacts

| Action | What happens |
| --- | --- |
| **Add tag** | Type a tag; it is added to every selected contact that does not already have it. Tags are lowercased, the same as on a contact's profile. A contact already holding 20 tags is skipped and named. |
| **Remove tag** | Type a tag; it is removed from every selected contact that has it. Contacts without it are left alone. |
| **Set owner** | Pick a team member. Every selected contact is assigned to them. Choose **Nobody** to clear the owner. |
| **Set stage** | Pick a lifecycle stage — subscriber, lead, marketing qualified, sales qualified, opportunity, customer, evangelist or other. |
| **Set company** | Pick a [company](./companies.md) — the same picker a contact's record has, with a **Create** row for a name nobody has filed yet. Every selected contact is linked to it, and its name is written to their records. Leave the picker empty to unlink the selection. A contact already at that company is left alone. |
| **Add to list** | Put the selected contacts on an [email audience](../../marketing-and-automation/email-campaigns/overview.md#email-lists). This runs the same check the audience's own page runs — see below. |
| **Export CSV** | Download the selected rows as `contacts-selected.csv` — the same file the table's own **Export CSV** writes over the whole page. See [the contacts file](#the-contacts-file). |
| **Remove from this site** | After a confirmation, the selected contacts leave this site's CRM. A person another site in your workspace also captured keeps that site's record; a person only this site held is deleted. This is not a privacy erasure: the person's form submissions, orders, bookings and membership records are separate and are deleted from their own pages — see [the record page](./contact-record.md#the-record-page). |
| **Clear** | Deselect everything. |

Every change lands on **this site's** record of the person. Tags, the owner,
the stage and the company are one site's knowledge of a contact, so a site
sharing a workspace with yours never sees yours change.

### The contacts file

**Export CSV** — on the table for the page on screen, on the bar for the
selection — writes every CRM column: email, name, phone, job title, company,
owner, lifecycle stage, the address as six columns, tags, sources, the last
interaction, the last time the person [engaged](./contact-record.md#last-engaged)
with a campaign, notes, and one column per [custom field](./custom-fields.md),
headed by the field's label. The owner is written as their **email address**,
because that is what the import resolves an owner by.

The header row is the [import's](./import.md) own vocabulary, so an export
**re-imports without a hand mapping** — every column is proposed to its field
from the header alone, except **Sources**, **Last interaction** and **Last
engaged**, which the platform records and a file cannot set. **Download template** in the Import
drawer hands you exactly this header over no rows.

## Companies

| Action | What happens |
| --- | --- |
| **Add tag** / **Remove tag** | As on contacts: lowercased, up to 20 per company, a company at the cap skipped and named. A company's tags show in the list and on its page, and its form has a **Tags** field. |
| **Set owner** | Pick a team member, or **Nobody** to clear the owner. |
| **Export CSV** | Download the selected companies as `companies-selected.csv` — see [Export CSV](./companies.md#export-csv), whose header is the [companies import's](./companies.md#import-from-csv) own. |
| **Delete** | After a confirmation, each selected company is [unlinked from its contacts and deleted](./companies.md#deleting-a-company), one after another, and each deletion is logged in the site's activity feed. A company with more than 500 linked contacts is unlinked from 500, kept, and named — delete again to continue. |

## Deals

The bar appears on the deals **table** (switch from the board with the
Board / Table control).

| Action | What happens |
| --- | --- |
| **Set stage** | Pick a stage of the selected deals' pipeline — an open stage or **Won**. Each deal is moved [through the server](./deals.md#moving-winning-and-losing), one at a time, so every move fires its `dealStageChanged` or `dealWon` event exactly as a drag on the board does. A selection spanning two pipelines has no one list of stages, and the dialog says so. |
| **Set owner** | Pick a team member, or **Nobody** to clear the owner. |
| **Mark lost** | Asks for one reason, then marks each deal lost through the server; the reason is kept on every deal and sent with every `dealLost` event. |
| **Export CSV** | Download the selected deals as `deals-selected.csv` — the same file the table's **Export CSV** writes: title, pipeline and stage by name, the amount in major units with its currency, the owner by email address, the expected close date, status, the contact and the company, when it closed, the lost reason and notes. |
| **Delete** | After a confirmation, the selected deals are deleted; the contacts and companies they name are untouched. Each deletion is logged in the site's activity feed. |

## Tasks

| Action | What happens |
| --- | --- |
| **Complete** | Each open selected task is completed [through the server](./tasks.md#completing-and-reopening), one at a time, so every one fires its `taskCompleted` event. Tasks already done are left alone. |
| **Assign** | Pick a team member, or **Nobody** to clear the assignee. Each task is saved through the server, so the new assignee gets the same [notification](./tasks.md#assigning-a-task-to-someone-else) the drawer sends — assigning to yourself sends nothing. |
| **Set due** | Pick a date and time for every selected task, or leave it empty to clear the due date. |
| **Export CSV** | Download the selected tasks as `tasks-selected.csv` — the same file the list's **Export CSV** writes for the view on screen: title, kind, priority, status, the due date and the completion as timestamps, the assignee by email address, the contact, company and deal by name, and notes. |
| **Delete** | After a confirmation, the selected tasks are deleted for everyone who can see them. A finished task is better ticked done, which keeps it in the Done view. |

## When a row cannot be changed

A bulk action writes in batches. If any row in the selection cannot be
written — usually because your access is scoped to certain sites and the
record belongs elsewhere, or because it was deleted while the page was open —
the rest are still written, and the ones that were not appear **by name** (a
contact's email address, a company's name, a deal's or a task's title) in a
notice under the bar, with the reason. Dismiss the notice when you have read
it. A row the action skipped on purpose (already tagged, already at the tag
limit, already done) is listed the same way. An action that goes through the
server — a stage move, a completion, an assignment — reports the server's own
sentence for each refused row.

## Adding people to an audience

**Add to list** on the contacts bar opens a dialog that:

1. Lets you pick an audience from your workspace's lists. Audiences are managed by
   members with access to every site in the workspace; if that is not you, the
   dialog says so instead of showing an empty list.
2. **Checks** every selected address against its consent record and both
   suppression lists, and tells you how many already opted in, how many have no
   opt-in on record, and how many cannot be added at all (with the reason, per
   address).
3. Offers **Add** only after the check. People with no opt-in on record are added
   only if you tick the attestation that you have their permission — the same
   statement the audience page asks for, recorded against your account with the
   date.
4. Names anyone who was not added, and why.

A large selection is checked and added a hundred addresses at a time; the counts
you see are for the whole selection. A person's own page in the CRM has the same
**Add to list** button for one contact.

## Related

- [CRM overview](./overview.md)
- [The contact record](./contact-record.md) — the same tags, owner and stage, one person at a time
- [Import contacts from CSV](./import.md) and [import companies](./companies.md#import-from-csv) — the files an export re-imports as
- [Companies](./companies.md), [Deals pipeline](./deals.md), [Tasks & follow-ups](./tasks.md) — each section's records
- [Email audiences](../../marketing-and-automation/email-campaigns/overview.md#email-lists) — including audiences built from a rule, which can target a contact's owner, lifecycle stage, company and custom fields.
