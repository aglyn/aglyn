---
sidebar_position: 3
title: Import contacts and companies
description: Bring people or companies into the CRM from a file — other CRMs' and online stores' exports map themselves — see every match and conflict in a dry run, choose how each is handled, and undo for seven days.
---

# Import contacts and companies

**Import**, in the header of the Contacts and Companies sections, takes a file
of people or companies — an export from another CRM, a sign-up sheet, a
customer list — and brings it in through the import wizard. Nothing is written
until a dry run has shown you exactly what will happen to every row, and you
have said how each conflict, guess and warning is handled.

Importing needs the same **Manage data** permission as editing a contact.

:::info Plan availability
Importing is part of the **CRM**, included from **Starter**. On Free the CRM's
sections are shown locked, and there is no **Import**. Exporting the people a
workspace holds stays open on every plan — see [Export](./export.md).
:::

## The site an import files under

Every CRM record names the site that met it: who may see it, and — for a
person — which site's profile of them the file fills in. Under a site, that is
the site. At the organization level, **Import** asks which site first (an
organization with one site is never asked), and remembers your pick for the
session like every other create.

## The steps

1. **Upload.** A CSV (comma, semicolon, tab or pipe separated), a JSON array or
   NDJSON file, with a header row — or paste the rows. Up to **50,000 rows**
   per file. The wizard guesses the separator, the encoding and whether the
   first line is a header, and you can change each.
2. **Columns.** Each column is matched to a field, with how sure the match is
   and why: the field's own name, a spelling Salesforce, HubSpot, Apollo,
   Pipedrive, Shopify, Wix or Squarespace writes (the badge says which), a close spelling, or what the
   values look like. Remap any column or leave it out. **Match columns with
   AI** proposes a mapping from the headers and the kind of values in each
   column — never a cell of the file.
3. **Values.** What reading the file did, field by field: dates read
   day-first or month-first (you choose when a date reads either way), phone
   numbers put in international format, a blank country code. A value your
   organization's lists do not hold — a salutation, a lead source, an industry —
   is listed with a choice: use one of your values, **add** it to the list,
   leave the field blank, or refuse those rows. A company, manager or owner
   the file names that the CRM does not hold is listed the same way, with the
   records it may mean: create it (companies only), use one of the suggestions,
   leave it blank, or refuse those rows.
4. **Matching.** Which existing record each row is about — by **Aglyn ID**
   first, then by **email** for a contact, by **domain** then **name** for a
   company — and which rows are new, matched, ambiguous or repeated in the
   file.
5. **Conflicts.** For each field: **overwrite** what the record holds, **fill
   blanks** only (the default), or **keep existing**; tags are added to; and
   whether a blank cell clears the field. Every row where the file and the
   record disagree is listed, with a per-row override. A field the CRM never
   lets a file change is shown locked, with why.
