---
sidebar_position: 5
title: Activities & the timeline
description: Log calls, emails, meetings and notes against a contact, a company or a deal, and read them in one timeline beside everything the platform captured.
---

# Activities & the timeline

An **activity** is something a person on your team did about a record — a call
made, an email sent, a meeting held, a note worth keeping. It is logged by hand,
from the record it is about, and it sits in one timeline beside everything the
platform captured about that person on its own.

## Two kinds of history

A contact's timeline is one newest-first stream drawn from two sources, and every
entry says which it is:

| Entry | Where it comes from | Who can change it |
| --- | --- | --- |
| **Captured** | The platform recorded it — a form submission, an order, a booking, a member sign-up, a newsletter opt-in, an API or import create, or a contact added by hand. Each carries the door it came through and, for a form, the page the person was on. | Nobody. It is a record of what happened. |
| **Logged** | A member of your team logged it — a call, an email, a meeting, a note, or something else. | Its author, or an org-wide member. |

A captured entry from *this* site carries a link to its record: **Open
submission** lands on the Inbox with the reader open on that submission, **Open
order** on the orders list with the order's dialog open, and a booking or a
sign-up on the Bookings or Users page. An entry from another site in your
workspace — read on that site's console — or one written before the site was
stamped on it is shown without a link.

Captured history lives on the contact and is kept to the most recent fifty
entries. Logged activity is a collection of its own and is never capped; the
timeline reads it a hundred entries at a time and offers **Show more activity**
while older entries remain.

## Logging an activity

Open the record — a contact's page under **CRM › Contacts**, a company's under
**Companies**, or a deal's under **Deals** — and choose **Log activity**. The
activity is filed against that record; there is no picker, because what you are
looking at is what the activity is about.

| Field | What it is |
| --- | --- |
| **Kind** | Call, Email, Meeting, Note or Other. |
| **When** | When it happened, which is not always when you are logging it. Defaults to now. |
| **What happened** | The body of the entry. |
| **Outcome** | For a call or a meeting: how it ended — "left a voicemail", "agreed to a trial". |
| **Minutes** | For a call or a meeting: how long it took. |

Each entry shows who logged it and how long ago. The author can edit or delete
their own entries; an org-wide member can edit or delete anyone's. A colleague
with access to only some of your sites can read an entry they did not write, and
cannot change it.

## Where an activity is visible

An activity is visible exactly where a contact captured on the same site would
be: to that site alone, or to every site declared to be one sender with it, or
to the whole organization when the organization has chosen an org-wide default.
Logging an activity never widens what a scoped member can see, and a section
of the CRM can never show an activity to somebody who could not open the
record it belongs to.

## The recent activity feed

The **Contacts** section shows the newest activity logged across the CRM under
the list — the last few calls, emails, meetings and notes anyone on the team
filed against any record — each linking to the record it is about. It is a
glance at what the team has been doing; the record's own page is where the
whole log lives.

## Related

- [CRM overview](./overview.md)
- [The contact record](./contact-record.md) — the page a contact's timeline lives on
- [Tasks & follow-ups](./tasks.md) — what is owed, as opposed to what happened
- [Automations for the CRM](./automations.md) — the **Log a CRM activity** step
- [REST API — activities](/api/resources/activities)
