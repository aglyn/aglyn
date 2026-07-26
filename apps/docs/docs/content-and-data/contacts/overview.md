---
sidebar_position: 1
title: Contacts CRM
description: A unified contacts list ingested from forms, members, orders, and bookings — with tags, notes, and segments.
---

# Contacts CRM

The **Contacts CRM** is a single list of the people who interact with your site. Aglyn
builds it automatically from everything they do, so you always have an up-to-date view of
your audience.

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

:::info Plan availability
**Paid**. Contacts power [email campaigns](../../marketing-and-automation/email-campaigns/overview.md) and segments.
:::

## Unified ingestion

Contacts are ingested from across your site:

- [Form](../forms/overview.md) submissions
- Site **members** (sign-ups)
- **Orders** from [commerce](../../commerce-and-bookings/commerce/overview.md)
- **Bookings** from [scheduling](../../commerce-and-bookings/bookings/overview.md)

Duplicate signals from the same person are unified into one contact.

Contacts are priced as an **audience band**: every tier includes a number of contacts,
and paid tiers meter growth past the band onto your monthly invoice instead of ever
dropping a record. Only the Free tier's band is a hard limit. See
[Billing & plans](../../workspace-and-billing/billing-and-plans/overview.md).

## The contacts page

- Browse the **list** of contacts.
- Open a **profile drawer** to see a contact's details and history.
- Add **tags** and **notes**.
- **Export to CSV**.

## Segments

Group contacts into **segments** — reusable audiences you can target directly in
[email campaigns](../../marketing-and-automation/email-campaigns/overview.md).

## Related

- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [Forms & lead capture](../forms/overview.md)
