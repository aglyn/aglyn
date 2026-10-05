---
sidebar_position: 8
title: Companies
description: Group your contacts under the businesses they belong to — one record per company, with its domain, owner, type, industry, addresses, parent company and the people who work there.
---

# Companies

A **company** is the organization behind one or more of your contacts. Where a
contact is a person, a company is the account they work for: it has a domain,
an owner on your team, billing and shipping addresses, the account fields a
Salesforce Account carries — type, industry, rating, revenue, employees and
the rest — and a list of the people at it. The Companies section lives in the
CRM hub at `…/hosts/{site}/crm/companies`.

:::info Plan availability
Companies are part of the **CRM**, included from **Starter**. On Free the section is
shown locked, with the rest of the CRM. A company is a **CRM record**, counted with
contacts and deals against your plan's records band — see
[CRM records](../../workspace-and-billing/billing-and-plans/overview.md#crm-records).
:::

## The companies list

The list shows every company your site may see, most recently changed first,
with its domain, how many **contacts** are linked to it, its owner, when it was
last changed and its [**next activity**](./tasks.md#next-activity) — when the
earliest open task against it is due. The table's **Search** box finds a
company by a word of its name or its domain. **Filters** › **Company** finds
one whose name **equals** what you type, or **starts with** it — which
orders the list by name — **Filters** › **Owner** shows one teammate's
accounts, or any of several, **Filters** › **Type**, **Industry** and
**Rating** show the companies holding one value of that list, or any of
several, and **Next activity** › **is empty** keeps only the companies with
nothing scheduled.

**Type**, **Industry**, **Rating**, **Account source**, **Employees** and
**Annual revenue** are optional columns: turn one on from a column's menu
(⋮ › **Manage columns**), and a [saved view](./views.md) that shows it keeps
it.

Every filter and the search are answered by the list's query, so they reach
every company, a page at a time, not only the page on screen, and filters on
different columns add up. The search matches whole words from their start —
"cof" finds *Coffee*, a fragment from the middle of a word does not — one word
at a time: type several and it searches the first, and says so. Under a
site, a member whose access is limited to particular sites searches by the
start of a company's name, and a notice says so. When a
combination cannot be answered by one query, the list does not apply that
filter, and a notice above the table names it and says why; see
[Filter and search a list](../../getting-started/console-tour.md#filter-and-search). The
**Company** column's header sorts only the rows of the page on screen; the
pages keep the list's own order. Clicking a row opens the company's page.

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
The form is grouped the way a Salesforce Account is:

**Account information**

- **Parent company** — another company this one sits under, such as a
  subsidiary's group. It is chosen from the companies your site may see; a
  company cannot be its own parent, nor sit under a company that is already
  under it.
- **Website**, **phone** and **fax**. Phone and fax numbers need a country
  code (`+1 512 555 0123`).
- **Type**, **Industry**, **Rating**, **Ownership** and **Account source** —
  each a choice from your organization's list, managed on the **Companies**
  tab of [Fields](./custom-fields.md#picklist-values) (**Account source** is
  the [lead source](./leads.md) list, on the **Leads** tab). A new company
  starts on each list's default, when you have set one. A company that holds
  a value the list no longer offers — an industry typed before Industry was a
  list, or a value since deactivated — keeps it until you change it.
- **Account number**, **Account site** (which of the company's locations the
  record is, such as *Headquarters*), **Ticker symbol** and **SIC code**.
- **Employees** — a whole number.
- **Annual revenue** and its **currency** — typed in the currency's main unit
  (`1250000.00`); the default currency is USD.
- **Owner** — the member of your team responsible for the account. It defaults
  to you.
- **Tags** — comma-separated, lowercased, up to 20; the same kind of tag a
  contact carries, shown in the list and set on many companies at once from
  the [bulk bar](./bulk-actions.md#companies).

**Address information** — the **billing address** and the **shipping
address**; **Copy billing address** fills the second from the first.

**Description information** — **notes**.

The company is saved and its page opens.

### The lists behind the choices

| Field | Standard values |
| --- | --- |
| **Type** | Analyst, Press, Competitor, Prospect, Customer, Reseller, Integrator, Investor, Partner, Consulting, Other |
| **Industry** | Agriculture, Apparel, Banking, Biotechnology, Chemicals, Communications, Construction, Consulting, Education, Electronics, Energy, Engineering, Entertainment, Environmental, Finance, Food & Beverage, Government, Healthcare, Hospitality, Insurance, Machinery, Manufacturing, Media, Not For Profit, Recreation, Retail, Shipping, Technology, Telecommunications, Transportation, Utilities, Other |
| **Rating** | Hot, Warm, Cold |
| **Ownership** | Public, Private, Subsidiary, Other |
| **Account source** | Your lead sources |

Every organization has the standard values; you can rename, reorder,
deactivate or set a default on them, and add your own. Renaming a value
renames it on every company that holds it.

## A company's page

The page names the company in the heading and the trail, and holds its
properties, its contacts, its [deals](./deals.md), its open [tasks](./tasks.md)
and the [activity](./activities.md) logged against it. The header of the
first card carries the domain under the company's kind, the type, the
industry, the rating and the owner as chips, **Back to companies**, **Call** and **Log a call** (see
[click to call](./activities.md#click-to-call)), and **Edit**, which opens the
same form the company was created with; **Delete company** is in the header's
menu (⋮). The card lists the rest in the form's three groups — the parent
company (a link to its page) and the other account information, the billing
and shipping addresses, and the notes. The company's phone number is a link on
the properties card too.
Every CRM record page — contact, company, deal and lead — is headed the same
way.

Under the fixed properties the card lists every [custom field](./custom-fields.md)
defined on the **Companies** tab of the Fields section, and **Edit** carries a control
for each, so a company's own properties are saved in the same form as its name and
domain.

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
A company made this way is a new record like one made from the list: it counts
against the records band, and on a plan whose band is a hard limit it is refused at
the band with the same message. Clearing the field unlinks the person. A contact
whose record carries a company **name** but no link — from an import, or from
before the picker
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

## Import

**Import**, in the card's header, takes a file of companies — a Salesforce
accounts export, a HubSpot or Apollo list, a spreadsheet — through the
[import wizard](./import.md). A company already in your list is **updated**
rather than added twice: a row is matched by its **Aglyn ID**, then its
**domain**, then its **name**, among the companies this site sees. Every
field is offered, your company [custom fields](./custom-fields.md) included;
a **parent company** is found by domain or name, and one the CRM lacks can be
created; a list value your organization lacks is yours to map, add or leave
blank. See [what each company field reads](./import.md#what-each-company-field-reads).

A new company counts against your plan's [records band](../../workspace-and-billing/billing-and-plans/overview.md#crm-records).
An import can be undone for seven days.

## Export

**Export…**, in the card's header, and the [bulk bar's](./bulk-actions.md#companies)
**Export…** open the [export dialog](./export.md): choose the fields — every
standard and custom field, the parent company and the owner by name, the
contacts count — and the records: the selection, the list's current filter,
or every company. The default, **Re-importable**, is a file that imports back
into the companies it came from.

## Deleting a company

Deleting a company unlinks it from every contact first, so no contact is left
pointing at a record that no longer exists. Up to 500 contacts are unlinked in
one pass; a company with more than that reports how many remain, and deleting
again continues from where it stopped. The contacts themselves are untouched.
The companies under it lose their **parent company** in the same pass, and
keep everything else.
The list's [bulk bar](./bulk-actions.md#companies) deletes a selection the same
way, one company after another.

## Who can see a company

A company follows the same per-site visibility as your contacts. It is
created in the scope a contact captured on the same site would land in — the
whole workspace when the workspace shares its data, and otherwise the sites
that present as one sender — so a section of the CRM can never show a company
to a reader who could not open the contacts at it.

## Files

The **Files** card attaches assets from the [media library](../media/overview.md)
to this record: contracts, quotes, a signed proposal, a photo of the site.

- **Attach…** opens the media browser. At a site you can pick from the site's
  own library and the workspace's shared one; at the
  [organization hub](./overview.md#at-the-organization-level) only the shared
  library is offered, because a record there belongs to the workspace rather
  than to one site.
- A record holds up to **20 files**.
- The **✕** beside a file removes the attachment. The file itself is untouched
  and stays in the library.

Files are stored **by id**, not by address. A file moved between folders keeps
its attachment, and a private file is still served through the signed link that
checks who is asking rather than through a public URL. A file deleted from the
library is still listed, marked as no longer there, so an attachment never
disappears without saying so.

Attachments are readable and writable through the
[REST API](/api/resources/companies) as `mediaIds`.

## Related

- [CRM overview](./overview.md)
- [The contact record](./contact-record.md) — the people a company is made of
- [CRM settings](./settings.md) — whether a capture creates the company it could not find
- [Deals pipeline](./deals.md) — every deal names the company it is with
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md) — audiences built from a rule can target a contact's company
- [REST API — companies](/api/resources/companies)
