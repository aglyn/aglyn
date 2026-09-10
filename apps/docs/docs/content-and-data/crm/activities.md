---
sidebar_position: 6
title: Activities & the timeline
description: Log calls, emails, meetings and notes against a contact, a company, a deal or a lead, email one person from their record, and read it all in one timeline beside everything captured and every campaign sent.
---

# Activities & the timeline

An **activity** is something a person on your team did about a record — a call
made, an email sent, a meeting held, a note worth keeping. It is logged by hand,
from the record it is about — or, for an email, written and sent from there — and
it sits in one timeline beside everything the platform captured about that
person on its own and every campaign email it sent them.

## Four kinds of history

A contact's timeline is one newest-first stream drawn from four sources, and
every entry says which it is:

| Entry | Where it comes from | Who can change it |
| --- | --- | --- |
| **Captured** | The platform recorded it — a form submission, an order, a booking, a member sign-up, a newsletter opt-in, an API or import create, or a contact added by hand. Each carries the door it came through and, for a form, the page the person was on. | Nobody. It is a record of what happened. |
| **Logged** | A member of your team logged it — a call, an email, a meeting, a note, or something else. | Its author, or an org-wide member. |
| **Sent** | An email the platform sent to this person from their record — by a teammate with **Send email**, or by an automation's **Send an email** step. It carries its subject, the address it went to, and where delivery got to. See [Sending an email](#sending-an-email). | Nobody edits what was sent; its author or an org-wide member may delete it. |
| **Campaign** | A campaign email the platform delivered to the person — which email, when it went out, and what became of it. See [Campaign email on the timeline](#campaign-email). | Nobody. It is the delivery record. |

A captured entry from *this* site carries a link to its record: **Open
submission** lands on the Inbox with the reader open on that submission, **Open
order** on the orders list with the order's dialog open, and a booking or a
sign-up on the Bookings or Users page. An entry from another site in your
workspace — read on that site's console — or one written before the site was
stamped on it is shown without a link.

Captured history lives on the contact and is kept to the most recent fifty
entries. Logged activity is a collection of its own, bounded at **5,000 entries
per record** — a call a day for fourteen years, so nobody working a real
relationship reaches it, and an automation logging on every event cannot fill
one person's log without limit. At the ceiling, **Log activity**, the
**Log a CRM activity** step and `POST /v1/activities` refuse another entry on
that record and say so; the timeline reads it a hundred entries at a time and
offers **Show more activity** while older entries remain. Campaign email is
read from the delivery log the moment the page opens, over the newest fifty
messages sent to the address.

A logged or sent **Email** activity and a **Campaign** entry are different
things and are drawn differently: the first is a message somebody on your team
wrote, sent or recorded, the second is a mailing the platform sent to an
audience the person was in.

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
**Companies**, a deal's under **Deals**, or a lead's under **Leads** — and choose
**Log activity**. The activity is filed against that record; there is no picker,
because what you are looking at is what the activity is about.

Logging an activity is part of the **CRM suite**, included from **Starter**. On Free a
contact's timeline still reads in full, and **Log activity** is shown locked.

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

### A meeting from a booking {#meeting-from-a-booking}

A confirmed [booking](../../commerce-and-bookings/bookings/overview.md#booking-from-the-crm)
files a **meeting** on its record's timeline without anyone logging it — titled
with the service and the slot, and linked to the booking. The record is the one
the booking link was dropped from (a contact's, a lead's or a deal's **Book a
meeting**, or **Insert booking link** in **Send email**), which wins even when the
person books with another address; a booking taken from the widget with no record
attached is matched to a contact by the booker's address. When the service asks
for it, a **Follow up after &lt;service&gt;** [task](tasks.md) is filed beside the
meeting, due one business day after the slot. Nothing is filed on a site where the
CRM is switched off, or for a workspace whose plan does not include the CRM suite.

## Click to call {#click-to-call}

A contact's, a lead's and a company's page carries **Call** beside **Send
email**: one tap dials the number the record holds, through whatever your
device uses for a phone. The number itself is a link everywhere it is
printed — on the record page and on the properties card — so it can be
dialed from where you are reading it rather than copied out.

Only a number a dialer can take is a link. Write phone numbers with the
country code, like `+1 512 555 0107`; spaces, dots, dashes and parentheses
are fine and are ignored. A value that is not a number — "ask reception",
an extension typed as `x44` — is shown as plain text and **Call** says why
it is unavailable, rather than offering a link that would ring nothing.

**Log a call** sits beside it and opens the dialog above with the kind
already set to **Call** and the record already bound, so logging what was
said is one button and one sentence. It is there whether or not the record
has a number: a call placed from your own mobile is still a call to log.
The kind is a starting point, not a lock — change it in the dialog if the
conversation turned out to be something else. On Free, **Call** dials as on every
plan and **Log a call** is shown locked.

## Sending an email

A contact's, a lead's and a deal's page each carry **Send email**: one message,
from you, to the person the record is about. It is a letter, not a campaign —
there is no audience, no designed layout and no unsubscribe footer — and it is
logged on the timeline the moment it leaves, with its delivery state following.
One-to-one email is part of the **CRM suite**, included from **Starter**; on Free
**Send email** is shown locked.

| Field | What it is |
| --- | --- |
| **To** | The record's own address. It cannot be changed here: a deal writes to its contact, a lead to the address it was captured with. |
| **From** | The site's sending address — the same identity campaigns and transactional mail leave on — with your name in front of it. |
| **Reply-to** | Your own address, so a reply lands in your inbox rather than the site's mailbox. |
| **Template** | A saved letter to start from — fills in the subject and the message. Shown once the workspace has one; see [Email templates & snippets](./email-templates.md). |
| **Subject** and **Message** | What you write. The message is plain text; a blank line starts a new paragraph. **Insert** drops a snippet or a merge field — `{{contact.firstName}}`, `{{deal.amount}}` — at the cursor, filled in from the record when the email is sent, and **Save as template…** keeps the draft for next time. |

The send is refused, and the dialog says why, when:

- the site has no sending identity in effect — an admin sets one up under
  **Emails › Sending**, and the dialog links there;
- the address is on a suppression list because it bounced or reported a message
  as spam, or the person has asked this site not to email them;
- the organization has reached its **one-to-one email** allowance for the day —
  see [the cap](../../workspace-and-billing/billing-and-plans/overview.md#one-to-one-email),
  which resets at midnight UTC;
- you have sent more than twenty emails in the last minute.

Every sent email counts toward the organization's email usage like any other
message.

At the [organization level](./overview.md#at-the-organization-level) the
message still leaves from one site: the site that captured the person, or —
for a record no site captured — the one you pick under **Send from**. The
dialog links that site's **Emails › Sending** page when it cannot send.

### Delivery states {#delivery-states}

A sent email's entry shows a chip beside **Email** that follows the message:

| Chip | Meaning |
| --- | --- |
| **Sent** | The mail provider accepted it. |
| **Delivered** | The recipient's mail server accepted it. |
| **Opened** | The recipient opened it, as far as an open can be known. |
| **Clicked** | The recipient followed a link in it. |
| **Bounced** | The mailbox refused it. The address is suppressed and cannot be emailed again from this site. |
| **Marked as spam** | The recipient reported it. The address is suppressed. |

The chip only ever moves forward — a late "delivered" never replaces an "opened" —
and a bounce or a complaint stands over anything that came before it. Hover the
chip for when the state was reached.

## Captured email {#captured-email}

A reply to a sent email reaches *your* mailbox, because that is where
**Reply-to** points — and the console cannot see your mailbox. To put the reply
on the record, hand it the message: **forward** it to the workspace's capture
address, or put that address in **BCC** when you write to a contact from your
own mail client. The address is printed under **Reply-to** in the **Send
email** dialog and on the [Email capture](./settings.md#email-capture) card
under **CRM → Settings**, each with a copy button.

A message that arrives is filed as **one** email entry on the timeline:

- **Whose record.** The first address among **From**, **To** and **Cc** that
  is not a workspace member's and belongs to a contact or a lead in the CRM.
  A lead's message files on the lead. The record's own site is the site the
  entry lands under, so at the organization level a capture works for every
  site at once.
- **Which way.** A message a correspondent wrote reads **Received**, with
  the sender beside the time; a message a member wrote and copied in reads
  **Sent**, without a delivery chip, because the platform did not carry it.
  Neither carries the **Logged** chip — nobody logged them — and neither can
  be edited, though whoever may delete an entry may delete these.
- **What is kept.** The subject and a bounded plain-text excerpt of the
  message, cut above the quoted history (`On … wrote:`), plus the message's
  own identifier so a second delivery of the same message is filed once.
  Attachments are not kept.
- **What is dropped.** A message matching nobody in the CRM is not filed; the
  organization's **Setup → Activity** feed notes *Inbound email matched no
  record* with the sender's domain, never the message. A message to a
  [rotated](./settings.md#email-capture) address is dropped silently.

The console's own **Send email** already logs what it sends; there is no
need to BCC the capture address from the dialog, and it does not.

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
- [Email templates & snippets](./email-templates.md) — the letters **Send email** starts from, and the merge fields it fills in
- [Automations for the CRM](./automations.md) — the **Log a CRM activity** step, and how a **Send an email** step lands on the timeline
- [Sending domains](../../marketing-and-automation/email-campaigns/overview.md#sending-domains) — the identity a one-to-one email leaves on
- [REST API — activities](/api/resources/activities)
