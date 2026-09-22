---
sidebar_position: 15
title: Sequences
description: One-to-one email sequences a rep sends to a person from their own connected mailbox, kept with the CRM. Rolling out.
---

# Sequences

:::caution Rolling out
Sequences is a **release-flagged feature, currently being rolled out** — it is
not available in your workspace yet. This page says what it is for, and grows
with the feature.
:::

## What it is for

Sequences is for one-to-one selling. A rep writes a short **sequence** — a
first email and the follow-ups after it, each a set number of days apart — and
enrolls people from the CRM in it. Every email goes to one person, as a message
from the rep rather than as a campaign.

It is not a way to send one message to an audience. That is what
[email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
are for, sent from your site's sending identity to a segment of your contacts.

## Sent from your own mailbox

A sequence sends from the **rep's own mailbox**, connected to the workspace
through the rep's Google account. The email leaves from that address, sits in
that rep's sent mail like any other, and a reply comes back to the same inbox
— which is what makes it a conversation between two people rather than a
broadcast.

## Where it lives

Sequences is a tab of its own at the **organization** level, beside the CRM. It
has three sections: **All sequences**, **Mailboxes** and **Compliance**.

Opening it takes the **Use Sequences** permission, which owners and admins hold
by default. A [custom role](../../workspace-and-billing/teams-and-roles/custom-roles.md)
can grant it to other members of the organization. A collaborator added to
particular sites cannot open it, because Sequences covers the whole
organization.

## Connect a mailbox {#connect-a-mailbox}

Each rep connects their **own** Google mailbox in **Sequences → Mailboxes**:

1. Select **Connect with Google** and choose your Google account.
2. Google asks you to let Aglyn **send email on your behalf** and **read
   your email**. Allow both. Sending is how a sequence's messages go out as
   you; reading is how a reply or a bounce is noticed, so a sequence stops
   when somebody answers. If either is left unticked, the connection is
   refused and nothing is saved.
3. You come back to Mailboxes with the mailbox listed as **Active**.

The access Google grants is stored encrypted and is never shown to anyone,
administrators included. Connecting the same Google account again updates the
mailbox you already have and keeps its settings. Each member can connect up to
five mailboxes.

If Mailboxes says connecting a Google mailbox isn't configured, your deployment
has no Google OAuth client set up. On a self-hosted install, see
[Environment variables](../../developers/self-hosting-environment.md#sequences).

### Send-as address and display name {#send-as}

A mailbox sends **as** one address: the account's own, or an alias Gmail has
already verified for it — one added under **Settings → Accounts → Send mail
as** in Gmail and confirmed there. Only addresses Gmail lists as verified are
offered. To use a new alias, add it in Gmail first, then connect the mailbox
again so the new alias is seen.

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
  **Warm up gradually** is on for every new connection; the member who owns
  the mailbox can switch it off for one that has sent mail for years and
  already has its reputation, and it then sends at its cap from that day.
  Switching it back on starts a fresh ramp.
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
| **Reconnect required** | Google stopped accepting the connection — the password changed, access was removed from the Google account, or an administrator revoked it. Nothing sends until you connect the mailbox again. The member who connected it, and the organization's owners and admins, are emailed the moment this happens, with a link to this page. |
| **Disconnected** | The mailbox was disconnected. Nothing sends from it until it is connected again. |

**Health** shows the last seven days: messages sent, bounces and replies. A
mailbox that has never sent shows zeros and **No sends yet**.

### When a mailbox pauses itself {#auto-pause}

Bounces are the first sign that a list has bad addresses in it, and mailbox
providers judge a sender by them. So a mailbox pauses itself when:

- **two** of its emails hard-bounce in one of its days;
- more than **3%** of its last **50** emails hard-bounced, once at least
  **25** of them are in that window — under that, one bounce would be the
  whole rate, and a single blocked address is not a list problem; or
- a reply called one of its emails spam. That pause is meant to last a week,
  and the card says when the week is out.

The card says why, with the date, and a line is written to your
organization's activity. The member who connected the mailbox, and the
organization's owners and admins, are emailed the moment it pauses: the
reason in the mailbox's own words, how many enrollments are waiting on it,
and a link to this page. Re-check the addresses in the mailbox's sequences,
then select **Resume**. Only bounces that arrive after you resume are judged
again.

### Test, pause and disconnect {#mailbox-actions}

- **Send a test to myself** sends a short plain-text message from the mailbox
  to its own address, so you can check it arrives. Type another address in
  **Test address** to send it there instead: a test to your own address never
  leaves Google, so it carries no authentication result — a test to an
  outside mailbox you can read is the one whose original source shows
  whether the send-as domain's DKIM, SPF and DMARC pass. Only the member who
  connected the mailbox can send one, and at most five an hour.
- **Pause** stops the mailbox sending; **Resume** starts it again.
- **Disconnect** removes the mailbox and deletes its stored access, and tells
  Google to revoke that access. If another connected mailbox still uses the
  same Google account — a shared inbox two members connected — the access is
  left in place for that mailbox. You can always remove access yourself from
  your Google Account's third-party connections.

Organization owners and admins can change the settings of, pause and
disconnect any member's mailbox — a departing rep's mailbox has to be
stoppable by somebody. Other members manage only their own.

When a member deletes their account, the mailboxes they connected and the
access stored for them are deleted, and Google is asked to revoke it; when an
organization is deleted, Google is asked to revoke the access of every mailbox
in it. Access another connected mailbox still uses is left in place for that
mailbox, as with a disconnect.

## Compliance settings {#compliance-settings}

Every email a sequence sends ends with a footer saying who sent it, where they
can be reached by post, that the email is a sales email, and how to stop more
of them:

```text
Example Co LLC · 100 Example St, Springfield, IL 62701
This is a sales email from Example Co. Not interested? Reply "no" and I won't email again.
```

The United States' CAN-SPAM Act requires those things of a commercial email,
so the footer is added to every email after your text — no template or merge
field can leave it off. You set what it says in **Sequences → Compliance**:

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

The countries a sequence may send to at all, **United States** by default.
Every sequence sends only to the countries both it and this list allow, so
taking a country off here takes it off every sequence at once.

The others are off because the law is different there. Canada, the United
Kingdom and most of the European Union require a consent basis that an email
to someone who never contacted you does not have. So a **cold** email — to
someone who never filled in a form, signed up, ordered or booked with you, or
wrote to you — never goes outside the United States, whatever this list says.
Add another country only for people who came to you first.

### Do not contact domains {#do-not-contact-domains}

The domains no sequence emails anyone at, whoever enrolls them. Your
organization's do-not-contact list holds addresses — a person who replied
"no", used the unsubscribe link, or was marked do-not-contact on an
enrollment — and, beside them, whole domains:

- **Add one yourself** — a company that asked not to hear from you, or one
  whose mail gateway you know blocks you. Type the domain (`example.com`; an
  address at it works too) and select **Add domain**.
- **Added for you** — when an email hard-bounces because the recipient's mail
  gateway refused it (Barracuda, Proofpoint, Mimecast and the like say so in
  the bounce), rather than because the address is unknown, the domain is
  added here with the bounce's reason. That kind of bounce is the whole
  company's verdict on the sender, and the next person there would bounce
  the same way and count against the mailbox's bounce rule.

Every address at a listed domain is refused in **Check people** and again
before each send, with the domain named. Take a domain off with its
**Remove** button; both changes are written to your organization's activity.
Domains of public mailbox providers are never added automatically.

## Sequences {#sequences}

A **sequence** is the emails, and the tasks between them, one person gets from
one rep. **Sequences → All sequences** lists each one with its mailbox, its status,
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

**Campaigns** files the sequence under one or more of the site's
[campaigns](../../marketing-and-automation/email-campaigns/overview.md#what-belongs-to-a-campaign),
the way a form or a landing page is filed under one. Everyone you enroll from
then on joins those campaigns on their own record — a lead at the top of its
document, a contact on the site's facet — and what the sequence produces is
counted on each campaign's page: people enrolled, first emails sent, replies,
meetings booked from a sequence link, and enrolled leads that converted. A
campaign the sequence joins later does not claim the people already in it,
and one it leaves keeps what it was credited with. Filing a sequence under a
campaign changes nothing about who is enrolled or what is sent.

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
[Contacts or Leads view](./views.md), by searching your contacts at the
sequence's site, or from the **Leads** tab — the site's open
[leads](./leads.md) — up to 50 at a time. Enrolling reads your contacts and
leads, so it takes the **Manage data** permission as well as **Use Sequences**.

A **lead** is enrolled as it is, with no contact made: the emails read the
lead's name, company and title wherever the steps say `{{contact.firstName}}`,
`{{contact.company}}` or `{{contact.title}}` (and `{{lead.…}}` reads the same
fields), the sends and replies land on the lead's page, a call step files its
task on the lead, and a reply moves a lead from **New** to **Working**. When
the lead [converts](./leads.md#converting-a-lead), its enrollment carries on
as the contact's — same thread, same place in the steps — so a person is never
enrolled twice by being two records. A lead that already converted, one whose
address is already a contact, and one closed as unqualified are blocked with
the reason: enroll the contact, or reopen the lead.

Before anything is enrolled, each person is marked:

- **Eligible** — enrolled as they are.
- **Needs you** — enrolled once you've written their personal line and
  confirmed what's asked below.
- **Blocked** — not enrolled, with the reason: a personal mailbox, which a
  cold email never goes to; an address outside the allowed countries, or in no
  known country; on the platform's or your site's suppression list after a
  bounce, a complaint or an unsubscribe; opted out of sales email from the
  site; on your organization's do-not-contact list, or at a
  [domain on it](#do-not-contact-domains); a member of your workspace; a
  customer, unless the sequence includes customers; already in a sequence; or
  a lead that converted, is already a contact, or was closed as unqualified.

### Cold contacts {#cold-contacts}

A contact is **cold** when nothing on your site shows they came to you: no
form, sign-up, order or booking, and no email from them. A lead is judged the
same way: one that wrote in through a form or booked is not cold; one you
imported or added by hand is. For each cold
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

Enrolling someone in a sequence that is in a
[campaign](#build-a-sequence) files them under that campaign too: the
enrollment records the campaigns as they stood, the lead or contact gains
them on its own record, and the campaign's page counts the person under
**Enrolled** from that moment. Their first email, a reply, a meeting booked
from a link in a sequence email and a lead's conversion are each counted
there once as they happen, and the person's page says the sequence is
where they came from when nothing else is credited first.

## Enrollments {#enrollments}

A sequence's **Enrollments** tab lists everyone in it: their status, the step
they're on, when the next one is due in the mailbox's timezone, when the last
one went, and why they stopped when they have. A person enrolled as a lead is
marked **Lead** until the lead converts. For each one you can:

- **Pause** and **Resume** — nothing is sent while they're paused.
- **Stop** — they get nothing more from this sequence.
- **Mark do-not-contact** — puts the address on your organization's
  do-not-contact list, which every sequence checks before every send, and
  stops them in every other sequence too.

## How sends are scheduled {#sending}

Every **15 minutes**, the steps that have come due are sent, from each rep's
own mailbox:

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

Each connected mailbox is read every 15 minutes for what came back:

| What happens | What it does |
| --- | --- |
| **The person replies** | Stops the sequence (**Replied**), files the reply on the contact's timeline, and gives the rep the task **Reply from** *their name*. |
| **An out-of-office reply** | Keeps the sequence going, and moves the next step to at least five business days after the reply. |
| **They ask not to be emailed** — a reply such as "no" or "unsubscribe", the unsubscribe link, or a message to the unsubscribe address | Stops the sequence (**Opted out**), puts the address on your do-not-contact list, unsubscribes it from the site's **Sales outreach** email, and stops it in every other sequence. |
| **The email hard-bounces** | Stops the sequence (**Bounced**) and puts the address on your do-not-contact list and on the platform's suppression list. When the bounce says the recipient's mail gateway refused it rather than that the address is unknown, the whole [domain](#do-not-contact-domains) goes on the list too, and the enrollment says so. |
| **A check refuses them before the next email** — a customer now, a member of your workspace, on a suppression list | Stops the sequence, saying which check. |
| **The mailbox is disconnected or removed, or the member who connected it leaves the organization** | Stops the sequences that send from it. |
| **The next email needs something the contact doesn't have** — a first name for `{{contact.firstName}}` | Pauses the enrollment, naming what is missing. Fill it in and select **Resume**. |

A reply that arrives after the sequence finished, or after it was stopped,
is still read: the enrollment moves to **Replied**, or to **Opted out** when
the reply asks not to be emailed.

Every verdict a list takes is written on the person's record too: the lead
or the contact carries an [email state](./leads.md#email-state) — Bounced,
Blocked by their mail gateway, Unsubscribed, Marked as spam, Do not contact
— and the email the sequence sent reads **Bounced** on their timeline. A
member marking an enrollment do-not-contact stamps the record the same way.

## Unsubscribe {#unsubscribe}

Every email a sequence sends carries two ways out beside the footer's
"reply no":

- a **one-click unsubscribe link** in the email's `List-Unsubscribe` header,
  which Gmail, Yahoo and most mail apps show as an **Unsubscribe** button;
- an **unsubscribe address** — the rep's own address with `+unsubscribe`
  added — for mail apps that unsubscribe by email.

Either one stops the person's sequences, puts the address on your
do-not-contact list and unsubscribes it from the site's **Sales outreach**
email. The link needs no sign-in, shows a plain page saying it is done, and
keeps working for good — including after Sequences is paused for your
workspace.

When a person is erased from your workspace, their enrollments are deleted
with them. Their do-not-contact entry stays — it holds no address, only a
one-way key — so they are never emailed again.

## Related

- [CRM](./overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [Custom roles](../../workspace-and-billing/teams-and-roles/custom-roles.md)
