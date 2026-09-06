---
sidebar_position: 13
title: CRM settings
description: The switches that decide what the CRM does on its own for every site in your workspace — starting with whether a company is created from a captured contact's work email domain.
---

# CRM settings

**CRM → Settings** holds what the CRM does on its own, for every site in
your workspace. A setting here is a fact about how your business files
people, not about one site, so it is stored on the workspace and applies
wherever a contact is captured. The section lives in the CRM hub at
`…/hosts/{site}/crm/settings`, last in the rail.

Only a workspace **owner or admin** can change a setting. Everyone who can
open the CRM can read the page; a member who cannot change a switch sees it
disabled, with a note saying why.

## Companies

### Create companies from work email domains

Off by default.

A contact captured with a work email address — a form submitted from
`jane@acme.com`, a booking, an order, a sign-up — is linked to the company
whose **domain** is `acme.com` the moment the contact is created, provided
exactly one such company is visible to the capturing site. That happens
whether this switch is on or off; see
[Companies — Linked on capture](./companies.md#linked-on-capture).

The switch decides what happens when **no** company carries the domain:

- **Off** — nothing is created. The contact waits for somebody to pick or
  create the company from their [record](./contact-record.md), or for the
  company to be created from the Companies list, after which the next
  capture at that domain links on its own.
- **On** — a company is created from the domain, named after it
  (`acme.com` becomes **Acme**, `initech.co.uk` becomes **Initech**), with
  the domain filled in and the new contact already linked. It is created in
  the same scope the contact landed in — the sites that present as one
  sender, or the whole workspace when the workspace shares its data — so a
  site never sees a company it could not see the contact for. Rename the
  company, add its owner and address, from its own page.

Addresses at a **public mailbox** — Gmail, Outlook, iCloud, Yahoo, Proton
and the like — never create a company and never link to one, on or off. A
consumer list is not a list of accounts, and a company called "Gmail" with
half your contacts at it is the one thing this setting must never produce.

A contact the CRM already knows — a repeat form submission by somebody in
the address book — is not linked again. A contact added [by hand](./contact-record.md#adding-a-contact-by-hand)
with a company picked, or [imported](./import.md) with a company column, keeps
the company you chose; the domain is not consulted.

## Related

- [CRM overview](./overview.md)
- [Companies](./companies.md) — the records these settings create and link
- [The contact record](./contact-record.md) — picking a company by hand
- [Automations for the CRM](./automations.md) — acting on a contact after it is created
