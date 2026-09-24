---
sidebar_position: 7
title: Leads
description: Work the people your site has captured — a status, an owner and notes on every lead — and convert one into a contact, a company and a deal.
---

# Leads

A **lead** is somebody you have heard of but not yet qualified: a visitor who
booked or wrote in through a form that routes leads, a person from a list you
imported, or one you added by hand. It is a record of its own — the way it is
in Salesforce — and it becomes a [contact](./contact-record.md) only when you
convert it. The **Leads** section of the CRM is where the team works them —
decides who owns each one, keeps notes, and either converts the lead into a
contact or closes it with a reason.

Leads live under the site that captured them, so each site's list is its own.
Open **CRM → Leads** in the console, or use **Open in CRM** on a lead row in
the Inbox's **Site Members & Leads** section.

:::info Plan availability
Leads are part of the **CRM**, included from **Starter**. On Free the section is shown
locked, with the rest of the CRM. Leads are still filed on Free, exactly as described
below, and kept; workspace owners and admins can export every lead, or erase a person,
from [Settings → Privacy](../../workspace-and-billing/signing-in-and-sessions.md#privacy-requests).
See [What each plan includes](./overview.md#what-each-plan-includes).
:::

## What makes a lead

One person is one record: a **lead** until somebody qualifies them, a
**contact** after. A lead is created by a **lead surface**, and by nothing
else:

- a **booking**;
- a **form** whose own page has **Also create a lead from the address someone
  gives this form** switched on;
- [Import CSV](#import-from-csv), [New lead](#adding-a-lead-by-hand), and
  [`POST /v1/leads`](/api/resources/leads#create-a-lead) over the REST API.

A lead surface files a lead and **no contact**. The one exception is a person
the workspace already holds as a contact — a customer who books a demo, say:
their booking lands on the contact's timeline, and no lead is filed, because a
contact is what a lead becomes and a person cannot be both.

The other doors work the other way round:

- A **form without lead routing** and a **newsletter opt-in** update the open
  lead when this site holds one for the address — its consent and its history
  stay on the one record the team is working — and the contact otherwise.
- A **member sign-up** and an **order** make the person a contact, because an
  account or a purchase is a relationship. An open lead the site held for the
  address is closed as **Qualified**, converted onto that contact, so nobody
  keeps working a lead who already joined or bought.

The plan changes none of this. On Free too, a form files a lead only when its lead
routing is on, and the lead is kept, though the Leads section that lists it is locked
with the rest of the CRM.

So Contacts is the people you have a relationship with and Leads is the working list. The Leads
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

## What a lead holds

A lead is a record of its own — the way it is in Salesforce — and carries the person and
their company **as text** until it converts:

| Field | Notes |
| --- | --- |
| **Email** | The identity: a site holds one lead per address. |
| **Name** | The person's name. |
| **Company** | The company's name, typed. Not a link — a thousand imported leads must not create a thousand companies. [Converting](#converting-a-lead) is what links or creates the company record, by this name or by the address's domain. |
| **Job title**, **Phone**, **Website** | As on a business card. The phone is stored with its country code; the website as a full address. |
| **Lead source** | Where the lead came from, picked from your organization's own [lead source values](./custom-fields.md#lead-source-values). A new lead starts from the list's default when it has one. Distinct from **Sources** below, which the site records. |
| **Tags** | Comma-separated, lower-cased. |
| **Campaigns** | The site's [campaigns](../../marketing-and-automation/email-campaigns/overview.md#what-belongs-to-a-campaign) the lead is filed under, picked by name. Grouping, not consent: it decides which campaign pages list the lead, never whether anything mails them. Enrolling the lead in a sequence that is in a campaign files it there too. |
| **Address** | Street, city, state, postal code and a two-letter country code. |
| **Status**, **Owner**, **Notes** | The working state — see [The Leads list](#the-leads-list). |

Every one of them is editable on the [lead's page](#a-leads-page), comes in through
[Import CSV](#import-from-csv), and is handed to the contact when the lead converts.

Beside them, your organization can define its own lead properties — a budget, a
territory, a renewal date — on the **Leads** tab of
[**CRM → Fields**](./custom-fields.md). They show on every lead's page and in the **New
lead** drawer, and as optional columns on the list. They are **not** filled by the leads
CSV import, and they stay on the lead when it converts: a lead field and a contact field
are two fields even when they share a key.

### Adding a lead by hand

**New lead**, at the top of the Leads list, opens a drawer over the list — the list stays
exactly where it was. Type what you know: the email is the one required field, and the
company, title, phone, website, lead source, status, owner, tags, address and notes are
optional. Any [custom lead fields](./custom-fields.md) your organization has defined are
offered here too, and a required one has to be filled. At the organization level the
drawer first asks which site to file the lead under, since a lead is private to one
site.

It creates a lead and nothing else. No contact and no company are made — that is what
converting does, once the lead is real. If the site already holds a lead for the address,
what you typed is written onto it and the page says so. Adding a lead is never marketing
consent, so none is recorded.

## The Leads list

The list shows the most recently seen leads first — a person who booked
yesterday sits above one who signed up last month, whichever came first.
Each row carries:

| Column | What it shows |
| --- | --- |
| **Lead** | The name the person gave, with their email beneath it — or the email alone. |
| **Company**, **Title** | The lead's own company and job title, as text. |
| **Status** | New, Working, Qualified or Unqualified. Change it in place from the row. |
| **Email** | The last verdict on the lead's address — see [Email state](#email-state) — or a dash when nothing is known. |
| **Owner** | The team member working the lead, or *Unassigned*. A lead inherits its [contact's owner](#who-owns-a-lead) when one is assigned on capture. |
| **Source** | Every surface that captured this person: Booking, the form they submitted, an import, New lead, or the API — and Sign-up on leads filed before sign-ups stopped making leads. |
| **Lead source** | The lead's [lead source](./custom-fields.md#lead-source-values). Sorting by it follows the order of your list, not the alphabet. |
| **Tags** | The lead's tags. |
| **Campaign** | The campaigns the lead is filed under, by name. Under a site only — a campaign belongs to one site. |
| **Last seen** | When the person last did something on your site. |

The table's own toolbar filters the list: **Filters** opens the filter
panel, and **Search** finds a lead by name, email, company, title or tag.
**Status**, **Email**, **Owner**, **Lead source** and **Campaign** are
picked from a list in the panel, and from each column's menu. **Status**
starts on **Open (new or working)**, every lead that still needs working;
pick one status instead, or remove the filter to see every lead. A lead
nobody has touched yet has no status of its own and reads as **New**, so the
leads your site collected before the CRM existed are already in the Open
view. **Email** narrows by the address's verdict — **Cannot be emailed** for
every lead a sender has refused, one verdict on its own, or **Nothing
known**. **Campaign** narrows to the leads filed under one of the campaigns,
by name, and **Lead source** to one of your lead source values — inactive
ones included, marked — or to **No lead source**.

The panel edits one filter at a time, and filters on different columns add
up: filter **Lead source**, then **Status**, and the list keeps both. Every
filter in force shows as a chip beside the views control; the chip's ✕
removes it. The filters are part of the saved view, and a view saved before
the panel existed filters exactly as it did. See
[Filter and search a list](../../getting-started/console-tour.md#filter-and-search) for the toolbar every console list shares.

The list reads the 200 most recently seen leads and shows them a page at a
time, with the usual footer to turn the page and pick how many rows it holds.
When a site holds more than 200, a notice says so; the filters and the
search narrow those 200, and older leads are still listed in the Inbox and still reached by
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
status**, **Unqualify** (one reason for all of them), **Add to campaign**
(under a site) and **Export CSV** for the selection. What each does, and which leads it skips by name, is in
[Bulk actions → Leads](./bulk-actions.md#leads). The selection clears when
the filters or the search change.

### Export CSV

**Export CSV** at the top of the card downloads the listed leads — every row
the filters and the search admit, not only the page on screen — as `leads.csv`:
email, name, company, job title, phone, website, status, the owner by email
address, the lead source, the sources by name, first and last seen, the
number of captures, the address in six columns, tags, the unqualified reason,
when the lead converted, and notes. At the organization level the file also
names each lead's **Site**.

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
| **Company name**, **Job title**, **Phone**, **Website** | The lead's own profile, as text. A phone is read with its country code (a bare ten-digit number as North American); a website as `acme.com` or a full address. A phone or website that cannot be read is dropped and reported, and the rest of the row is kept. |
| **Lead source** | One of your organization's active [lead source values](./custom-fields.md#lead-source-values), in any capitalization. A row naming any other value is skipped whole as *Names a lead source that isn't one of this organization's active values*, and the drawer lists those values before you import. A lead the site already holds keeps a value the list has since deactivated. A new lead with the cell blank starts from the list's default. |
| **Address line 1** … **Country (two-letter code)** | The address, six columns as the contacts import takes them. A country typed as a name rather than a code is dropped and reported. |
| **Tags** | Comma or `\|` separated, lower-cased. |
| **Campaigns** | Comma or `\|` separated, by **name**, matched to the site's own campaigns without regard to case and added to the campaigns the lead is already in. A row naming a campaign the site does not have is skipped whole as *Names a campaign this site does not have*, rather than filed under half of them. A column headed `Campaign` alone is read as the **Lead source**, which is what another tool's export means by it. |
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

A lead starts unassigned unless somebody assigns it — from the row, the
lead's page, the import file, or the **New lead** drawer. When a lead is
converted, the contact takes the lead's owner unless you pick another. An
automation that [reassigns the contact](./automations.md#assigning-an-owner-or-rotating-one)
moves a converted lead's owner with it.

Assigning an owner from the row menu or the lead's page changes the lead
alone; the contact, when there is one, is assigned from its own record.

## A lead's page

Click a row to open the lead. The page has three cards.

**Lead** holds what the team decides: the status, the owner, the lead's
**profile** — company, job title, phone, website, lead source, tags and
address, with any [custom lead fields](./custom-fields.md) under it, all edited
together under one **Save** — and free-text **notes** with a
**Save notes** button. It also shows the identity the capture recorded —
email and name — and the person's **marketing consent**: whether they opted
in (and when), declined, or never recorded a choice. Once the lead converts,
the profile is read-only here: the contact is the record then. A lead with no recorded
consent cannot be sent marketing email, which is worth knowing before you
promise them a newsletter. The card's header carries **Call** and **Log a
call** beside **Send email** — see
[click to call](./activities.md#click-to-call). Beside the status, the
header names every campaign the lead is filed under.

**Campaigns** is the filing: **Filed under campaigns** offers the site's
campaigns by name, and **Save filing** writes the pick. It is your own
grouping — it never adds anyone to a send, because a campaign mails its
lists — and it is the same picker the contact's Relationship card carries,
so a lead and the contact it becomes are filed the same way.

**Captured history** is read-only: when the person was first and last seen,
how many times your site captured them, every source that did, and — under
*Where this lead came from* — the campaign the capture is credited to, when
there is one. That is attribution, which campaign's link brought the person;
the filing above is separate, and the card says so.

### Email state {#email-state}

Beside the status, a lead carries the last verdict on its address, when a
sender has given one: **Bounced** (the mailbox does not exist), **Blocked by
their mail gateway** (the company's mail filter refused the sender), **Unsubscribed**,
**Marked as spam**, or **Do not contact** (on your organization's
[do-not-contact list](./sequences.md#do-not-contact-domains), by a member's
mark or a reply asking to be left alone). Hover the chip for the date and
what the server said. The verdict is written by the senders themselves — a
sequence's bounce, a campaign's unsubscribe, a member's do-not-contact mark —
never by a form, an import or the lead's editor, so a bounce cannot be
edited away; it is lifted when the address is released. While the state
forbids email, **Send email** is disabled with the reason, and the sequence
enroll step refuses the lead in the same words. A bounce does not change
the lead's status — you may still call — but the chip is the first thing
the page shows.

The email a sequence sent is on the lead's timeline as **Sent**; when it
bounces, the same entry reads **Bounced** with the server's words on hover,
so the record reads Sent, then Bounced.

## Converting a lead

When a lead is real, click **Convert** on the lead's page, or choose
**Convert…** from its row's menu on the list — the same dialog either way,
from the list in one click. The dialog asks three things:

1. **Contact.** The lead becomes a contact at the **Sales qualified**
   lifecycle stage, carrying the lead's phone, job title, address, tags,
   campaigns, notes and company name, owned by whoever you pick — the lead's owner by default.
   Pick nobody and the workspace's [assignment rules](./settings.md#assignment-rules)
   and the site's [default owner](./settings.md#default-owner) decide, and
   failing those the contact is yours. A colleague you pick is notified;
   you are not told about a contact you kept. If this email address is
   already a contact, the conversion joins that contact rather than creating
   a second one — the address book stays one row per person — and a contact
   that already has an owner keeps them. [Custom lead fields](./custom-fields.md)
   are **not** carried: a lead field and a contact field are two fields even
   when they share a key, so their values stay on the lead, which you can
   still open.
2. **Company.** *No company*, *Link an existing company*, or *Create a
   company*. The dialog proposes from the lead's own **Company** text first:
   a company your workspace already files under that name is preselected,
   whatever its domain; otherwise one at the address's domain; otherwise a
   new company named as the lead names it, with the domain filled in when
   the address has one. A lead with no company text at a public mailbox
   such as Gmail proposes nothing.
3. **Deal.** Tick **Open a deal** to open one in your default pipeline with a
   title, an amount, a currency and a starting stage. A workspace with no
   pipeline yet gets a **Sales** pipeline with the default stages created
   along with the deal.

Converting marks the lead **Qualified**, records what it became, and takes
you to the new contact's page. What was filed on the lead follows it: the
calls, emails, notes and tasks logged on the lead appear on the contact's
timeline and task list too, and a [sequence](./sequences.md) the lead was
enrolled in carries on with the contact. Back on the lead, the card links
to the contact, the company and the deal. A converted lead cannot be
converted again — opening the dialog on one simply takes you to its
contact.

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

Leads are part of the **CRM**, included from **Starter**. On Free the Leads section is
shown locked, with the rest of the CRM.

## Related

- [CRM overview](./overview.md)
- [CRM settings](./settings.md) — the default owner and assignment rules a lead inherits
- [Reports](./reports.md#lead-funnel) — the lead funnel: where a period's leads stand, and why the unqualified ones were closed
- [The contact record](./contact-record.md) — what a converted lead becomes
- [Companies](./companies.md) and the [deals pipeline](./deals.md) — the other two records a conversion can open
- [Forms & lead capture](../forms/overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [REST API — leads](/api/resources/leads) — the same queue and the same conversion, for an integration
