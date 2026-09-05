---
sidebar_position: 2
title: Custom fields
description: Define your own contact properties — text, number, date, choice, checkbox or link — show them on every contact, and save form answers straight into them.
---

# Custom fields

A contact carries a fixed set of properties — name, email, tags, notes, and the CRM's
own owner, lifecycle stage and company. **Custom fields** add the properties your
business describes people by: an annual revenue, a tier, a renewal date, a VIP checkbox,
a link to a profile.

A field is defined once for the whole organization. It then appears on every contact's
page, as an optional column on the contacts list, as a destination a form field can save
into, and on the [REST API](#over-the-api). Definitions are shared across every site in
the organization, like the contacts themselves; the values a site records are that
site's own view of the person.

## Define a field {#define-a-field}

Open **CRM → Fields** and choose **New field**.

- **Label** — how the field reads everywhere it shows.
- **Key** — derived from the label as you type (`Annual revenue` becomes
  `annual_revenue`); edit it to choose your own. A key starts with a letter and uses
  lowercase letters, digits and underscores, up to 40 characters. Values are stored under
  the key, so it **cannot change** once the field exists — a rename is a new field and a
  retirement of the old one.
- **Type** — **Text**, **Number**, **Date**, **Choice**, **Checkbox** or **Link**. Every
  value is read by its type, so the type is fixed once the field exists.
- **Choices** — for a Choice field, one per line. A stored value has to be one of them.
- **Required on the contact form** — a contact's page will not save the field empty. It
  does not make a website form field required; that is set on the form itself.

Fields are listed in the order they appear on a contact and in the list's columns; the
arrows on each row move a field up or down.

:::note
How many contacts carry a value under each field is not counted. That would read every
contact in the organization each time the page opened, so the list says so rather than
showing a number it cannot keep true.
:::

## Where values show {#where-values-show}

- **A contact's page** carries a **Custom fields** card with one control per field — a
  text box, a number box, a date picker, a choice list, a checkbox or a link box. **Save**
  writes only the fields you changed; clearing a control clears the value.
- **The contacts list** offers one optional column per field. The columns show the value
  as it reads — a date as a day, a checkbox as *Yes* or *No*, a link as a link — and are
  not sortable or filterable.
- **Exports and the API** carry the values under their keys.

A value belongs to the site that recorded it. Two sites in one organization that both
know a person each see their own values, never each other's.

## Save a form field into a custom field {#save-a-form-field}

On a form's own page (**Forms →** the form), **Saves to contact fields** lists every
field the published design declares, with a choice beside each. Pick a custom field and
every submission's answer to that form field is stored under it on the contact the
submission creates or updates.

Answers arrive as text and are converted by the field's type:

| Field type | What is stored |
| --- | --- |
| **Text**, **Link** | The trimmed answer. A Link has to be an `http(s)` URL, or nothing is stored. |
| **Number** | The number. An answer that is not one number is dropped rather than stored as text. |
| **Date** | The date, as an ISO 8601 stamp, whichever way the visitor typed it. |
| **Choice** | The answer, only when it is one of the field's choices exactly. |
| **Checkbox** | `true` or `false`, from what a ticked or unticked box sends. |

An answer left blank writes **nothing** — a submission never clears a value you set by
hand. A mapping onto a [retired](#retire-restore-delete) field writes nothing either.

Mappings are kept by **field name** across publishes: redrawing the form and publishing a
new version does not lose them. A field renamed on the canvas is a new field and starts
unmapped; a field removed takes its mapping with it.

The sender's **name** and **email** are recognized from the field name — see
[who a submission is from](../forms/overview.md#who-a-submission-is-from) — and never
need mapping.

## Over the API {#over-the-api}

The [`/v1/contacts`](/api/resources/contacts) resource carries `custom`, an object keyed
by field key — `{}` on a contact that has none, so a client can index it without a guard.

- **POST** and **PATCH** accept `custom`. Values are converted by type exactly as a form
  answer is.
- A **PATCH** merges the keys it sends and keeps the rest; send `null` under a key to
  clear it.
- A key that is not a field, a field that is retired, or a value the type cannot hold is
  refused with `400 validation_failed` and named in `fields` as `custom.<key>` — nothing
  is stored from that request.

## Retire, restore and delete {#retire-restore-delete}

**Retire** takes a field off every contact page, every column and every form mapping.
Values already saved under it are kept and still export, and **Restore** brings the field
back with them intact.

**Delete** is offered only on a retired field. It removes the definition for good; values
saved under its key stay on the contacts that carry them, but nothing will show them
again — and a new field created with the same key would read them as its own, which is
why the key of a retired field still counts as taken when you create one.

## Related

- [Contacts CRM](overview.md)
- [Forms & lead capture](../forms/overview.md)
- [REST API — contacts](/api/resources/contacts)
