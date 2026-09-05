---
sidebar_position: 1
title: Contacts CRM
description: A unified contacts list ingested from forms, members, orders, and bookings — with tags, notes, and segments.
---

# Contacts CRM

The **Contacts CRM** is a single list of the people who interact with your site. Aglyn
builds it automatically from everything they do, so you always have an up-to-date view of
your audience.

:::caution Rolling out
The **Contacts page** in the console isn't available yet — it's a release-flagged
feature being finished for Contacts CRM v1, so there's no Contacts tab in your
workspace and nothing to switch on.

Capture is already running, though. Contacts are ingested from forms, member
sign-ups, orders and bookings **today**, and you can read them over the
[REST API](/api/resources/contacts) in the meantime — nothing is lost while you
wait. Audience-band overage is **not billed** while the page is unavailable.
:::

![The Contacts page in the Aglyn console, with search, Source and Tags filters, and an Export CSV action](/img/contacts/contacts-page.png)

```mermaid
flowchart LR
  F[Form submissions] --> C[(Unified contact)]
  M[Site members] --> C
  O[Orders] --> C
  B[Bookings] --> C
  C --> S[Segments]
  C --> E[Email campaigns]
```

## Unified ingestion

Contacts are ingested from across your site:

- [Form](../forms/overview.md) submissions
- Site **members** (sign-ups)
- **Orders** from [commerce](../../commerce-and-bookings/commerce/overview.md)
- **Bookings** from [scheduling](../../commerce-and-bookings/bookings/overview.md)

Duplicate signals from the same person are unified into one contact.

Every tier includes an **audience band** — a number of contacts. Only the Free tier's
band is a hard limit; paid tiers never drop a record, and growth past the band meters
as overage. That overage is **not billed while the Contacts page is unavailable**. See
[Billing & plans](../../workspace-and-billing/billing-and-plans/overview.md).

## The contacts page

Once the page is switched on, it will let you:

- Browse the **list** of contacts.
- Open a **profile drawer** to see a contact's details and history.
- Add **tags** and **notes**.
- **Export to CSV**.

## What's in the CRM area

In the console the surface is called **CRM**, and it is a hub of seven sections,
each with its own address under your site (`…/hosts/{site}/crm/…`). Links to the
older `…/contacts` address still open the hub.

| Section | Address | What lives there |
| --- | --- | --- |
| **Contacts** | `/crm/contacts` | The people list above; a person's own page is `/crm/contacts/{id}`. |
| **Leads** | `/crm/leads` | People a site has captured but not yet qualified — a status, an owner, and a conversion into a contact, a company and a deal. |
| **Companies** | `/crm/companies` | The organizations your contacts belong to; a company's page is `/crm/companies/{id}`. |
| **Deals** | `/crm/deals` | Your pipeline — open deals by stage, with amount, owner and expected close; a deal's page is `/crm/deals/{id}`. |
| **Tasks** | `/crm/tasks` | Calls, emails, meetings and to-dos by due date, linked to the contact, company or deal they are for. |
| **Reports** | `/crm/reports` | Contacts by stage and source, the pipeline by stage, won and lost over time. |
| **Fields** | `/crm/fields` | The custom fields on a contact — text, number, date, choice, checkbox or link. |

Opening `/contacts` lands on the first section. Every section follows the same
per-site visibility as the contacts themselves, so a section can never show a
record the reader could not open as a contact.

## Import from CSV

**Import CSV** on the Contacts section brings a spreadsheet of people in — map its
columns to contact fields, preview the first rows, and import in batches with a report
of what was added, updated and skipped. See [Import contacts from CSV](./import.md).

## Segments

Group contacts into **segments** — reusable audiences you can target directly in
[email campaigns](../../marketing-and-automation/email-campaigns/overview.md).

## Related

- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [Forms & lead capture](../forms/overview.md)
