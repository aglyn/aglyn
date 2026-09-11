---
sidebar_position: 7
title: Leads
description: Work the people your site has captured — a status, an owner and notes on every lead — and convert one into a contact, a company and a deal.
---

# Leads

A **lead** is somebody your site has met but you have not yet qualified: a
visitor who signed up, booked, or submitted a form that routes leads. The
**Leads** section of the CRM is where the team works them — decides who owns
each one, keeps notes, and either converts the lead into a contact or closes
it with a reason.

Leads live under the site that captured them, so each site's list is its own.
Open **CRM → Leads** in the console, or use **Open in CRM** on a lead row in
the Inbox's **Site Members & Leads** section.

:::info Plan availability
Leads are on every plan, and on Free the CRM opens on them. On Free the section is
**read-only**: the list, a lead's page, **Export CSV**, **Export all…** and **Erase this
person** stay, and every form on your site files a lead. Working a lead — its status,
owner and notes, **Convert**, **Unqualify**, **Import CSV**, calls, email and bookings —
is part of the **CRM suite**, included from **Starter**. See
[What each plan includes](./overview.md#what-each-plan-includes).
:::

## What makes a lead

Every capture lands in [Contacts](./contact-record.md) — one row per person,
at the earliest [lifecycle stage](./contact-record.md#lifecycle-stages) that
describes what happened. A **lead** is created in addition, and only by a
**lead surface**:

- a **member sign-up**;
- a **booking**;
- a **form** whose own page has **Also create a lead from the address someone
  gives this form** switched on. A form without it still updates the contact
  at stage Lead; it just files nothing here.

On **Free** there is no switch to turn: every form on your site is a lead surface,
including a form placed on a page with no saved form behind it, so every submission
that carries an email address files a lead.

So Contacts is the address book and Leads is the working list. The Leads
section opens with which surfaces create leads on this site — sign-ups,
bookings, and the lead-routed forms by name, each linking to the form's page
— and offers **Turn on lead routing** beside a form that could route. A form
with no email field cannot key a lead, and a form that records no consent
would file leads the team cannot email; in either case the control says so
instead of switching, because publishing the form would refuse the same
thing. One person is one lead: a second submission updates the lead the first
one created. Leads from before the Leads section existed were created from
those earlier submissions and bookings, so a person who wrote in through a
lead-routed form before lead routing existed is in the Open view too,
unassigned.

At the [organization level](./overview.md#at-the-organization-level) —
**CRM → Leads** from the organization's own tab, where every site's leads
are one list — the same note opens the section
**grouped by site**. Sign-ups and bookings are named once, since they create
a lead on every site; then each site is a group of its own, named and linking
to that site's Leads section, with its lead-routed forms by name, **Turn on
lead routing** beside the forms that could route, and the reason as the
control's tooltip beside the ones that cannot. A site with no forms says so
in one line. The first three sites open with their forms showing; the rest
wait behind **Show N more sites**, and their forms are not read until you
open them. Turning routing on from here switches that site's form and names
the site in the confirmation.

The contact's own page links back: **Lead on this site** on the
[Relationship card](./contact-record.md#where-the-persons-lead-is) opens the
lead when this site holds one for the address.

## The Leads list

The list shows the most recently seen leads first — a person who booked
yesterday sits above one who signed up last month, whichever came first.
Each row carries:

| Column | What it shows |
| --- | --- |
| **Lead** | The name the person gave, with their email beneath it — or the email alone. |
| **Status** | New, Working, Qualified or Unqualified. Change it in place from the row. |
| **Owner** | The team member working the lead, or *Unassigned*. A lead inherits its [contact's owner](#who-owns-a-lead) when one is assigned on capture. |
| **Source** | Every surface that captured this person: Sign-up, Booking, or the form they submitted. |
| **Last seen** | When the person last did something on your site. |

The **Show** control at the top of the card picks the view. **Open** — the
default — is every lead that still needs working (New and Working). The other
views are one status each, and **All** shows everything. A lead nobody has
touched yet has no status of its own and reads as **New**, so the leads your
site collected before the CRM existed are already in the Open view.

The list reads the 200 most recently seen leads and shows them a page at a
time, with the usual footer to turn the page and pick how many rows it holds.
When a site holds more than 200, a notice says so; the status filter narrows
those 200, and older leads are still listed in the Inbox and still reached by
campaign audiences.

### Working a lead from the row

- **Status** — click the status chip to change it to New or Working.
  Choosing **Unqualified…** asks for a reason first.
- **Row menu** (⋮) — **Open lead**, **Convert…**, **Assign owner**, or
  **Unqualify**. **Convert…** opens the same dialog as the lead's page (see
  [Converting a lead](#converting-a-lead)) without opening the page first; on
  a lead already converted, unqualified, or whose person has an erasure
  pending, it is disabled with the reason as its tooltip.
- Click anywhere else on the row to open the lead's page.

Every change here is saved immediately; there is no separate save step.

### Several leads at once

Every row has a checkbox. Tick one or more — or the header's checkbox for
the page — and a bar appears over the list with **Set owner**, **Set
status**, **Unqualify** (one reason for all of them) and **Export CSV** for
the selection. What each does, and which leads it skips by name, is in
[Bulk actions → Leads](./bulk-actions.md#leads). The selection clears when
the **Show** view changes.

### Export CSV

**Export CSV** at the top of the card downloads the listed leads — every row
the **Show** view admits, not only the page on screen — as `leads.csv`:
email, name, status, the owner by email address, the sources by name, first
and last seen, the number of captures, the unqualified reason, when the lead
converted, and notes. At the organization level the file also names each
lead's **Site**.

### Import from CSV

**Import CSV** beside **Export CSV** takes a spreadsheet of leads — another
tool's export, a list from an event — and files each row under one of your
sites. A lead is keyed by email address, so a person the site has already
met is **updated** rather than added twice, and importing the same file
again finishes what a closed drawer left. Importing needs the same **Manage
data** permission as importing contacts.

The three steps are the ones the [contacts import](./import.md) walks: choose
the file (up to 5,000 rows), match its columns, check the ten-row preview,
then import in batches of 200 with a result that says how many were
**added**, **updated** and **skipped**, the skipped rows downloadable as a
CSV that says why. **Download template** hands you the export's own header
over no rows.

| Field | What is read |
| --- | --- |
| **Email** | Required, and the identity. A row whose address cannot be read is skipped as *No usable email address*; two rows with the same address skip the second as a duplicate. |
| **Name** | The person's name, as the list and campaign merge tags read it. |
| **Status** | `new`, `working` or `unqualified`, by id or by label. **Qualified** is not a status a file may set — a lead becomes qualified by [converting](#converting-a-lead), beside the contact that conversion created — so a cell naming it is dropped and reported, and the lead keeps the status it has. |
| **Owner** | The email address of a member of your organization. An address that matches nobody leaves the lead unassigned and is named at the end of the import. |
| **Unqualified reason** | Kept only on a row whose **Status** is `unqualified`; on any other row it is dropped and reported, because the reason is what an unqualified lead was closed for. |
| **Notes** | Free text. |

The export's **Sources**, **First seen**, **Last seen** and **Captures**
columns are proposed as **Do not import**: they are what the capture doors
recorded about what the visitor actually did, and a file must not be able to
rewrite it. **Converted** is left out for the same reason — it is stamped
when a lead really becomes a contact. At the organization level the export's
**Site** column is left out too: the drawer asks which site the file is
filed under, and every row in the file goes there.

**No marketing consent is recorded by an import.** A capture writes a
consent basis only when the visitor ticked a box in front of them, and a
spreadsheet is not that box, so there is no consent column to fill. An
imported lead can be included in a campaign audience only if the site
already holds a consent for that person from an earlier capture — see
[Who a campaign is allowed to reach](../../marketing-and-automation/email-campaigns/overview.md#who-a-campaign-is-allowed-to-reach).

### Who owns a lead

A lead starts unassigned unless the workspace decided otherwise. When the
same capture creates a **contact** and the [assignment rules](./settings.md#assignment-rules)
or the site's [default owner](./settings.md#default-owner) give that
contact an owner, the lead is given the same owner, and the owner gets a
console notification — **Lead assigned to you**, linking to the lead's page.
A lead somebody already assigned by hand keeps that owner. An automation
that [reassigns the contact](./automations.md#assigning-an-owner-or-rotating-one)
moves the lead's owner with it.

Assigning an owner from the row menu or the lead's page changes the lead
alone; the contact, when there is one, is assigned from its own record.

## A lead's page

Click a row to open the lead. The page has two cards.

**Lead** holds what the team decides: the status, the owner, and free-text
**notes** with a **Save notes** button. It also shows the identity the capture
recorded — email and name, and a phone number when the form that captured
them took one — and the person's **marketing consent**: whether they opted in
(and when), declined, or never recorded a choice. A lead with no recorded
consent cannot be sent marketing email, which is worth knowing before you
promise them a newsletter. The card's header carries **Call** and **Log a
call** beside **Send email** — see
[click to call](./activities.md#click-to-call).

**Captured history** is read-only: when the person was first and last seen,
how many times your site captured them, every source that did, and — under
*Where this lead came from* — the campaign the capture is credited to, when
there is one.

## Converting a lead

When a lead is real, click **Convert** on the lead's page, or choose
**Convert…** from its row's menu on the list — the same dialog either way,
from the list in one click. The dialog asks three things:

1. **Contact.** The lead becomes a contact at the **Sales qualified**
   lifecycle stage, owned by whoever you pick — the lead's owner by default.
   Pick nobody and the workspace's [assignment rules](./settings.md#assignment-rules)
   and the site's [default owner](./settings.md#default-owner) decide, and
   failing those the contact is yours. A colleague you pick is notified;
   you are not told about a contact you kept. If this email address is
   already a contact, the conversion joins that contact rather than creating
   a second one — the address book stays one row per person — and a contact
   that already has an owner keeps them.
2. **Company.** *No company*, *Link an existing company*, or *Create a
   company*. The dialog proposes the company the lead's email domain implies:
   if your workspace already has a company at that domain, it is preselected;
   otherwise a new one is proposed, named after the domain, with the domain
   filled in. Public mailboxes such as Gmail propose nothing.
3. **Deal.** Tick **Open a deal** to open one in your default pipeline with a
   title, an amount, a currency and a starting stage. A workspace with no
   pipeline yet gets a **Sales** pipeline with the default stages created
   along with the deal.

Converting marks the lead **Qualified**, records what it became, and takes
you to the new contact's page. Back on the lead, the card links to the
contact, the company and the deal. A converted lead cannot be converted
again — opening the dialog on one simply takes you to its contact.

A lead whose person has an [erasure pending](#erasing-the-person) cannot be
converted either: **Convert** stays on the page but is disabled, with the
reason as its tooltip, until the nightly job has run — and the job removes
the lead along with the person. If a later form fill captures the same
address as a new lead, that lead cannot be converted: the erasure closed the
address to capture, and a conversion is a capture, so the dialog answers
*This person was erased from your workspace at their request, so a record
cannot be created for this address*. Nothing is changed.

The same conversion — the same contact, company and deal, through the same
code — is available to an integration as
[`POST /v1/leads/{id}/convert`](/api/resources/leads#convert-a-lead) on the
REST API, and the list itself as `GET /v1/leads`.

## Unqualifying a lead

**Unqualify** — from the row's menu on the list, or from the menu (⋮) in the
header of the lead's page — closes a lead without converting it. A reason is
required, so the closed leads can be counted by why they closed. An unqualified lead drops
out of the Open view and keeps its reason on its page; set its status back to
Working to reopen it, which clears the reason.

## Erasing the person

The menu (⋮) in the header of the lead's page also carries **Erase this
person** — the privacy erasure, for a person who asks to be forgotten. It is
the same request the contact record offers, filed by the lead's address: the
person is removed from every site in the workspace, the address is closed to
capture at once, the lead shows an **Erasure pending** banner with its
**Convert** button disabled, and the sweep runs with the nightly erasure job.
Workspace admins only. What it removes,
what it keeps and what it does not reach are listed in
[Deleting and erasing](./contact-record.md#deleting-and-erasing).

## Who can do this

Anyone who can open the CRM can work leads — that is the workspace's
**data** permission, the same one that guards contacts. Converting a lead
also requires a role on the site the lead belongs to.

Working leads is part of the **CRM suite**, included from **Starter**. On Free the
Leads section is read-only, and every form on your site files a lead into it.

## Related

- [CRM overview](./overview.md)
- [CRM settings](./settings.md) — the default owner and assignment rules a lead inherits
- [Reports](./reports.md#lead-funnel) — the lead funnel: where a period's leads stand, and why the unqualified ones were closed
- [The contact record](./contact-record.md) — what a converted lead becomes
- [Companies](./companies.md) and the [deals pipeline](./deals.md) — the other two records a conversion can open
- [Forms & lead capture](../forms/overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [REST API — leads](/api/resources/leads) — the same queue and the same conversion, for an integration
