---
sidebar_position: 13
title: CRM settings
description: What the CRM does on its own for every site — whether a company is created from a contact's work email domain, who a new contact is assigned to by default, by rule, or in turn, and the recipes installed on each site.
---

# CRM settings

**CRM → Settings** holds what the CRM does on its own, for every site in
your workspace. A setting here is a fact about how your business files
people, not about one site, so it is stored on the workspace and applies
wherever a contact is captured. The section lives in the CRM hub at
`…/hosts/{site}/crm/settings`, last in the rail, and at the
[organization level](./overview.md#at-the-organization-level) at
`…/{organization}/crm/settings`, where it also holds the
[Recipes](#recipes) card.

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

## Default owner

Who gets the contacts captured on **this site** when no
[assignment rule](#assignment-rules) claims them. Pick a member of the
workspace, or **Nobody — leave unassigned**, which is the default and is
what the CRM did before the setting existed.

The default is per site — an agency workspace gives each client's site its
own rep — but it is stored on the workspace with the other CRM settings and
changed from any site's Settings section for that site.

A contact captured on the site — a form submission, a sign-up, a booking,
an order, a newsletter capture — that no rule claims is handed to the
default owner the moment the contact is created, and they get a console
notification (**Contact assigned to you**, or **Lead assigned to you** when
the site filed a lead for the same person, linking to the record they will
work). Only a **new** contact is assigned: a repeat visit by somebody the
workspace already holds changes nothing, and a contact
[added by hand](./contact-record.md#adding-a-contact-by-hand),
[imported](./import.md) with an owner column, or
[converted from a lead](./leads.md#converting-a-lead) with an owner picked
keeps the owner you chose.

A default owner who later leaves the workspace is shown as a former member
and assigns nobody until you pick somebody else.

## Assignment rules

An ordered list of rules tried, top to bottom, for every new contact captured
on **any** site in the workspace. The first rule whose every condition holds
assigns the owner; a contact no rule claims goes to the capturing site's
[default owner](#default-owner), or stays unassigned. Rules are what a
sales team sets up first — bookings to one rep, a partner's domain to
another, everything else in turn.

**Add rule** opens a drawer with four optional conditions and a target:

| Condition | Matches when |
| --- | --- |
| **Source** | The contact came in through that door — Form, Booking, Customer (an order), Member (a sign-up), Newsletter, API, Import, or Added by hand. Any source when blank. |
| **Form** | The capture came through the form with that id (from the form's address in Forms). Any form when blank. |
| **Email domain** | The captured address is at that domain — `acme.com`, typed with or without the `@`. Unlike the company link, a public mailbox such as `gmail.com` counts here, so a rule can route consumer sign-ups to one rep. |
| **Tag** | The capture carries the tag, or the contact already has it. Case does not matter. |

A rule with every condition blank matches everything, which is how a
catch-all is written — put it last. The target is **a team member**, picked
from the workspace roster by name, or **Round robin**, the next member of the
[pool](#round-robin) in turn.

A rule naming a member who has since left the workspace is skipped, as is a
round-robin rule while the pool is empty; the next rule down is tried. Use
the arrows to reorder, and the row menu to delete. A workspace keeps at most
50 rules.

Rules run for every capture door on every site, including a lead that is
[converted](./leads.md#converting-a-lead) without an owner picked, and only
on a contact that has no owner yet. To **reassign** a contact that already
has one, use an [automation](./automations.md#the-steps) — the **Assign the
contact an owner** step, which can also rotate through the pool.

## Round robin

The members handed contacts in turn by a round-robin rule, or by an
automation set to round robin. Tick the members to include; the order they
were ticked is the rotation order, shown beneath the list with who is **next
up**.

Each new record goes to the member after the one who got the last record,
wrapping round to the first. The pointer is moved by the server in the same
write that assigns the owner, so two contacts captured at the same moment go
to two different people, and editing the pool — adding, removing or
reordering a member — never skips or repeats anybody: the next record goes
to whoever follows the last recipient in the pool as it now stands. A member
who leaves the workspace is skipped. A pool can hold up to 50 members.

## Recipes

At the **organization level** only — `…/{organization}/crm/settings` —
the Settings section ends with a **Recipes** card: the four
[automation recipes](./automations.md#recipes), each with the sites that
already carry it and an **Install** button. Automation is a site feature,
and the site's own Actions page opens a recipe in the editor for you to
change and save; this card is for the organization that runs several sites
and wants the same automation on more than one of them without building it
on each.

**Install** opens a drawer: pick the site, and for **Tag by form** one of
that site's live forms, then confirm. The action the recipe builds is
written into that site's **Automation → Actions** exactly as the recipe
defines it — enabled, with the trigger, conditions and steps the
[recipes table](./automations.md#recipes) describes — and stamped with the
recipe it came from. The card then links to the site's Actions page, where
the action can be edited like any other. Installing needs the same
**Manage data** permission the organization's CRM needs, and the plan that
carries the actions builder; on a plan without it the buttons are disabled
and say so.

Each recipe lists the sites it is **installed on**, read from that stamp,
and links each into the site's Actions page. A site that carries actions
saved before the stamp existed is listed as **may already have it**: those
actions could have started from the recipe, and the card will not call the
site clear. Installing the same recipe on a site that already carries it is
refused — **Already installed on this site** — rather than installed twice;
delete the site's copy from its Actions page first if you want a fresh one.

## Related

- [CRM overview](./overview.md)
- [Automations for the CRM](./automations.md#recipes) — what each recipe builds
- [Companies](./companies.md) — the records these settings create and link
- [The contact record](./contact-record.md) — picking a company or an owner by hand
- [Leads](./leads.md) — a lead follows its contact's owner
- [Automations for the CRM](./automations.md) — reassigning, and rotating, after a contact is created
