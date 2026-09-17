---
sidebar_position: 4
title: CRM by AI
description: A short summary and a suggested next step on a contact, company, deal or lead, a one-to-one email drafted into the composer, and an import's columns matched to fields. Aglyn AI suggests; you save, send and import.
---

# CRM by AI

Aglyn AI works in three places in the CRM. In each one it makes a suggestion and you decide
what happens next: nothing is saved, sent or imported until you do it yourself.

- **On a record's page**, a short summary of where things stand with a contact, company, deal
  or lead, with a suggested next step.
- **In the email composer**, a draft of the one-to-one email you describe.
- **In an import**, a suggested match between the columns of your file and the fields they
  fill.

:::info Availability
CRM by AI is released gradually. This page applies to it as it reaches your workspace.
:::

## Summarize a record {#summarize-a-record}

On a contact's, company's, deal's or lead's page, **Summarize this contact** (or company, deal
or lead) writes at most two sentences from the record's timeline: when it was last in touch and
how, and what is still open. The date under the summary is the day it was written.

What comes with the summary depends on the record:

- **Contacts, companies and deals** get a **suggested next step** when one is worth doing: a
  task with a title, a kind (call, email, meeting or to-do), a priority, a due date within the
  next 30 days, and the reason for it. **Create task** opens the CRM's task form with the
  suggestion filled in and linked to the record. Change anything you like; the task is saved
  only when you press **Save**. No step is suggested when an open task already covers it.
- **Deals** also get a **suggested stage** when the timeline shows the deal has moved on, such
  as a proposal accepted on a call. **Move to** asks you to confirm, and the deal then moves
  exactly as it does from its stage card, including any automation that runs on a stage change.
  AI only suggests open stages: winning or losing a deal is always your call.
- **Leads** get a sentence on why the lead stands where it does: its status, how it came in,
  and how often and how recently it was active. The CRM keeps no lead score, and AI does not
  make one up.

### Summaries are reused until the record changes

A summary is written from the record as it is at that moment. **Summarize again** on a record
that has not changed shows the same summary again without writing a new one, and it does not
use your AI allowance. A new timeline entry, a new or finished task, or an edited note makes the
next summary a new one.

A summary is kept for **two weeks**. Anyone in your workspace who can open the record can read
its summary; other members cannot.

## Draft a one-to-one email {#draft-an-email}

In the email composer on a contact, a deal or a lead, describe what the email should say (for
example, *"follow up on the quote and offer a call next week"*) and press **Draft the message**.
The subject and message are filled in from what you asked and the record's timeline, greeted and
signed with [merge fields](../content-and-data/crm/email-templates.md#merge-fields) such as
`{{contact.firstName}}`, which are filled in when the email is sent. If you have already written
a message, you are asked before it is replaced.

**AI never sends an email.** Read the draft, edit it, and press **Send** yourself. A draft that
includes an email address or a phone number is not offered, and AI is told never to make up a
price, a date or a promise that neither your request nor the record mentions, so check any it
states before you send.

Other members of your workspace cannot open a draft you asked for. What you type into the
request is kept with the AI request, as every AI request is, and members of your workspace can
see it in the list of AI jobs, so describe the email rather than pasting private details into
the request.

## Match an import's columns {#match-columns}

In a contacts, companies, deals or leads import, choose your file, then press
**Match columns**. The import's matching table fills in with a suggested field for each column
that has one, and the preview shows what the suggestion produces. Change any match, then press
**Import** when the preview looks right.

**Your file's rows are never sent.** For each column, only its header and the kind of values
under it are: email addresses, phone numbers, dates, numbers, yes-or-no values, web addresses,
text, or an empty column. That kind is worked out in your browser. Matching works on files of up
to 60 columns.

Other members of your workspace cannot see the matches suggested for your file.

## What AI reads from a record {#what-is-sent}

The CRM decides what AI may read, and it reads the same record you would see. For a summary or
an email draft, AI is given:

- the record's name, and for a contact their job title, company, lifecycle stage and tags;
- how the person came in (for example a form, a booking or an order), a count of their orders and
  the day of the last one, when they were added, and when they last opened or clicked an email;
- for a company, its domain, industry and how many people it has; for a deal, its pipeline and
  stages, stage, status, amount, expected close date, lost reason, the names of the person and
  company it is with, and how many products it has; for a lead, its status, how it was captured
  and how many times, when it was first and last seen, whether it is assigned or converted, and
  why it was unqualified;
- the record's notes (their first 600 characters);
- its 12 newest timeline entries: the day, the kind of activity, an email's subject and delivery
  state, and the first 280 characters of what was logged;
- up to 8 open tasks and, for a contact or company, up to 5 deals.

AI is **never** given an email address, phone number or postal address field, anyone's
marketing consent, a custom field's value, which team member owns a record or a task, or a
record's id.
When an email address or a phone number is typed into any text that is sent, such as a name, a
note, a logged activity, or a task's or deal's title, it is replaced before the text is sent. A street address typed into a note is not recognized, so it is
sent as typed.

## Who can use it {#who-can-use-it}

CRM by AI needs the **Generate with AI** permission (see
[the AI permissions](../workspace-and-billing/teams-and-roles/custom-roles.md#ai-permissions)) and
the CRM's own access to the record: the **Manage data** permission and access to the record's
site. At the organization level, it works for members who can reach every site. On a site that
has switched AI off, none of it appears on that site's pages.

## Related

- [The contact record](../content-and-data/crm/contact-record.md)
- [Deals](../content-and-data/crm/deals.md)
- [Leads](../content-and-data/crm/leads.md)
- [Import contacts from CSV](../content-and-data/crm/import.md)
- [How Aglyn AI builds](./how-aglyn-ai-builds.md)
