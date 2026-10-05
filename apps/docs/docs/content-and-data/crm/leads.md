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
Open **CRM → Leads** in the console, or open one lead from the Inbox: its
**Site Members & Leads** section shows members or leads, one at a time, by
the **Members | Leads** toggle above the table. Choose **Leads**, and a
row's menu (⋮) has **Open in CRM**. Each side is its own list with its own
filters and search, so a person who left their address and later signed up
appears under both. On the organization's Inbox the section is **Leads**
alone, every site's. See
[Filter the Inbox tables](../forms/overview.md#filter-the-inbox).

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
- [Import](#import-from-csv), [New lead](#adding-a-lead-by-hand), and
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
| **Salutation**, **First name**, **Last name** | How to address the person, and their name in parts. The salutation is one of your organization's [Salutation values](./custom-fields.md#picklist-values) — the list contacts use. While a first or last name is set, **Name** is the two together ("Ann Lee") and follows them; a lead that only has a name keeps it as it was captured, and is never split. |
| **Name** | The person's name — what the list shows and searches. |
| **Company** | The company's name, typed. Not a link — a thousand imported leads must not create a thousand companies. [Converting](#converting-a-lead) is what links or creates the company record, by this name or by the address's domain. |
| **Job title**, **Phone**, **Mobile phone**, **Fax**, **Website** | As on a business card. Phone numbers are stored with their country code; the website as a full address. |
| **Do not call** | The person asked not to be phoned. It shows as a warning on every number and on **Call**, and never blocks the call — the same as on a contact. |
| **Industry**, **Rating** | Picked from your organization's Industry (Salesforce's standard industries) and Rating (Hot, Warm, Cold) values — the same lists [companies](./companies.md) use, kept under **CRM › Fields › Companies** — so a lead converts into the same value. |
| **Employees**, **Annual revenue** | The company's size, as the lead tells it. Revenue is typed in a currency's major units, like `1250000.00`, and kept with its currency. |
| **Lead source** | Where the lead came from, picked from your organization's own [lead source values](./custom-fields.md#picklist-values) — Salesforce's standard set, Aglyn's own doors and outreach, and any you add — listed under **Inbound**, **Outbound** and values in no group. A new lead starts from the list's default when it has one, and a lead your site captures is given its door's value — see [Lead source, filled in for you](#lead-source-filled-in). Distinct from **Sources** below, which the site records. |
| **Tags** | Comma-separated, lower-cased. |
| **Campaigns** | The site's [campaigns](../../marketing-and-automation/email-campaigns/overview.md#what-belongs-to-a-campaign) the lead is filed under, picked by name. Grouping, not consent: it decides which campaign pages list the lead, never whether anything mails them. Enrolling the lead in a sequence that is in a campaign files it there too. |
| **Address** | Street, city, state, postal code and a two-letter country code. |
| **Status**, **Owner**, **Notes** | The working state — see [The Leads list](#the-leads-list). |

### Lead source, filled in for you {#lead-source-filled-in}

Aglyn's own doors and outreach each have a built-in lead source, and fill it in on a
person they meet first:

| Where the person came from | Lead source |
| --- | --- |
| A form on your site | **Website form** |
| A booking | **Booking** |
| A newsletter sign-up | **Newsletter sign-up** |
| A site member sign-up | **Site member sign-up** |
| An online purchase | **Online purchase** |
| A sign-up for an account on Aglyn itself (Aglyn's own workspace) | **Account sign-up** |
| Enrolled in a [sequence](./sequences.md) | **Sequence** |
| An email campaign | **Email campaign** — offered for you to pick; no campaign creates leads by itself today |

The value lands on the lead, and on your site's own record of a contact, only when it has
no lead source yet: whatever a person already has is never replaced, and a lead source
someone cleared stays clear when the person comes back. Rename a built-in value and the
doors fill in your name for it; deactivate one and that door fills in nothing. A lead
added by hand, over the API or from a CSV is not filled in — those are ways of adding a
lead, not places it came from. Vendors Aglyn does not run, like a data provider or a
sending tool, are values you add yourself.

Every one of them is editable on the [lead's page](#a-leads-page), comes in through
[Import](#import-from-csv), and is handed to the contact when the lead converts.

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
It keeps that order: the column headers do not re-sort it. Each row
carries:

| Column | What it shows |
| --- | --- |
| **Lead** | The name the person gave, with their email beneath it — or the email alone. |
| **Company**, **Title** | The lead's own company and job title, as text. |
| **Status** | New, Nurturing, Working, Qualified or Unqualified — see [Lead statuses](#lead-statuses). Change it in place from the row. |
| **Email** | The last verdict on the lead's address — see [Email state](#email-state) — or a dash when nothing is known. |
| **Owner** | The team member working the lead, or *Unassigned*. A lead inherits its [contact's owner](#who-owns-a-lead) when one is assigned on capture. |
| **Source** | Every surface that captured this person: Booking, the form they submitted, an import, New lead, or the API — and Sign-up on leads filed before sign-ups stopped making leads. |
| **Lead source** | The lead's [lead source](./custom-fields.md#picklist-values). |
| **Industry**, **Rating** | Off until you turn them on from the column menu. |
| **Tags** | The lead's tags. |
| **Campaign** | The campaigns the lead is filed under, by name. Under a site only — a campaign belongs to one site. |
| **Last seen** | When the person last did something on your site. |

### Lead statuses {#lead-statuses}

A lead moves through its statuses in the order a person works one:

| Status | What it means |
| --- | --- |
| **New** | Nobody and nothing has touched the lead yet. A lead your site captured carries no status of its own and reads as New. |
| **Nurturing** | Automated email is reaching the lead — a [sequence](./sequences.md) sent it a step, or a campaign email was delivered to it — and nobody has engaged yet. |
| **Working** | A person is in a conversation with the lead: it replied to a sequence, or a teammate set it to Working. |
| **Qualified** | The lead was [converted](#converting-a-lead) into a contact. |
| **Unqualified** | The lead was closed without converting, with a reason. |

New, Nurturing and Working are the **open** statuses — the leads that still
need somebody. The moves into Nurturing and on to Working happen by
themselves: the first sequence email or campaign email that is actually
sent to a New lead moves it to Nurturing, and a reply to a sequence moves a
New or Nurturing lead to Working. Neither ever moves a lead back: a lead
already Working, Qualified or Unqualified keeps its status, and a converted
lead is never touched. You can still set any open status by hand.

**Your own statuses.** Lead status is a [picklist](./custom-fields.md#picklist-values)
like Salesforce's: the five above are its standard values, and on the **Leads** tab of
**CRM → Fields**, under **Lead status values**, you can rename them, reorder them,
deactivate one, and add your own — "Contacted", "Meeting set", "Lost to competitor".
Every value you add **means** one of the five, picked when you add it in the **Means**
column; it cannot mean Qualified, which only a conversion sets. The meaning is what the
list filters by, what the open count and the digest count, and what sequences and sharing
rules read; your label is what the lead shows. A lead set to "Contacted" is a Working lead
labeled Contacted. A lead given only a meaning — by a capture, a sequence or an
automation — shows the default value when it has that meaning, else the first active value
of that meaning. Deleting a value you added moves its leads to another value of the same
meaning. The status select on a lead, the row's select, **Set status** on the bulk bar and
the **New lead** drawer list your active values; picking an Unqualified one opens the
dialog that asks why. The **Status** filter still picks a meaning, named by your values of it.

The [Daily CRM digest](./tasks.md#the-daily-digest) lists only New leads as
unworked, and counts the Nurturing ones on a line of their own ("12 leads
are in sequences or campaigns"), because email is already reaching them.

### Filter and search the leads {#filter-the-leads}

The table's own toolbar filters the list: **Filters** opens the filter
panel, and **Search** finds a lead by a word of its name, its email address —
and each part of the address, so the domain alone finds it — its company,
its title or its tags.
**Status**, **Email**, **Owner**, **Lead source**, **Lead source direction**,
**Industry**, **Rating** and **Campaign** are picked from a list in the panel, and from each column's menu. **Status**
starts on **Open (new, nurturing or working)**, every lead that still needs working;
pick one status instead, or remove the filter to see every lead. A lead
nobody has touched yet has no status of its own and reads as **New**, so the
leads your site collected before the CRM existed are already in the Open
view. **Email** narrows by the address's verdict — **Cannot be emailed** for
every verdict but OK, one verdict on its own, or **Nothing known**. **Campaign** narrows to the leads filed under one of the campaigns,
by name, and **Lead source** to one of your lead source values — inactive
ones included, marked — or to **No lead source**. **Lead source direction**
keeps the leads whose lead source is in the **Inbound** or the **Outbound**
group, as the [lead source values](./custom-fields.md#picklist-values) group
them when you filter: move a value to another group and its leads move with
it. **Industry** and **Rating** keep the leads holding one of your values — inactive
ones included, marked. **Owner** keeps one teammate's leads. **Status**, **Email**, **Owner**,
**Lead source** and **Lead source direction** each take one choice (**is**) or
several (**is any of**); **Campaign** takes one.

The panel edits one filter at a time, and filters on different columns add
up: filter **Lead source**, then **Status**, and the list keeps both. Every
filter in force shows as a chip beside the views control; the chip's ✕
removes it. The filters are part of the saved view, and a view saved before
the panel existed filters exactly as it did. See
[Filter and search a list](../../getting-started/console-tour.md#filter-and-search) for the toolbar every console list shares.

Every filter and the search are answered by the list's query, so they reach
every lead the site holds, not only the page on screen. The list shows them a
page at a time, newest seen first, with the usual footer to pick how many
rows a page holds and to turn to the next page while there are more.

The search matches whole words from their start: "cof" finds *Coffee*, but a
fragment from the middle of a word does not. It looks for one word at a time
— type several and it searches the first, and says so — and reads the first
12 letters of a long word.

A few combinations cannot be answered by one query. **Campaign** and the
search cannot be combined: while the search box holds a word, the Campaign
filter is not applied, and a notice above the table names it and says why. Under a site, a member
whose access is limited to particular sites searches by the start of a lead's
email address, and a notice says so; the Campaign filter is not applied for
them. **No lead source** cannot be picked beside a lead source value, and a
filter whose choices, multiplied by the other filters' choices, come to more
than 30 is not applied either (**Cannot be emailed** counts as every verdict
it covers, and a **Lead source direction** as every lead source value in its
group); the notice names both.

### Working a lead from the row

- **Status** — click the status chip to change it to New, Nurturing or Working.
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
(under a site) and **Export…** for the selection. What each does, and which leads it skips by name, is in
[Bulk actions → Leads](./bulk-actions.md#leads). The selection clears when
the filters or the search change.

### Import and export {#import-from-csv}

**Export…** at the top of the card opens the [export dialog](./export.md) on
the list's current filter or every lead, and the bulk bar's on the
selection: every lead field, your lead [custom fields](./custom-fields.md)
included — the status as your organization labels it, the owner by email,
the campaigns by name, the address in six columns, and what the capture
doors recorded (the sources, first and last seen, the number of captures,
when the lead converted).

**Import** takes a file of leads — a Salesforce leads report, a HubSpot,
Apollo or Pipedrive export, a list from an event — through the
[import wizard](./import.md) and files each row under one of your sites. A
lead is the person at an address, so a row finds its lead by **Aglyn ID** or
**email**, and a person the site has already met is **updated** rather than
added twice. Every new lead comes in through the door a sign-up or a form
uses: keyed by address, held to the site's lead ceiling, filed under the site.
Importing needs the same **Manage data** permission as importing contacts.

| Field | What is read |
| --- | --- |
| **Email** | Required, and the identity; a matched lead's address never changes. |
| **Salutation**, **First name**, **Last name**, **Full name** | While a first or last name is set, the lead's name is the two together. |
| **Company**, **Job title**, **Phone**, **Mobile phone**, **Fax**, **Website** | The lead's own profile, as text; converting the lead links or creates the company. A phone that cannot be read, or a website that is not one, fails the row with why. |
| **Do not call** | A file can turn it on, never off. |
| **Industry**, **Rating**, **Lead source**, **Salutation** | Your organization's values, by label; a new lead with none starts from each list's default. |
| **Employees**, **Annual revenue** | A whole number; an amount with its currency. |
| **Address** street … country | Six columns; country as a two-letter code. |
| **Status** | Any of your statuses but **Qualified**: a lead becomes Qualified by [converting](#converting-a-lead) it. A file's Qualified is held back, named on the Review step. |
| **Owner** | A member of your workspace, by email or name. |
| **Campaigns** | Your campaigns by name, added to the ones the lead is already filed under. A name your workspace has no campaign for is yours to map, leave out or refuse on the Values step. |
| **Tags** | Added to the lead's own. |
| **Unqualified reason** | Kept only on a lead that is Unqualified. |
| **Notes** | Text. |
| **Custom fields** | Every lead field you defined under [Fields](./custom-fields.md). |

**No marketing consent is recorded by an import.** A capture writes a
consent basis only when the visitor ticked a box in front of them, and a
file is not that box. An imported lead can be included in a campaign
audience only if the site already holds a consent for that person — see
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

Click a row to open the lead.

**Lead** holds what the team decides: the status and the owner. It also shows
the identity the capture recorded — email and name — and the person's
**marketing consent**: whether they opted in (and when), declined, or never
recorded a choice. A lead with no recorded consent cannot be sent marketing
email, which is worth knowing before you promise them a newsletter. The card's
header carries **Convert**, **Call** and **Log a call** beside **Send email** — see
[click to call](./activities.md#click-to-call) — and, once the lead converts,
**Open contact**, **Open company** and **Open deal** in place of **Convert**.
Beside the status, the header names every campaign the lead is filed under.

**Details** is the lead's **profile**, laid out as Salesforce lays out a lead:
the salutation and the name's parts, then **Lead information** — company, job
title, industry, rating, lead source, tags, employees and annual revenue —
then **Contact information** — phone, mobile phone, fax, website and **Do
not call** — then the address, with any [custom lead fields](./custom-fields.md)
under **More fields**, and free-text **notes**, all saved together by the one
**Save** in the card's header. Once the lead converts, the profile is read-only
here, because the contact is the record then; the notes can still be written.

**Campaigns** is the filing: **Filed under campaigns** offers the site's
campaigns by name, and **Save filing** in the card's header writes the pick. It is your own
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
sender has given one: **Would bounce** (the address's domain has no mail
server), **Bounced** (the mailbox does not exist), **Blocked by
their mail gateway** (the company's mail filter refused the sender), **Unsubscribed**,
**Marked as spam**, or **Do not contact** (on your organization's
[do-not-contact list](./sequences.md#do-not-contact-domains), by a member's
mark or a reply asking to be left alone). Hover the chip for the date and
what the server said. The verdict is written by the senders themselves — a
sequence's bounce, a campaign's unsubscribe, a member's do-not-contact mark —
never by a form, an import or the lead's editor, so a bounce cannot be
edited away; it is lifted when the address is released.

**Would bounce** is the platform's own check rather than a sender's verdict.
Whenever a lead or a contact is captured — a form, an import, **New lead**,
the API, an add to a list — Aglyn looks up the address's domain once the
record is saved, and a domain that publishes no mail server (or a null MX
record, which says it accepts no email) marks the record **Would bounce**.
It never slows the capture, and it is the weakest verdict: a real bounce or
block replaces it, and it is taken back on its own if the domain starts
taking mail. **Email › Would bounce** in the list filter finds these records.

Beside the verdict, the page shows which mail gateway stands in front of the
address when its domain names one — Barracuda, Proofpoint, Mimecast, Google
Workspace, Microsoft 365 — and, once your site has sent there, how many of
this week's messages it delivered or refused. While the state
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
   lifecycle stage, carrying the lead's salutation, first and last name,
   phone, mobile phone, fax, **Do not call**, job title, address, tags,
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
   such as Gmail proposes nothing. A company the conversion **creates** takes
   the lead's industry, rating, employees, annual revenue and currency,
   website, phone, fax, its address as the billing address, and its lead
   source as the [Account source](./companies.md); a company it **links**
   takes them only into the fields it leaves empty, never over what it holds.
3. **Deal.** Tick **Open a deal** to open one in your default pipeline with a
   title, an amount, a currency, a starting stage and a
   [type](./deals.md#type-and-lead-source) — your list's default until you
   pick another. The deal carries the lead's **lead source**, as Salesforce's
   conversion does, and its **campaign** — the campaign the lead was most
   recently filed under — and takes its stage's forecast category. A workspace with
   no pipeline yet gets a **Sales** pipeline with the
   [default stages](./deals.md#pipelines) created along with the deal.

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
