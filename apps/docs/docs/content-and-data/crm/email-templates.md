---
sidebar_position: 6.5
title: Email templates
description: Keep the letters your team sends from a record — templates that fill in the subject and the message, snippets that drop in a paragraph, and merge fields that fill in the person's name, their company, the deal and you.
---

# Email templates & snippets

**Send email** on a contact's, a lead's or a deal's page writes one message to
one person — see [Sending an email](./activities.md#sending-an-email). A rep
writes the same few letters all week, so the CRM keeps them: a **template** is
a subject and a message under a name, filled in whole; a **snippet** is a
paragraph under a name, dropped in where the cursor is. Both can carry
**merge fields** — `{{contact.firstName}}`, `{{deal.amount}}` — that are
filled in from the record the moment the email is sent, so one letter reads
as written to each person it goes to.

## Templates and snippets

| Kind | What it holds | What it does in **Send email** |
| --- | --- | --- |
| **Template** | A subject and a message | Picked from the **Template** field above the subject; fills in both. If you have already written a message, the dialog asks before replacing it. A template with no subject leaves yours alone. |
| **Snippet** | A paragraph | Picked from **Insert** beside the message; lands at the cursor. |

A template's message is plain text, like the email itself: a blank line
starts a new paragraph, and nothing is formatted.

## Merge fields

A merge field is written as `{{group.field}}`, spaces inside the braces
allowed. **Insert** lists every field that applies to the record you are
writing to, so you need not type them.

| Field | What it fills in |
| --- | --- |
| `{{contact.firstName}}`, `{{contact.lastName}}`, `{{contact.name}}` | The person's name as the sending site knows it — the first word, the rest, or the whole. |
| `{{contact.email}}` | The address the email goes to. |
| `{{contact.company}}` | The company the person is filed under, as typed or picked on their record. |
| `{{contact.title}}` | Their job title. |
| `{{lead.firstName}}`, `{{lead.lastName}}`, `{{lead.name}}`, `{{lead.email}}` | The same for a lead, when the email is sent from a lead's page. |
| `{{deal.name}}`, `{{deal.amount}}` | The deal's title and its amount with its currency, e.g. `$1,250.00`, when sent from a deal's page. |
| `{{sender.firstName}}`, `{{sender.name}}`, `{{sender.email}}` | You — the name on your account, and the address replies come to. |
| `{{site.name}}` | The name of the site the email leaves from. |

A field that has nothing to fill — a contact with no job title, a deal with
no amount, a field written for a lead on a contact's page — is filled with
nothing, and so is a field the CRM does not know. That can leave "Hi ," in a
letter, so the dialog **previews** the message with the fields filled as soon
as it names one, and counts the empty ones under the message: *2 fields have
no value: `{{contact.firstName}}`, `{{deal.amount}}`*. What the preview shows is
what leaves — the server fills the fields with the same rules — and the
timeline logs the letter as sent, not the template.

## Keeping a letter as a template {#saving}

Write the email as you would send it, then **Save as template…** beneath the
message asks for a name and whose it is. It saves the subject and the message
as written, merge fields included, without sending anything.

## Managing templates {#managing-templates}

**CRM → Settings** carries an **Email templates** card: every template and
snippet you can use, with its kind and whether it is shared or personal.
**New template** opens a drawer for the name, the kind, who it is for, the
subject (for a template) and the message; the row's menu edits or deletes
one. The card is on a site's CRM hub and on the
[organization's](./overview.md#at-the-organization-level) alike.

A template written under a site is that site's, and is listed on that site's
hub and to every org-wide member. One written from the organization's own
CRM is the whole workspace's, and every site's hub lists it.

## Shared or personal {#shared-or-personal}

| | Who sees it | Who can change or delete it |
| --- | --- | --- |
| **Shared** | Everyone who can send email from the CRM. | Any CRM editor, and any org-wide member. |
| **Personal** | You alone. | You, and an org-wide owner or admin tidying up. |

A personal template is your own working arrangement, the way a private
[saved view](./views.md) is: it is kept out of colleagues' menus rather than
locked, so an admin can still remove one a departed teammate left behind.

## Over the REST API

Templates and snippets are the [`/v1/email-templates`](/api/resources/email-templates)
resource, for an integration that seeds a workspace's letters or keeps them in
step with another tool.

## Related

- [Activities & the timeline](./activities.md#sending-an-email) — the **Send email** dialog itself, and what the send is refused for
- [CRM settings](./settings.md#email-templates) — where the card lives
- [Saved views](./views.md) — the other thing the CRM keeps per person
