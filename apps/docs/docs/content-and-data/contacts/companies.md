---
sidebar_position: 8
title: Companies
description: Group your contacts under the businesses they belong to — one record per company, with its domain, owner, address and the people who work there.
---

# Companies

A **company** is the organization behind one or more of your contacts. Where a
contact is a person, a company is the account they work for: it has a domain,
an owner on your team, an address and notes of its own, and a list of the
people at it. The Companies section lives in the CRM hub at
`…/hosts/{site}/crm/companies`.

:::info Plan availability
Companies are part of the **CRM suite**, included from **Starter**; on Free the
section is shown locked. A company is a **CRM record**, counted with contacts and
deals against your plan's records band — see
[CRM records](../../workspace-and-billing/billing-and-plans/overview.md#crm-records).
:::

## The companies list

The list shows every company your site may see, newest activity first, with
its domain, how many **contacts** are linked to it, its owner and when it was
last changed. Open the column filter on **Company** to find one by name — the
search reaches every company, not only the page on screen — and filter
**Owner** to see one teammate's accounts. Clicking a row opens the company's
page.

The **Contacts** column is a count kept on the company and moved with every
link and unlink, so a page of companies costs no lookup per row. A company
linked before the count existed can read lower than its page shows; the
company's own page counts live, and is the figure to trust when the two
differ.

## Create a company

Choose **New company** above the list. A company needs a name; everything else
is optional:

- **Domain** — the bare hostname (`acme.com`). Anything pasted with it — a
  protocol, `www.`, a path — is stripped, because the domain is a key: it is
  what suggests a company for a contact from their email address.
- **Website**, **phone**, **industry**, **address** and **notes**.
- **Tags** — comma-separated, lowercased, up to 20; the same kind of tag a
  contact carries, shown in the list and set on many companies at once from
  the [bulk bar](./bulk-actions.md#companies).
- **Owner** — the member of your team responsible for the account. It defaults
  to you.

The company is saved and its page opens.

## A company's page

The page names the company in the heading and the trail, and holds its
properties, its contacts, its [deals](./deals.md), its open [tasks](./tasks.md)
and the [activity](./activities.md) logged against it. The header of the
first card carries the domain under the company's kind, the industry and the
owner as chips, **Back to companies**, and **Edit**, which opens the same form
the company was created with; **Delete company** is in the header's menu (⋮).
Every CRM record page — contact, company, deal and lead — is headed the same
way.

## Contacts at a company

The **Contacts** card lists the people linked to this company a page at a
time, most recently updated first, with the total counted by the database in
its footer; each row opens the person's page. **Add contact** finds a person
by email address or by name among the contacts your site may see and links
them. A contact belongs to one
company at a time from your site's point of view; linking them to a second
company moves them.

The link can be made from either side. On a contact's own page the
**Company** field of the Properties card is a picker over the companies your
site may see — type to search by name or domain, choose one, or type a name
nobody has filed yet and choose **Create** to make the company on the spot.
Clearing the field unlinks the person. A contact whose record carries a
company **name** but no link — from an import, or from before the picker
existed — is offered that name as the company to link or create. The
contacts table's [bulk bar](./bulk-actions.md) has **Set company** for many
people at once.

A [lead](./leads.md#converting-a-lead) converted with a company email address is
offered the company whose domain matches it, and a [CSV import](./import.md)
that names a company links each row to it — matching an existing company by
name, or creating one.

## Linked on capture

A contact created by a capture — a form, a sign-up, an order, a booking —
with a work email address is linked to the company at that address's domain
on its own, the moment the contact is created. `jane@acme.com` is filed
under the company whose **Domain** is `acme.com`, which is why the domain is
worth filling in on every company.

Three things have to be true:

- **Exactly one** company visible to the capturing site carries the domain.
  Two companies at one domain is an ambiguity the capture does not resolve
  by picking one; the contact waits for a person.
- The contact is **new** to the workspace. A repeat visit by somebody the
  address book already holds is another interaction, not a new person, and
  is not re-filed.
- The capture did not **already name** a company — a contact added by hand
  with a company picked, or an imported row with a company column, keeps the
  company you chose.

Addresses at a public mailbox (Gmail, Outlook, iCloud and the like) never
link. When no company carries the domain, nothing is created unless the
workspace has turned on **Create companies from work email domains** in
[CRM settings](./settings.md#create-companies-from-work-email-domains), in
which case the company is created from the domain and the contact linked to
it.

## Import from CSV

**Import CSV**, above the list, takes a spreadsheet of companies — an export
from another CRM, an account list — and files each one. A company already in
your list is **updated** rather than added twice: a row is matched to an
existing company by its **domain** first, and by its **name** when the row has
no domain or no company carries it. Importing needs the same **Manage data**
permission as creating a company.

The three steps are the ones the [contacts import](./import.md) walks:
choose the file (up to 5,000 rows), match its columns — Aglyn proposes a match
from the header names and shows the first row's value beside each — check the
ten-row preview, then import in batches of 200 with a progress bar and a
result that says how many were **added**, **updated** and **skipped**, with
the skipped rows downloadable as a CSV that says why. **Download template**
hands you the export's own header over no rows, so a sheet filled in against
it maps itself.

| Field | What is read |
| --- | --- |
| **Company name** | Required. A row without one is skipped. |
| **Domain** | The bare hostname (`acme.com`); a URL or `www.` is stripped. What a row is matched on first. A cell that is not a hostname is dropped and reported. |
| **Website**, **phone**, **industry**, **notes** | As on the company form; a phone that cannot be read is dropped and reported. |
| **Owner** | The email address of a member of your organization. An address that matches nobody leaves the company without an owner, and the result names those addresses. |
| **Address line 1, line 2, city, state, postal code, country** | The postal address. Country must be a two-letter code. |
| **Tags** | Separated by `,` or `\|`, lowercased. Added to any tags the company already has. |

A new company counts against your plan's [records band](../../workspace-and-billing/billing-and-plans/overview.md#crm-records);
on a plan whose band is a hard limit, rows past it are skipped as
**CRM records limit reached** — updates to existing companies still go through.

## Export CSV

**Export CSV**, above the list, downloads the companies on screen as
`companies.csv`; the [bulk bar's](./bulk-actions.md#companies) **Export CSV**
downloads the selected rows as `companies-selected.csv`. Both write the same
file: every column above plus the **contacts** count, with the owner written as
their email address, under the header the import reads — so an export
re-imports without a hand mapping, and the count maps to nothing.

## Deleting a company

Deleting a company unlinks it from every contact first, so no contact is left
pointing at a record that no longer exists. Up to 500 contacts are unlinked in
one pass; a company with more than that reports how many remain, and deleting
again continues from where it stopped. The contacts themselves are untouched.
The list's [bulk bar](./bulk-actions.md#companies) deletes a selection the same
way, one company after another.

## Who can see a company

A company follows the same per-site visibility as your contacts. It is
created in the scope a contact captured on the same site would land in — the
whole workspace when the workspace shares its data, and otherwise the sites
that present as one sender — so a section of the CRM can never show a company
to a reader who could not open the contacts at it.

## Related

- [CRM overview](./overview.md)
- [The contact record](./contact-record.md) — the people a company is made of
- [CRM settings](./settings.md) — whether a capture creates the company it could not find
- [Deals pipeline](./deals.md) — every deal names the company it is with
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md) — audiences built from a rule can target a contact's company
- [REST API — companies](/api/resources/companies)
