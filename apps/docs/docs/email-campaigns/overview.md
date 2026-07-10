---
sidebar_position: 1
title: Email Campaigns
description: Send email to audiences built from your contacts, with tiered send caps and unsubscribe handling.
---

# Email Campaigns

**Email campaigns** let you reach the people in your [contacts CRM](../contacts/overview.md).
Build an audience, compose a send, and Aglyn handles delivery, caps, and unsubscribes.

```mermaid
flowchart LR
  Contacts[(Contacts)] --> Aud["Audience / segment"]
  Aud --> Camp[Compose campaign]
  Camp --> Cap{Within send cap?}
  Cap -->|yes| Send[Deliver]
  Send --> Unsub["Unsubscribe link<br/>(honored automatically)"]
```

:::info Plan availability
**Paid**, with **tiered send caps** — how many emails you can send per period depends on
your plan.
:::

## Send a campaign

1. Build an **audience** — leads, site members, [segments](../contacts/overview.md#segments),
   or an **email list**.
2. Compose the campaign from the **Marketing** page.
3. Send — subject to your plan's **send cap**.

## Email lists

**Lists** are static audiences shared across your organization's sites. Create them on
the Marketing page, then grow them with the **"Enroll in a list"** automation step (e.g.
on form completion) or popup email capture. Target any list from the campaign composer.

## Experiments

Business plans can A/B test screens, sections, and emails from the **Experiments** card
on the Marketing page: weighted variants, deterministic visitor assignment, a conversion
goal, and per-variant exposure/conversion rates with a pick-the-winner flow.

## Compliance

- Every send includes an **unsubscribe** link.
- Unsubscribes are honored automatically so you stay compliant.

## Related

- [Contacts CRM](../contacts/overview.md)
- [Forms & lead capture](../forms/overview.md)
- [Marketing overlays](../marketing-overlays/overview.md) (email capture popups)
