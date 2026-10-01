---
sidebar_position: 16
title: Share records across sites
description: Let another of your sites see a lead, a contact, a company or a deal — one record by hand, a selection from a list, or every record a sharing rule matches, now and later — without sharing the person's consent.
---

# Share records across sites

Each site in your workspace sees the people it captured. A site in a
[consent group](./overview.md) also sees the records of the group's other
sites. Every other record is hidden from it, which is what keeps one agency
client's CRM apart from another's.

When you run several brands and want one brand's team to work records
another brand captured, a workspace **owner or admin** can share them. You
can share a **lead**, a **contact**, a **company** or a **deal**:

- **By hand**: one record from its page, or a selection from the Leads or
  Contacts list.
- **By a sharing rule**: every record the rule matches, including the ones
  you already have and every one captured or changed later.

You can share with chosen sites or with **All sites**. All sites includes
sites you add to the workspace later.

## What a shared record looks like

On the site you shared it with, the record appears on the site's own CRM
lists with a **Shared by** chip. The chip names the person who shared it,
or the rule that did. The record's page has a **Sharing** card that lists
where the record is visible and why:

- **Held by**: the sites that captured the record. Their visibility comes
  from the record itself, and sharing never removes it.
- **Shared by hand**: the site, who shared it and when. An owner or admin
  can stop sharing it in one click.
- **Shared by a rule**: the rule's name. To stop it, edit or delete the rule
  in [Settings](#sharing-rules).

Unsharing removes only the visibility that the share added. If the site
also holds the record (it captured the person itself), it keeps seeing it.

## Share a record by hand

1. Open the lead, contact, company or deal.
2. In the **Sharing** card, choose **Share with sites…**.
3. Pick the sites, or **All sites, including sites added later**.
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
| **Which records** | Leads, contacts, companies or deals. You can limit it to records captured on certain sites, and add optional conditions: lead source, tags, campaign, status or lifecycle stage, and owner. |
| **Shared with** | Chosen sites, or all sites (including sites added later). |
| **Access** | Read-only, or read and edit. |

Conditions are combined with AND. Several values in one condition are
combined with OR. A contact matches if any site that holds it recorded the
value.

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

Sharing, unsharing and sharing rules are for workspace **owners and
admins**. Other members see the Sharing card and the chips, but no share
buttons.

Sharing is part of the **CRM**, included from **Starter**. It is only useful
with more than one site, and the number of sites is set by your plan.

## Related

- [CRM overview](./overview.md)
- [Leads](./leads.md)
- [The contact record](./contact-record.md)
- [CRM settings](./settings.md)
- [Bulk actions](./bulk-actions.md)
