---
sidebar_position: 5
title: Activities & the timeline
description: Log calls, emails, meetings and notes against a contact, a company or a deal, and read them in one timeline beside everything the platform captured and every campaign it sent.
---

# Activities & the timeline

An **activity** is something a person on your team did about a record — a call
made, an email sent, a meeting held, a note worth keeping. It is logged by hand,
from the record it is about, and it sits in one timeline beside everything the
platform captured about that person on its own and every campaign email it sent
them.

## Three kinds of history

A contact's timeline is one newest-first stream drawn from three sources, and
every entry says which it is:

| Entry | Where it comes from | Who can change it |
| --- | --- | --- |
| **Captured** | The platform recorded it — a form submission, an order, a booking, a member sign-up, a newsletter opt-in, an API or import create, or a contact added by hand. Each carries the door it came through and, for a form, the page the person was on. | Nobody. It is a record of what happened. |
| **Logged** | A member of your team logged it — a call, an email, a meeting, a note, or something else. | Its author, or an org-wide member. |
| **Sent** | A campaign email the platform delivered to the person — which email, when it went out, and what became of it. See [Campaign email on the timeline](#campaign-email). | Nobody. It is the delivery record. |

Captured history lives on the contact and is kept to the most recent fifty
entries. Logged activity is a collection of its own and is never capped; the
timeline reads it a hundred entries at a time and offers **Show more activity**
while older entries remain. Campaign email is read from the delivery log the
moment the page opens, over the newest fifty messages sent to the address.

A logged **Email** activity and a **Sent** campaign entry are different things
and are drawn differently: the first is a message somebody on your team wrote or
recorded, the second is a mailing the platform sent to an audience the person
was in.

## Campaign email on the timeline {#campaign-email}

Every campaign email sent to the person from this site — or from a site
declared to be one sender with it — appears at the moment it was sent, in one
line:

> **Spring sale** · sent · delivered · opened ×2 · clicked

The name is the email as your team named it on **Emails › Messages**, or its
subject when it has no name, and it links to that email's own report. The
words after it are the states the email reached, in order: **delivered**,
**opened** (with a count past one), **clicked** (likewise), **bounced**, or
**marked as spam**. The subject line rides under the entry when it differs from
the name.

What appears, and what does not:

- **Campaigns only.** A receipt, a booking confirmation, a password reset or an
  invite is not on a CRM timeline — those are account mail, sent to the person
  rather than to an audience.
- **Your sites' campaigns only.** A contact record is shared by every site in
  your workspace, and other businesses in the same workspace that mail the
  same person never see each other's campaigns here. A campaign sent by a
  sibling site in your own consent group is listed, without a link — that
  site's Emails console is its own.
- **The newest fifty messages** to the address are read. Somebody mailed
  heavily by several sites can have older campaign entries fall past the
  window.
- **Opens and clicks need the delivery webhook.** An email sent before it was
  connected shows as *sent* and nothing more, the same gap the campaign report
  itself reports.
- **An email your team has deleted** keeps its entry, named by the subject the
  person received, with no report to link to.

The timeline says so when the delivery log could not be read, rather than
showing an empty history — the two lead to opposite conclusions about the
relationship.

The most recent open or click across all of these is the record's
[**Last engaged**](./contact-record.md#last-engaged) stamp, which a
re-engagement audience can be
[built from](../../marketing-and-automation/email-campaigns/overview.md#lists-built-from-a-rule).

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
