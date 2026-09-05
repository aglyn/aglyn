---
sidebar_position: 6
title: Leads
description: Work the people your site has captured — a status, an owner and notes on every lead — and convert one into a contact, a company and a deal.
---

# Leads

A **lead** is somebody your site has met but you have not yet qualified: a
visitor who signed up, booked, or submitted a form. Every capture on your site
creates one lead per person, and the **Leads** section of the CRM is where the
team works them — decides who owns each one, keeps notes, and either converts
the lead into a contact or closes it with a reason.

Leads live under the site that captured them, so each site's list is its own.
Open **CRM → Leads** in the console, or use **Open in CRM** on a lead row in
the Inbox's **Site Members & Leads** section.

## The Leads list

The list shows the most recently seen leads first — a person who booked
yesterday sits above one who signed up last month, whichever came first.
Each row carries:

| Column | What it shows |
| --- | --- |
| **Lead** | The name the person gave, with their email beneath it — or the email alone. |
| **Status** | New, Working, Qualified or Unqualified. Change it in place from the row. |
| **Owner** | The team member working the lead, or *Unassigned*. |
| **Source** | Every surface that captured this person: Sign-up, Booking, or the form they submitted. |
| **Last seen** | When the person last did something on your site. |

The **Show** control at the top of the card picks the view. **Open** — the
default — is every lead that still needs working (New and Working). The other
views are one status each, and **All** shows everything. A lead nobody has
touched yet has no status of its own and reads as **New**, so the leads your
site collected before the CRM existed are already in the Open view.

The list reads the 200 most recently seen leads. When a site holds more, a
notice says so; the status filter narrows those 200, and older leads are still
listed in the Inbox and still reached by campaign audiences.

### Working a lead from the row

- **Status** — click the status chip to change it to New or Working.
  Choosing **Unqualified…** asks for a reason first.
- **Row menu** (⋮) — **Open lead**, **Assign owner**, or **Unqualify**.
- Click anywhere else on the row to open the lead's page.

Every change here is saved immediately; there is no separate save step.

## A lead's page

Click a row to open the lead. The page has two cards.

**Lead** holds what the team decides: the status, the owner, and free-text
**notes** with a **Save notes** button. It also shows the identity the capture
recorded — email and name — and the person's **marketing consent**: whether
they opted in (and when), declined, or never recorded a choice. A lead with no
recorded consent cannot be sent marketing email, which is worth knowing
before you promise them a newsletter.

**Captured history** is read-only: when the person was first and last seen,
how many times your site captured them, every source that did, and — under
*Where this lead came from* — the campaign the capture is credited to, when
there is one.

## Converting a lead

When a lead is real, click **Convert**. The dialog asks three things:

1. **Contact.** The lead becomes a contact at the **Sales qualified**
   lifecycle stage, owned by whoever you pick (the lead's owner by default,
   or you). If this email address is already a contact, the conversion joins
   that contact rather than creating a second one — the address book stays
   one row per person.
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

## Unqualifying a lead

**Unqualify** closes a lead without converting it. A reason is required, so
the closed leads can be counted by why they closed. An unqualified lead drops
out of the Open view and keeps its reason on its page; set its status back to
Working to reopen it, which clears the reason.

## Who can do this

Anyone who can open the CRM can work leads — that is the workspace's
**data** permission, the same one that guards contacts. Converting a lead
also requires a role on the site the lead belongs to.

## Related

- [CRM overview](./overview.md)
- [The contact record](./contact-record.md) — what a converted lead becomes
- [Companies](./companies.md) and the [deals pipeline](./deals.md) — the other two records a conversion can open
- [Forms & lead capture](../forms/overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
