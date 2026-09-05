---
sidebar_position: 2
title: Bulk actions
description: Select contacts in the CRM table and tag them, set their owner or lifecycle stage, add them to an email audience, export them, or remove them from this site — all at once.
---

# Bulk actions

The **Contacts** table in the CRM has a checkbox on every row. Tick one or more —
or the checkbox in the header for the whole page — and a bar appears above the
table saying how many are selected, with one action for all of them.

## What you can do with a selection

| Action | What happens |
| --- | --- |
| **Add tag** | Type a tag; it is added to every selected contact that does not already have it. Tags are lowercased, the same as on a contact's profile. A contact already holding 20 tags is skipped and named. |
| **Remove tag** | Type a tag; it is removed from every selected contact that has it. Contacts without it are left alone. |
| **Set owner** | Pick a team member. Every selected contact is assigned to them. Choose **Nobody** to clear the owner. |
| **Set stage** | Pick a lifecycle stage — subscriber, lead, marketing qualified, sales qualified, opportunity, customer, evangelist or other. |
| **Add to list** | Put the selected contacts on an [email audience](../../marketing-and-automation/email-campaigns/overview.md#lists). This runs the same check the audience's own page runs — see below. |
| **Export CSV** | Download the selected rows as `contacts-selected.csv`, with the same six columns the table's own **Export CSV** writes: email, name, sources, tags, last interaction, notes. |
| **Remove from this site** | After a confirmation, the selected contacts leave this site's CRM. A person another site in your workspace also captured keeps that site's record; a person only this site held is deleted. This is not a privacy erasure — see [the contact's own page](overview.md) for that. |
| **Clear** | Deselect everything. |

Every change lands on **this site's** record of the person. Tags, the owner and
the stage are one site's knowledge of a contact, so a site sharing a workspace
with yours never sees yours change.

## When a contact cannot be changed

A bulk action writes in batches. If any contact in the selection cannot be
written — usually because your access is scoped to certain sites and the contact
was captured elsewhere, or because the contact was deleted while the page was
open — the rest are still written, and the ones that were not appear **by email
address** in a notice under the bar, with the reason. Dismiss the notice when you
have read it. A contact the action skipped on purpose (already tagged, already at
the tag limit) is listed the same way.

## Adding people to an audience

**Add to list** opens a dialog that:

1. Lets you pick an audience from your workspace's lists. Audiences are managed by
   members with access to every site in the workspace; if that is not you, the
   dialog says so instead of showing an empty list.
2. **Checks** every selected address against its consent record and both
   suppression lists, and tells you how many already opted in, how many have no
   opt-in on record, and how many cannot be added at all (with the reason, per
   address).
3. Offers **Add** only after the check. People with no opt-in on record are added
   only if you tick the attestation that you have their permission — the same
   statement the audience page asks for, recorded against your account with the
   date.
4. Names anyone who was not added, and why.

A large selection is checked and added a hundred addresses at a time; the counts
you see are for the whole selection. A person's own page in the CRM has the same
**Add to list** button for one contact.

## Related

- [Contacts CRM overview](overview.md)
- [Email audiences](../../marketing-and-automation/email-campaigns/overview.md#lists) — including audiences built from a rule, which can now target a contact's owner, lifecycle stage, company and custom fields.
