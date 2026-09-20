---
sidebar_position: 15
title: Outreach
description: One-to-one email sequences a rep sends to a person from their own connected mailbox, kept with the CRM. Rolling out.
---

# Outreach

:::caution Rolling out
Outreach is a **release-flagged feature, currently being rolled out** — it is
not available in your workspace yet. This page says what it is for, and grows
with the feature.
:::

## What it is for

Outreach is for one-to-one selling. A rep writes a short **sequence** — a
first email and the follow-ups after it, each a set number of days apart — and
enrolls people from the CRM in it. Every email goes to one person, as a message
from the rep rather than as a campaign.

It is not a way to send one message to an audience. That is what
[email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
are for, sent from your site's sending identity to a segment of your contacts.

## Sent from your own mailbox

Outreach sends from the **rep's own mailbox**, connected to the workspace
through the rep's Google account. The email leaves from that address, sits in
that rep's sent mail like any other, and a reply comes back to the same inbox
— which is what makes it a conversation between two people rather than a
broadcast.

## Where it lives

Outreach is a tab of its own at the **organization** level, beside the CRM, at
`…/{organization}/outreach`. It has three sections: **Sequences**,
**Mailboxes** and **Compliance**.

Opening it takes the **Use Outreach** permission, which owners and admins hold
by default. A [custom role](../../workspace-and-billing/teams-and-roles/custom-roles.md)
can grant it to other members of the organization. A collaborator added to
particular sites cannot open it, because Outreach covers the whole
organization.

## Connect a mailbox {#connect-a-mailbox}

Each rep connects their **own** Google mailbox in **Outreach → Mailboxes**:

1. Select **Connect with Google** and choose your Google account.
2. Google asks you to let Outreach **send email on your behalf** and **read
   your email**. Allow both. Sending is how a sequence's messages go out as
   you; reading is how Outreach notices a reply or a bounce, so a sequence
   stops when somebody answers. If either is left unticked, the connection is
   refused and nothing is saved.
3. You come back to Mailboxes with the mailbox listed as **Active**.

The access Google grants is stored encrypted and is never shown to anyone,
administrators included. Connecting the same Google account again updates the
mailbox you already have and keeps its settings. Each member can connect up to
five mailboxes.

If Mailboxes says connecting a Google mailbox isn't configured, your deployment
has no Google OAuth client set up. On a self-hosted install, see
[Environment variables](../../developers/self-hosting-environment.md#outreach).

### Send-as address and display name {#send-as}

A mailbox sends **as** one address: the account's own, or an alias Gmail has
already verified for it — one added under **Settings → Accounts → Send mail
as** in Gmail and confirmed there. Outreach only offers addresses Gmail lists
as verified. To use a new alias, add it in Gmail first, then connect the
mailbox again so Outreach sees it.

If the same address is waiting for verification under
[Your sending addresses](./settings.md#your-sending-addresses), connecting the
mailbox verifies it there too, because Gmail has already confirmed you can send
as it.

The **display name** is the name recipients see beside the address.

### Daily cap, warm-up and sending window {#daily-cap}

- **Daily cap** — the most the mailbox sends in one day. It starts at **20**
  and can be set up to **50**.
- **Warm-up** — a newly connected mailbox ramps up: at most **10** a day in
  its first week, **20** in its second and **30** from its third. The daily
  cap still applies, so a mailbox capped at 20 never sends more than 20.
- **Sending window** — the days of the week and the hours the mailbox sends
  in, read in the mailbox's **timezone**. A message that comes due outside the
  window waits for the next opening.

Google Workspace itself allows each user 2,000 messages and 2,000 unique
external recipients a day, aliases included; the caps here keep a mailbox far
below that.

### Status and health {#mailbox-status}

| Status | What it means |
| --- | --- |
| **Active** | The mailbox can send. |
| **Paused** | Somebody paused it, or it paused itself — see below. Nothing sends from it until it is resumed. |
| **Reconnect required** | Google stopped accepting the connection — the password changed, access was removed from the Google account, or an administrator revoked it. Nothing sends until you connect the mailbox again. |
| **Disconnected** | The mailbox was disconnected. Nothing sends from it until it is connected again. |

**Health** shows the last seven days: messages sent, bounces and replies. A
mailbox that has never sent shows zeros and **No sends yet**.

### When a mailbox pauses itself {#auto-pause}

Bounces are the first sign that a list has bad addresses in it, and mailbox
providers judge a sender by them. So a mailbox pauses itself when:

- **two** of its emails hard-bounce in one of its days;
- more than **3%** of its last **50** emails hard-bounced; or
- a reply called one of its emails spam. That pause is meant to last a week,
  and the card says when the week is out.

The card says why, with the date, and a line is written to your
organization's activity. Re-check the addresses in the mailbox's sequences,
then select **Resume**. Only bounces that arrive after you resume are judged
again.

### Test, pause and disconnect {#mailbox-actions}

- **Send a test to myself** sends a short plain-text message from the mailbox
  to its own address, so you can check it arrives. Only the member who
  connected the mailbox can send one.
- **Pause** stops the mailbox sending; **Resume** starts it again.
- **Disconnect** removes the mailbox and deletes its stored access, and tells
  Google to revoke that access. If another connected mailbox still uses the
  same Google account — a shared inbox two members connected — the access is
  left in place for that mailbox. You can always remove access yourself from
  your Google Account's third-party connections.

Organization owners and admins can change the settings of, pause and
disconnect any member's mailbox — a departing rep's mailbox has to be
stoppable by somebody. Other members manage only their own.

When a member deletes their account, Outreach deletes the mailboxes they
connected and the access stored for them, and asks Google to revoke it; when
an organization is deleted, it asks Google to revoke the access of every
mailbox in it. Access another connected mailbox still uses is left in place
for that mailbox, as with a disconnect.

## Compliance settings {#compliance-settings}

Every Outreach email ends with a footer saying who sent it, where they can be
reached by post, that the email is a business solicitation, and how to stop
more of them:

```text
Example Co LLC · 100 Example St, Springfield, IL 62701
This is a business solicitation from Example Co. Not relevant? Reply "no" and I won't email again.
```

The United States' CAN-SPAM Act requires those things of a commercial email,
so Outreach adds the footer to every email itself, after your text — no
template or merge field can leave it off. You set what it says in
**Outreach → Compliance**:

- **Legal name** — your organization's legal name, as the footer prints it.
- **Brand name** — the name the solicitation sentence uses, when it isn't the
  legal name. Leave it empty to use the legal name.
- **Postal address** — a valid physical postal address: a street address, a
  post office box registered with the US Postal Service, or a private mailbox
  registered with the US Postal Service under its rules for commercial mail
  receiving agencies. Write it over as many lines as it takes; the footer
  prints them on one line.

**No sequence can be activated while the legal name or the postal address is
empty**, and an email with neither is never sent.

### Allowed countries {#allowed-countries}

The countries Outreach may send to at all, **United States** by default. Every
sequence sends only to the countries both it and this list allow, so taking a
country off here takes it off every sequence at once.

The others are off because the law is different there. Canada, the United
Kingdom and most of the European Union require a consent basis that an email
to someone who never contacted you does not have. So Outreach never sends a
**cold** email — to someone who never filled in a form, signed up, ordered or
booked with you, or wrote to you — outside the United States, whatever this
list says. Add another country only for people who came to you first.

## Sequences {#sequences}

A **sequence** is the emails, and the tasks between them, one person gets from
one rep. **Outreach → Sequences** lists each one with its mailbox, its status,
and how many people it has enrolled, and how many of them are still active,
replied, bounced or opted out.

### Build a sequence {#build-a-sequence}

Select **New sequence**, name it, and choose the **site** whose CRM the people
you enroll are contacts of and the **mailbox** it sends from. A sequence sends
as the member who connected its mailbox, so only that member, or an
organization owner or admin, can edit or activate it.

The **Mailbox** list offers the mailboxes you connected, and an owner or admin
every mailbox in the organization. A disconnected mailbox is never offered.
When exactly one of your own mailboxes is active, a new sequence starts on it.
With none, [connect one](#connect-a-mailbox) first.

A sequence holds up to **eight steps**, of which up to **four** are emails:

- **Email** — a subject and a body, or a CRM
  [email template](./email-templates.md) whose body is sent. Insert merge
  fields — the contact's first name, company or job title, your own name, the
  site's name — and `{{enrollment.personalLine}}`, the sentence you write for
  each person when you enroll them. Every email after the first replies in the
  first one's thread unless you turn **Reply in the same thread** off, in which
  case it starts a new thread and needs its own subject.
- **Task** — a **LinkedIn** touch, a **Call** or a **To-do** for you, with a
  title.

Each step waits a number of **business days** after the one before it — up
to 30, and at least 1 between emails — counted in the mailbox's timezone.
The first step can wait 0 days: it goes at the next opening of the sending
window. By default a sequence sends in its mailbox's sending hours;
**Sending hours** sets hours of its own for this sequence.

The **Preview** beside the editor shows each email as it would reach a sample
contact, with the real footer, and the editor lists anything that stops the
sequence from being saved beside the field it is about.

### Activate, pause and archive {#sequence-status}

| Status | What it means |
| --- | --- |
| **Draft** | Being written. Nothing is sent, and nobody can be enrolled. |
| **Active** | Enrolled people get each step when it comes due. |
| **Paused** | Nothing is sent. Activating it again picks up where each person was. |
| **Archived** | Final. Everyone still in it is stopped, and it takes no one new. |

A sequence can be activated only while its mailbox is **Active** in Mailboxes.
A paused mailbox has to be resumed, and one that says **Reconnect required**
connected again, first. Activation also needs the legal name and postal
address from [Compliance settings](#compliance-settings). Until both are in
place, the sequence's page says what is missing and **Activate** stays
unavailable. If an active sequence's mailbox is paused or needs reconnecting,
nothing is sent from it until the mailbox is active again.

A draft nobody was ever enrolled in can be deleted; once anyone has been
enrolled, archive the sequence instead. After the first enrollment you can
still reword a step and add steps at the end, but not remove, reorder or
change the kind of a step, or move the sequence to another site or mailbox —
people in it are partway through those steps. Start a new sequence to change
them.

## Enroll people {#enroll}

Select **Enroll people** on an active sequence, and choose them from a saved
[Contacts view](./views.md) or by searching your contacts at the sequence's
site — up to 50 at a time. Enrolling reads your contacts, so it takes the
**Manage data** permission as well as **Use Outreach**.

Before anything is enrolled, each person is marked:

- **Eligible** — enrolled as they are.
- **Needs you** — enrolled once you've written their personal line and
  confirmed what's asked below.
- **Blocked** — not enrolled, with the reason: a personal mailbox, which cold
  outreach never goes to; an address outside the allowed countries, or in no
  known country; on the platform's or your site's suppression list after a
  bounce, a complaint or an unsubscribe; opted out of sales email from the
  site; on
  your organization's do-not-contact list; a member of your workspace; a
  customer, unless the sequence includes customers; or already in a sequence.

### Cold contacts {#cold-contacts}

A contact is **cold** when nothing on your site shows they came to you: no
form, sign-up, order or booking, and no email from them. For each cold
contact you write a **personal line** — one sentence on why you're writing to
this person now, which the sequence puts where `{{enrollment.personalLine}}`
is — and confirm three things only you can know:

- **This is a US business address.**
- **They or their company published this address, or they gave it to us** —
  never guessed from a name, and never bought.
- **This address was verified as deliverable.**

Each confirmation is stored on the enrollment with who made it and when.

**Enroll** checks every person again as it enrolls them, so someone who
unsubscribed a moment ago is refused even though they were eligible when you
looked. A person goes through a sequence once: they can't be enrolled in the
same sequence again, even after it finishes.

## Enrollments {#enrollments}

A sequence's **Enrollments** tab lists everyone in it: their status, the step
they're on, when the next one is due in the mailbox's timezone, when the last
one went, and why they stopped when they have. For each one you can:

- **Pause** and **Resume** — nothing is sent while they're paused.
- **Stop** — they get nothing more from this sequence.
- **Mark do-not-contact** — puts the address on your organization's
  do-not-contact list, which every sequence checks before every send, and
  stops them in every other sequence too.

## How sends are scheduled {#sending}

Every **15 minutes**, Outreach sends the steps that have come due, from each
rep's own mailbox:

- **In the sending hours** of the sequence, or of its mailbox, read in the
  mailbox's timezone. A step that comes due outside them waits for the next
  opening.
- **Within the day's limit** — the daily cap and the warm-up — spread across
  the sending hours, so a day's emails do not all leave in its first half
  hour. One run sends at most five emails from a mailbox, follow-ups before
  first emails.
- **After every check again.** Everything enrolling checked is checked again
  before each email — the do-not-contact list, the suppression lists, the
  site's sales-email opt-outs, whether the person became a customer or joined
  your workspace — because a person enrolled on Monday can unsubscribe by
  Thursday.

Each email is sent once: two runs that overlap never send the same step
twice, and never go over a mailbox's cap between them. It is filed on the
contact's timeline in the CRM as an email from the rep, and a **task** step
becomes a CRM task for the rep, due the day it comes due.

Nothing is sent while your organization's legal name or postal address is
missing, or while a mailbox is paused or needs reconnecting — those
sequences wait.

## What stops a sequence {#what-stops-a-sequence}

Outreach reads each connected mailbox every 15 minutes for what came back:

| What happens | What Outreach does |
| --- | --- |
| **The person replies** | Stops the sequence (**Replied**), files the reply on the contact's timeline, and gives the rep the task **Reply from** *their name*. |
| **An out-of-office reply** | Keeps the sequence going, and moves the next step to at least five business days after the reply. |
| **They ask not to be emailed** — a reply such as "no" or "unsubscribe", the unsubscribe link, or a message to the unsubscribe address | Stops the sequence (**Opted out**), puts the address on your do-not-contact list, unsubscribes it from the site's **Sales outreach** email, and stops it in every other sequence. |
| **The email hard-bounces** | Stops the sequence (**Bounced**) and puts the address on your do-not-contact list and on the platform's suppression list. |
| **A check refuses them before the next email** — a customer now, a member of your workspace, on a suppression list | Stops the sequence, saying which check. |
| **The mailbox is disconnected or removed, or the member who connected it leaves the organization** | Stops the sequences that send from it. |
| **The next email needs something the contact doesn't have** — a first name for `{{contact.firstName}}` | Pauses the enrollment, naming what is missing. Fill it in and select **Resume**. |

A reply that arrives after the sequence finished, or after it was stopped,
is still read: the enrollment moves to **Replied**, or to **Opted out** when
the reply asks not to be emailed.

## Unsubscribe {#unsubscribe}

Every Outreach email carries two ways out beside the footer's "reply no":

- a **one-click unsubscribe link** in the email's `List-Unsubscribe` header,
  which Gmail, Yahoo and most mail apps show as an **Unsubscribe** button;
- an **unsubscribe address** — the rep's own address with `+unsubscribe`
  added — for mail apps that unsubscribe by email.

Either one stops the person's sequences, puts the address on your
do-not-contact list and unsubscribes it from the site's **Sales outreach**
email. The link needs no sign-in, shows a plain page saying it is done, and
keeps working for good — including after Outreach is paused for your
workspace.

When a person is erased from your workspace, their enrollments are deleted
with them. Their do-not-contact entry stays — it holds no address, only a
one-way key — so they are never emailed again.

## Related

- [CRM](./overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [Custom roles](../../workspace-and-billing/teams-and-roles/custom-roles.md)
