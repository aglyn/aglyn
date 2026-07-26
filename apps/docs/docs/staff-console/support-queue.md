---
sidebar_position: 4
title: Support queue (internal)
description: Triage customer support tickets from the staff console — filter, reply as Aglyn, and close or reopen.
---

# Support queue (internal)

:::warning Aglyn staff only
Requires a staff claim. `/admin/*` returns a **404** for everyone else.
:::

**Admin → Support** is the triage queue for every organization's
[support tickets](../workspace-and-billing/support-and-community.md). It's the staff
counterpart to the customer's Support page — the same threads, seen across all
organizations at once.

## Triage

The list is filtered to **open** by default, with **closed** and **all** chips beside
it and a count of what's still open. Each row shows the organization it came from and
the subject.

Open a ticket to read the full thread. Every message shows its author's email, so you
can see at a glance whether the last word was the customer's or ours.

- **Reply as Aglyn staff** — posts into the thread. The customer sees it attributed to
  Aglyn, not to you personally.
- **Close ticket** / **Reopen** — toggles the status. Closing is not final: a customer
  reply reopens the ticket automatically, so a closed ticket that comes back will
  reappear in the open filter rather than going unnoticed.

## Notifications

Staff are notified in-app when a ticket is **opened** and when a customer **replies** —
there's no separate support inbox to watch. The notification deep-links to the exact
ticket (`?ticketId=`), so the bell is a working queue.

A staff reply raises no notification, so answering a ticket doesn't ping the rest of
the team.

## Related

- [Support & community](../workspace-and-billing/support-and-community.md) — what the
  customer sees
- [Staff console overview](overview.md)
