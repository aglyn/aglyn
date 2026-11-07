---
sidebar_position: 16
title: Share records across sites
description: Let another of your sites see a lead, a contact, a company or a deal — one record by hand, a selection from a list, or every record a sharing rule matches, now and later — without sharing the person's consent.
---

# Share records across sites

A record in your CRM belongs to the whole workspace: every site sees the
contacts, companies, deals and tasks, whichever site they came in on. The site
a record came from is kept as its **source**, so you can still tell which
brand met the person.

## Default sharing for new records {#default-sharing-for-new-records}

A member holding [**Change CRM settings**](../../workspace-and-billing/teams-and-roles/custom-roles.md#crm-settings-permission)
(owners and admins by default) chooses, in the CRM's **Settings**, what new
contacts, leads, companies, deals, tasks and logged activities are shared
with, and saves it:

- **All sites in the organization**, as above.
- **Only the site they came in on**: what an agency that keeps each client's
  records apart chooses. Each site then sees the people it captured, a site in
  a [consent group](./overview.md) also sees the records of the group's other
  sites, and every other record is hidden from it, so one client's
  collaborator never sees another client's people.
- **All sites except…**: every site but the ones you tick to leave out,
  including sites you add later. The site a person came in on always keeps
  them, even if you left it out. Leave out at least one site and keep at
  least one in. A workspace with one site has nothing to leave out, and the
  choice works up to 30 sites; past either, it is switched off, with the
  reason.

The setting covers records created from then on, and changes nothing that
already exists. It is separate from the defaults for new datasets and media
files, which are set on the organization **Data** and **Media** pages.

### Apply to existing records {#apply-to-existing-records}

Under **All sites except…**, the records you already have can be shared the
same way. Choose **Apply to existing records…** below the setting, after
saving it, and confirm. Every contact, lead, company, deal, task and logged
activity in the workspace is then shared with every site except the ones you
left out:

- the site that captured a person keeps them, whatever you left out;
- sites left out stop seeing the rest;
- records shared by hand or by a sharing rule keep those shares on top.

Nothing changes on existing records until you apply it, and it changes them
only once: to apply a later change of the setting, apply it again. The card
shows how many records were checked and changed. Keep the page open until it
says it is applied; if it stops, it carries on by itself within a few
minutes, or choose **Resume**. A record that would reach more than 30 sites
is left as it was, and the count says how many.

## Share a record with more sites

The rest of this page is for a workspace whose records don't all reach every
site.

When you run several brands and want one brand's team to work records
another brand captured, a member holding **Change CRM settings** can share them. You
can share a **lead**, a **contact**, a **company** or a **deal**:

- **By hand**: one record from its page, or a selection from the Leads or
  Contacts list.
- **By a sharing rule**: every record the rule matches, including the ones
  you already have and every one captured or changed later.

You can share with **All sites**, with **Selected sites**, or with **All sites
except…** the ones you leave out. All sites, and all sites except some, include
sites you add to the workspace later; selected sites don't.

### All sites except some {#all-sites-except-some}

Tick the sites to leave out, and every other site sees the record. A site you
add later sees it too, once the workspace has finished adding the site. Leave
out at least one site and keep at least one in; a workspace with one site has
nothing to leave out, so the choice is switched off there, with the reason.
It reaches up to 30 sites, so a workspace with more than 30 sites shares
with selected sites instead.

Leaving out the site that captured the person changes nothing for that site:
it holds the record, and sharing never takes that away.

Sharing only adds sites to a record. A record every site already sees, which
is every record in a workspace that hasn't chosen **Only the site they came in
on**, looks the same after sharing with all sites except some.

## What a shared record looks like

On the site you shared it with, the record appears on the site's own CRM
lists with a **Shared by** chip. The chip names the person who shared it,
or the rule that did.

### The Sharing card {#sharing-card}

The **Sharing** card on a lead's, contact's, company's or deal's page lists
every site that can see the record and why; a member holding **Change CRM settings**
shares it with more sites from **Share with sites…** in the card's header. For
anyone else that button is switched off, with the permission named:

- **Held by**: the sites that captured the record. Their visibility comes
  from the record itself, and sharing never removes it.
- **Shared by hand**: the site, or all sites except the ones left out, who
  shared it and when. A member holding **Change CRM settings** can stop
  sharing it in one click.
- **Shared by a rule**: the rule's name. To stop it, edit or delete the rule
  in [Settings](#sharing-rules).

Unsharing removes only the visibility that the share added. If the site
also holds the record (it captured the person itself), it keeps seeing it.

## Share a record by hand

1. Open the lead, contact, company or deal.
2. In the **Sharing** card, choose **Share with sites…**.
3. Choose **All sites**, **Selected sites** and tick them, or **All sites
   except…** and tick the sites to leave out.
4. Choose the [access](#access-read-only-or-read-and-edit), then **Share**.

The record's **Activity** gets an entry that says who shared it and with
which sites, and the workspace activity log records it too.

### Several records at once

Select rows on the **Leads** or **Contacts** list and choose **Share with
sites…** on the bar that appears. Up to 200 records are shared in one go.

## Sharing rules

**CRM → Settings → Sharing rules**, at the
[organization level](./overview.md#at-the-organization-level), lists your
rules. Each rule has three parts:

| part | what you choose |
| -- | -- |
| **Which records** | Leads, contacts, companies or deals. You can limit it to records captured on certain sites, and add optional conditions: lead source, lead source direction (Inbound or Outbound), tags, campaign, status or lifecycle stage, and owner. |
| **Shared with** | All sites, selected sites, or all sites except the ones you leave out. All sites, and all sites except some, include sites added later. |
| **Access** | Read-only, or read and edit. |

Conditions are combined with AND. Several values in one condition are
combined with OR. A contact matches if any site that holds it recorded the
value. A lead source direction is read through your
[lead source values](./custom-fields.md#picklist-values)' groups each time a
record is checked, so moving a value to another group changes which records
the rule matches from then on — a record already shared keeps its share until
it is next saved or the rule is saved again.

When you save a rule, it is applied to the records you already have. The
**Status** column shows the progress. Keep the page open until it says how
many records changed. If the run stops, choose **Resume** from the rule's
menu to continue where it stopped. From then on, every record captured or
changed is checked against your rules as it is saved.

Switching a rule **off** keeps it and removes the visibility it granted.
**Deleting** a rule removes only the visibility it granted. Records shared
by hand, or by another rule, stay shared.

A workspace can have up to 20 sharing rules.

## Access: read-only or read and edit

**Read-only** is the default. A site with read-only access can see the
record, open its page, and add its own tasks, notes and activity to it. It
cannot change the record itself or delete it.

**Read and edit** also lets the site's team change the record's fields.
It still cannot delete a record that another site holds.

These limits apply to members who work on some of your sites. Owners,
admins and members with access to every site can already see and change
every record, as before.

## Sharing is not consent

Sharing gives a site visibility of a record. It does not share the person's
marketing consent. Consent stays with the sites the person gave it to. The
[consent disclosure](./overview.md) names those brands, and sharing cannot
widen it.

A site a record was shared with:

- cannot include the person in an email **campaign**, a **list** built by a
  rule, or a **sequence**, unless the person gave that site consent;
- can still send a one-to-one email from the record, under that site's own
  sending rules and its own suppression list.

## Who can do this

Sharing, unsharing, sharing rules, the default sharing for new records and
**Apply to existing records** take the **Change CRM settings** permission,
which owners and admins hold by default. Other members see the
Sharing card and the chips, with the share buttons switched off and the
permission named.

Editing a shared record is a different permission. A member invited to one site
who holds **Manage data** can change and delete records shared with the whole
workspace, because a record shared with every site is shared with theirs too;
see [Custom roles & permissions](../../workspace-and-billing/teams-and-roles/custom-roles.md).
They can't change what a record is shared with.

Sharing is part of the **CRM**, included from **Starter**. It is only useful
with more than one site, and the number of sites is set by your plan.

## Related

- [CRM overview](./overview.md)
- [Leads](./leads.md)
- [The contact record](./contact-record.md)
- [CRM settings](./settings.md)
- [Bulk actions](./bulk-actions.md)