6. **Permission** (contacts). Whether the marketing opt-ins a store's
   customer file records come in. The answer starts as no; see
   [Switching from an online store](#switching-from-an-online-store). A file
   without a marketing column is not affected.
7. **Review.** The dry run: how many rows will create, update, change
   nothing, skip or fail, a before → after table, and every kind of warning,
   each with its own **I understand** before **Import** is enabled.
8. **Import.** Rows are written in chunks with a progress bar. Pause and
   resume at any time; close the tab and the import carries on.
9. **Results.** What happened to every row, a result file (your columns plus
   the outcome, the reason and the record), and **Undo**.

## What a file may not do

Some rules hold whatever a file says. They are shown locked on the
**Conflicts** step and counted on **Review**:

| Field | The rule |
| --- | --- |
| **Email** (contacts) | An existing contact's email is who they are. A matched row never changes it; change it on the contact's page. |
| **Marketing consent** (contacts) | This column is never read as consent. A person gives consent on a form, or a team member records how it was given on the contact's page. The column is exported as it stands. A store's customer file carries its marketing choices through **Email marketing choice** instead, under the rules in [Switching from an online store](#switching-from-an-online-store). |
| **Lifecycle stage** (contacts) | Moves forward only. A later stage in the file advances the contact and tells automations, as moving it by hand does; an earlier one is held back. |
| **Do not call** (contacts) | A file can turn it on, never off. |
| **Full name** (contacts) | Built from the first and last names once either is set. |
| **Parent company** (companies) | Never the company itself or one beneath it. Such a row fails, named in the results. |

## What each contact field reads

| Field | What is read |
| --- | --- |
| **Email** | Required for a new person. Lowercased; a name around it (`Ana <ana@acme.com>`) and `mailto:` are removed. |
| **Salutation**, **Lead source** | One of your organization's [values](./custom-fields.md#picklist-values), by label; one it lacks is yours to map, add or leave blank. |
| **First name**, **Last name**, **Full name** | When either name part is set, the full name is made of them. |
| **Phone**, **Mobile phone**, **Home phone**, **Other phone**, **Fax**, **Assistant phone** | Stored in international format (`+15125550123`). A number that cannot be read is listed on the Values step and left out of the row. |
| **Do not call** | `yes`, `true`, `1`, `x` and their opposites. |
| **Job title**, **Department**, **Assistant** | Text. |
| **Birthdate** | A past date, in any common format. |
| **Company** | A company by its **domain** or **name**. One the CRM lacks can be created by the import. |
| **Reports to** | Another contact, by email. |
| **Owner** | A member of your workspace, by email or by name — a Salesforce report's *Contact Owner* full name resolves. |
| **Mailing** and **Other** street, street line 2, city, state or region, postal code, country | The two addresses. Country is a two-letter code (`US`, `GB`). |
| **Lifecycle stage** | One of Subscriber, Lead, Marketing qualified, Sales qualified, Opportunity, Customer, Evangelist, Other — by label or id. |
| **Tags** | Split on `,` `;` `|` and line breaks, lowercased, added to the contact's own. |
| **Notes** | Text. |
| **Custom fields** | Every contact field you defined under [Fields](./custom-fields.md); a dropdown's values are matched like a list. |

What only the platform records — where a person was captured, the last
interaction, the last engagement, when the record was made — is exported but
never imported.

## What each company field reads

| Field | What is read |
| --- | --- |
| **Company name** | Required for a new company. |
| **Domain**, **Website** | `acme.com`; a website without `https://` gains it. |
| **Phone**, **Fax** | International format. |
| **Parent company** | Another company by domain or name; one the CRM lacks can be created. |
| **Type**, **Industry**, **Rating**, **Ownership**, **Account source** | Your organization's values, by label. |
| **Account number**, **Account site**, **Ticker symbol**, **SIC code** | Text. |
| **Employees** | A whole number. |
| **Annual revenue** | An amount with its currency (`$1,250,000`, `1250000 EUR`); one with none is US dollars. |
| **Billing** and **Shipping** street … country | The two addresses. |
| **Owner** | A member of your workspace, by email or name. |
| **Tags**, **Notes**, **Custom fields** | As for contacts. |

## Where new records go

A new person is captured through the same door a form submission uses: they
appear with **Import** as a source and "Imported from a file" at the top of
their activity, they count toward your
[CRM records](../../workspace-and-billing/billing-and-plans/overview.md#crm-records),
a person your workspace erased at their request is refused, and automations
that start when a contact is created run. A contact with no company column is
linked to the company at their email's domain, and one with no owner is
assigned by your [assignment rules](./settings.md), exactly as a capture is.

A matched person is changed the way their page changes them, so a company
link moves the company's contact count and the list's filters follow.

## Undo

For **seven days** after an import, **Undo** on its results puts back every
value it changed and removes what it created: a person only the importing
site held is deleted (keeping any refusal they made); one another site holds
too stays theirs. A record edited since the import is listed with what it
holds now and what undo would restore, and you choose for each.

Undo takes back a marketing email opt-in a store's file brought in. It never
takes back an unsubscribe: that is the person's own choice, made at your old
store. The contact stays unsubscribed, the entry on your site's unsubscribe
list stays, and a person the undo removes has their refusal kept, as any
removed contact does. Undo still puts back every other field it changed.

## Switching from an online store {#switching-from-an-online-store}

The [Switching to Aglyn](../../guides/switching-to-aglyn/before-you-switch.md) guides cover
the rest of the move, in order.

A store moving from **Shopify**, **Wix** or **Squarespace** brings its
customers in as contacts. Export the customers file from your old store and
import it here: the columns map themselves, with nothing to pick.

| Store | The file | What maps itself |
| --- | --- | --- |
| **Shopify** | The customers CSV export | *First Name*, *Last Name*, *Email*, *Phone*, *Default Address Company*, the *Default Address* street, city, province, country and zip (the mailing address), *Default Address Phone* (other phone), *Note*, *Tags*. An older file's *Company*, *Address1* … *Zip* map the same way. |
| **Wix** | The contacts CSV export | *First Name*, *Last Name*, *Email 1*, *Phone 1*, *Phone 2* (other phone), *Address 1* (mailing) and *Address 2* (other), *Company*, *Position*, *Labels* (as tags). |
| **Squarespace** | The customers CSV export | *Email*, *First Name*, *Last Name*, the *Shipping* address and phone (mailing), the *Billing* address and phone (other), *Tags*. |

A column the import does not know is left unmapped, and a missing column is
simply not filled. Columns are matched whatever their capital letters. Your
products come across separately, from the store's product file — see
[Moving from Shopify, Wix or Squarespace](../../commerce-and-bookings/commerce/store-import-and-export.md#moving-from-shopify-wix-or-squarespace).

### Marketing email choices

Each file says whether a customer agreed to marketing email: Shopify's
*Accepts Email Marketing* (*Accepts Marketing* in older files), Wix's *Email
subscriber status*, Squarespace's *Accepts Marketing*. They map to **Email
marketing choice**, and are carried like this:

| The file says | What the import does |
| --- | --- |
| **yes**, **true** or **Subscribed**, and you confirmed on **Permission** | The contact is opted in to marketing email from the site you import under. The record says it came from your store's file, on which date, in which import, and that you confirmed these people agreed to hear from you. |
| **yes**, **true** or **Subscribed**, and you did not confirm | Nobody is opted in. The dry run counts these people so you can decide. |
| **yes** for somebody who unsubscribed here | They stay unsubscribed. Nothing in a file opts anyone back in. |
| **no**, **false** or **Unsubscribed** | Always kept, whatever you chose on **Permission**: the contact is recorded as having said no. A contact who was subscribed here is unsubscribed, and added to the site's unsubscribe list. Undoing the import keeps it. |
| **Never subscribed**, **Pending**, blank, or a word the import does not know | Nothing changes. |

Opt-ins come in only under a site, since a person agrees to hear from a
business, not from a workspace. An import that names no site still keeps
every unsubscribe in the file, for every site.

Before you choose **Permission**, the dry run on **Review** says how many
people would be opted in, how many unsubscribes would be kept, and how many
have no choice recorded. Only confirm if these people really agreed to hear
from your business, for example by ticking a box at your old store's
checkout, and you can show how if asked.

### What does not move

- **Passwords.** No store's export includes them. A customer who had an
  account at your old store makes a new one on your site.
- **Text message marketing choices** (Shopify's *Accepts SMS Marketing*,
  Wix's *SMS subscriber status*). Marketing texts are not sent from here, so
  the column is read and not kept, and the dry run says so.
- **Total spent and order counts.** A contact's spend counts what they buy
  on your site, so these are read and not kept, and the dry run says so.
  Past orders stay with your old store: orders are
  [exported only](../../commerce-and-bookings/commerce/store-import-and-export.md#orders-are-exported-only).
- **The old store's customer ID.** People are matched by email.

## Files from other products

| Product | What maps itself |
| --- | --- |
| **Salesforce** | Contacts and accounts exports and reports: *First Name*, *Mailing Street* … *Mailing Country*, *Account Name*, *Contact Owner*, *Lead Source*, *Reports To*, *Billing Street*, *Parent Account*, *Annual Revenue* and the rest. |
| **HubSpot** | Contacts and companies exports: *Associated Company*, *Contact owner*, *Lifecycle Stage*, *Street Address*, *State/Region*, *Company Domain Name* … |
| **Apollo** | People and accounts exports: *Title*, *Company*, *Work Direct Phone*, *# Employees*, *Company City* … |
| **Pipedrive** | People and organizations exports: *Person - Email - Work*, *Person - Organization*, *Organization - Name* … |
| **Shopify**, **Wix**, **Squarespace** | Customer and contact exports — see [Switching from an online store](#switching-from-an-online-store). |
| **Aglyn** | A file the CRM exported, from the [export dialog](./export.md) or before it. |

Columns that mean the opposite of a field — Salesforce's *Email Opt Out*,
HubSpot's *Unsubscribed* — are left unmapped rather than read as consent.

## Related

- [Export](./export.md) — the file an import reads back
- [The contact record](./contact-record.md) — the fields an imported row lands in
- [Companies](./companies.md)
- [Bulk actions](./bulk-actions.md) — act on the people you just imported, all at once
- [Import deals from CSV](./deals.md#import-from-csv) and [import tasks from CSV](./tasks.md#import-from-csv)
- [Import a list into an email audience](../../marketing-and-automation/email-campaigns/overview.md#import-a-list) — for a mailing list rather than the CRM
