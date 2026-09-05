---
sidebar_position: 7
title: Companies
description: Group your contacts under the businesses they belong to — one record per company, with its domain, owner, address and the people who work there.
---

# Companies

A **company** is the organization behind one or more of your contacts. Where a
contact is a person, a company is the account they work for: it has a domain,
an owner on your team, an address and notes of its own, and a list of the
people at it. The Companies section lives in the CRM hub at
`…/hosts/{site}/crm/companies`.

:::info Plan availability
Companies are part of the **CRM suite**, included from **Starter**; on Free the
section is shown locked. A company is a **CRM record**, counted with contacts and
deals against your plan's records band — see
[CRM records](../../workspace-and-billing/billing-and-plans/overview.md#crm-records).
:::

## The companies list

The list shows every company your site may see, newest activity first, with
its domain, its owner and when it was last changed. Open the column filter on
**Company** to find one by name — the search reaches every company, not only
the page on screen — and filter **Owner** to see one teammate's accounts.
Clicking a row opens the company's page.

## Create a company

Choose **New company** above the list. A company needs a name; everything else
is optional:

- **Domain** — the bare hostname (`acme.com`). Anything pasted with it — a
  protocol, `www.`, a path — is stripped, because the domain is a key: it is
  what suggests a company for a contact from their email address.
- **Website**, **phone**, **industry**, **address** and **notes**.
- **Owner** — the member of your team responsible for the account. It defaults
  to you.

The company is saved and its page opens.

## A company's page

The page names the company in the heading and the trail, and holds its
properties, its contacts, its [deals](./deals.md), its open [tasks](./tasks.md)
and the [activity](./activities.md) logged against it. **Edit** opens the same
form the company was created with.

## Contacts at a company

The **Contacts** card lists the people linked to this company, each opening
their own page. **Add contact** finds a person by email address or by name
among the contacts your site may see and links them. A contact belongs to one
company at a time from your site's point of view; linking them to a second
company moves them.

A [lead](./leads.md#converting-a-lead) converted with a company email address is
offered the company whose domain matches it, and a [CSV import](./import.md)
that names a company links each row to it — matching an existing company by
name, or creating one.

## Deleting a company

Deleting a company unlinks it from every contact first, so no contact is left
pointing at a record that no longer exists. Up to 500 contacts are unlinked in
one pass; a company with more than that reports how many remain, and deleting
again continues from where it stopped. The contacts themselves are untouched.

## Who can see a company

A company follows the same per-site visibility as your contacts. It is
created in the scope a contact captured on the same site would land in — the
whole workspace when the workspace shares its data, and otherwise the sites
that present as one sender — so a section of the CRM can never show a company
to a reader who could not open the contacts at it.

## Related

- [CRM overview](./overview.md)
- [The contact record](./contact-record.md) — the people a company is made of
- [Deals pipeline](./deals.md) — every deal names the company it is with
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md) — audiences built from a rule can target a contact's company
- [REST API — companies](/api/resources/companies)
