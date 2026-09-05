---
sidebar_position: 2
title: The contact record
description: Add a contact by hand, keep a profile on them — phone, company, title, address, owner and lifecycle stage — and open their own page in the CRM.
---

# The contact record

Every person in your CRM has a **record**: the email that identifies them, the
profile your team keeps on them, where they came from, what they are filed
under, and what the site recorded about them. You can add a person by hand,
and edit every part of that profile from their own page.

## Adding a contact by hand

Open **CRM → Contacts** and choose **New contact**. A drawer opens over the
list — the list itself stays exactly where it was.

| Field | Notes |
| --- | --- |
| **Email** | Required. It is the one thing every site shares about a person and what makes two captures one record. |
| **Name** | Optional. Your own name for the person; the record also keeps the name they gave on a form. |
| **Phone** | Entered with its country code, like `+1 512 555 0107`. Stored in E.164 so the same number typed two ways is one number. |
| **Job title**, **Company** | Free text. Company is the name as you know it; the record is linked to a [company](./companies.md) from the company's own page, by [converting a lead](./leads.md#converting-a-lead), or by a [CSV import](./import.md) that names the company. |
| **Lifecycle stage** | Where the person sits in your funnel; see [Lifecycle stages](#lifecycle-stages). |
| **Owner** | The team member responsible for the relationship, picked from your workspace roster. |
| **Tags** | Comma-separated. Tags are lower-cased and deduplicated, so `VIP` and `vip` are one tag. |
| **Address** | Street, city, state or region, postal code and a two-letter country code. |
| **Opted in to marketing email** | Tick it only if the person actually agreed. Adding a contact is never itself consent, and the checkbox says so. |

If the email already belongs to a contact, nothing is duplicated: what you
typed **merges** into the existing record and the page tells you so. On the
Free plan, a full audience band refuses the new record with the same wording
the list shows; upgrade in Billing to keep adding.

## The record page

Clicking a row in the list opens the person's own page at
`…/crm/contacts/{id}` — an address you can paste and that every other CRM
record links to. The page opens with the person's name, their lifecycle stage,
their owner and — for a buyer — how many orders they have placed and what they
have spent. Under it, one card per aspect of the record:

- **Properties** — the editable profile: name, phone, job title, company,
  lifecycle stage, owner, tags, address and an **About** box for your
  team's notes. One **Save** writes everything at once. The email is shown
  but cannot be edited here, because it is the shared identity.
- **Relationship** — the **sources** that created the record (a form, a
  checkout, a booking, an import, or by hand), the **campaign attribution**
  recorded from the link the person followed, the **marketing email** basis
  this site holds (opted in, opted out, or no record — the last is not a
  refusal), and the campaigns your team has **filed** the person under.
  Filing is your own bookkeeping; it never adds anyone to a send.
- **Custom fields** — one control per field your organization has defined;
  see [Custom fields](./custom-fields.md).
- **Timeline** — what the site recorded about the person and what your team
  has logged, newest first: the forms they submitted, the orders they placed,
  the bookings they made, and the calls, emails, meetings and notes filed
  against them, with **Log activity** to add one — see
  [Activities & the timeline](./activities.md).
- **Deals** — the deals the person is named on, with a **New deal** shortcut
  that starts one already linked to them — see [Deals pipeline](./deals.md).
- **Tasks** — the open tasks about this person, each with a checkbox to
  complete it, and a **New task** shortcut — see
  [Tasks & follow-ups](./tasks.md).

The overflow menu on the page carries **Delete contact**. Deleting removes
the person from *this site's* CRM — its notes, tags and timeline. Other sites
in your workspace that captured the same person keep their own records, and
the person's form submissions, orders, bookings and membership records are
separate and are deleted from their own pages.

## What each site keeps to itself

A contact document is shared by every site in your workspace — one human who
touched two of your sites is one row. Almost nothing *on* it is shared: the
notes, tags, timeline, phone, title, company, address, owner and stage are one
site's knowledge of the person and are never shown to another site's console.
The email and the name the person gave are the only shared identity.

## Owner

The **Owner** is the team member responsible for the relationship. The
contacts list has an **Owner** column and an **Assigned to me** toggle that
narrows the list to the people assigned to you; the record page shows the
owner beside the heading and lets you reassign.

## Lifecycle stages

The **Stage** says where a person is in your funnel. The list has a Stage
column and a Stage filter; the record page lets you set it.

| Stage | Meaning |
| --- | --- |
| **Subscriber** | Signed up to hear from you and nothing more yet. |
| **Lead** | Showed interest — filled in a form, asked a question. |
| **Marketing qualified** | Engaged enough for marketing to hand over. |
| **Sales qualified** | A real prospect somebody is working. |
| **Opportunity** | There is a deal on the table. |
| **Customer** | Has bought. A purchase on your site sets this automatically for anyone at an earlier stage, and never moves anyone back. |
| **Evangelist** | A customer who sends others your way. |
| **Other** | A step of your own that none of the names fit. A sale never overwrites it. |

## Finding a contact

The list's search and column filters reach every contact in the workspace by
name and email. The console's **search** (the magnifying glass in the top bar)
finds contacts too — by name, email, phone number or company name — and opens
the person's page. Contacts appear in that search only for members who can
manage data on the site, and only while the CRM is available to them.

The phone number and company name are kept on the record itself for that
lookup, as this site last saved them; the values you see on a person's page
are always your own site's.

## Related

- [CRM overview](./overview.md)
- [Import contacts from CSV](./import.md) and [Bulk actions](./bulk-actions.md) — many records at once
- [Companies](./companies.md) — the account a person works for
- [Activities & the timeline](./activities.md) — the history on the record page
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [REST API — contacts](/api/resources/contacts) — the same record, with its per-site profile, over the API
