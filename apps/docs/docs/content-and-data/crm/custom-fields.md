---
sidebar_position: 12
title: Custom fields
description: Define your own properties on contacts, companies, deals and leads — text, number, date, choice, checkbox or link — show them on every record and its list, and save form answers straight into a contact's.
---

# Custom fields

A contact carries a fixed set of properties — name, email, tags, notes, and the CRM's
own owner, lifecycle stage and company; a company its domain, address and industry; a
deal its amount, stage and close date; a lead the person and their company as text.
**Custom fields** add the properties your business describes each of them by: an annual
revenue, a tier, a renewal date, a VIP checkbox, a link to a profile.

A field is defined once for the whole organization, for **one kind of record** — see
[fields per record](#fields-per-record). It then appears on every record of that kind,
as an optional column on that kind's list, and on the [REST API](#over-the-api); a
contact field is also a destination a form field can save into. Definitions are shared
across every site in the organization, like the records themselves; the values a site
records on a contact are that site's own view of the person.

:::info Plan availability
Custom fields are part of the **CRM**, included from **Starter**. On Free the Fields
section is shown locked, with the rest of the CRM. See
[What each plan includes](./overview.md#what-each-plan-includes).
:::

## Define a field {#define-a-field}

Open **CRM → Fields**, pick the tab for the record the field describes — **Contacts**,
**Companies**, **Deals** or **Leads** — and choose **New field**.

- **Label** — how the field reads everywhere it shows.
- **Key** — derived from the label as you type (`Annual revenue` becomes
  `annual_revenue`); edit it to choose your own. A key starts with a letter and uses
  lowercase letters, digits and underscores, up to 40 characters. Values are stored under
  the key, so it **cannot change** once the field exists — a rename is a new field and a
  retirement of the old one.
- **Type** — **Text**, **Number**, **Date**, **Choice**, **Checkbox** or **Link**. Every
  value is read by its type, so the type is fixed once the field exists.
- **Choices** — for a Choice field, one per line. A stored value has to be one of them.
- **Required on the … form** — the record's page will not save the field empty. It does
  not make a website form field required; that is set on the form itself.

Fields are listed in the order they appear on a record and in the list's columns; the
arrows on each row move a field up or down.

:::note
How many records carry a value under each field is not counted. That would read every
record in the organization each time the page opened, so the list says so rather than
showing a number it cannot keep true.
:::

## Fields per record {#fields-per-record}

Each tab of the Fields section is its own list: a field belongs to contacts, to
companies, to deals or to leads, and never to more than one. Keys are unique **within** a
tab, so a company field and a contact field may both be called `region` — they are two
fields, each read by its own type.

| Record | Where its fields show |
| --- | --- |
| **Contacts** | The **Custom fields** card on a contact's page, optional columns and filters on the contacts list, the CSV import, a form field's [destination](#save-a-form-field), and `custom` on `/v1/contacts`. |
| **Companies** | Rows on a company's page and controls on its **Edit** form, optional columns on the companies list, the [companies CSV import](./companies.md#import-from-csv), and `custom` on `/v1/companies`. |
| **Deals** | Rows on a deal's page and controls on its **Edit** form, optional columns on the deals table, and `custom` on `/v1/deals`. |
| **Leads** | Controls on a lead's page beside its profile and in the **New lead** drawer, optional columns on the leads list, and `custom` on `/v1/leads`. |

Only a **contact** field can be the destination of a website form field, because a
submission is a fact about a person; the drawer on the other tabs says so. Company, deal
and lead columns show values and are not filterable, for the reason the contact columns
are not: the value lives in a map no index covers.

A lead's values **stay on the lead** when it converts. A lead field and a contact field
are two fields even when they share a key, so nothing is copied across; the converted
lead is still on record and still shows what was written on it.

Fields defined before companies, deals and leads could carry them are contact fields, and
need nothing done to them.

## Where values show {#where-values-show}

- **A contact's page** carries a **Custom fields** card with one control per field — a
  text box, a number box, a date picker, a choice list, a checkbox or a link box. **Save**
  writes only the fields you changed; clearing a control clears the value.
- **The contacts list** offers one optional column per field. The columns show the value
  as it reads — a date as a day, a checkbox as *Yes* or *No*, a link as a link — and are
  not sortable or filterable.
- **A lead's page** carries its fields under **Custom fields**, below the profile and
  saved with it by the same **Save**. The **New lead** drawer offers the same controls,
  so a lead can be entered complete. A converted lead's are read-only with the rest of
  the record. The **leads list** offers one optional column per field.
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

## Lead source values {#lead-source-values}

**Lead source** is a standard lead field — Salesforce's Lead Source — and its choices are
your organization's own. They are kept on the **Leads** tab, below the custom lead
fields, under **Lead source values**. Every lead's page, the **New lead** drawer and every
contact's page offer them as a select, and the leads list filters and sorts by them.

| Action | What it does |
| --- | --- |
| **Add value** | Adds a value at the end of the list. A value the list already holds, in any capitalization, is refused. |
| **Drag**, or the arrows | Reorders the list. The order is the order every select offers, and the order the leads list sorts in. |
| **Sort A–Z** | Puts the whole list in alphabetical order. |
| **Rename** | Renames the value, and every lead and contact holding it is updated to the new name in the same step, so a report grouped by lead source follows the rename. |
| **Make default** | New leads start with this value — in the **New lead** drawer, over the API, and from a CSV row that names none. **Clear default** removes it. |
| **Deactivate** | Takes the value out of every select without touching the records that hold it. They show it as *(inactive)* and keep it until someone changes it. **Activate** brings it back. |
| **Delete…** | Removes the value for good. You pick another active value to move its leads and contacts to, or clear it from them. To keep it on those records, deactivate it instead. |

An organization that has never edited the list starts from a short starter list; your
first change makes it your own.

**The list is enforced.** A lead source typed into a [CSV import](./leads.md#import-from-csv)
or sent over [`/v1/leads`](/api/resources/leads) must be one of the active values, matched
without regard to case and stored as the list spells it. Anything else is refused, with
the values the list allows named in the error — the import skips that row and says so,
and warns before the file is sent. A lead or contact that already holds a value the list
has since deactivated keeps it on every save.

When a lead converts, its lead source is handed to the contact.

## Over the API {#over-the-api}

The [`/v1/contacts`](/api/resources/contacts), [`/v1/companies`](/api/resources/companies),
[`/v1/deals`](/api/resources/deals) and [`/v1/leads`](/api/resources/leads) resources each
carry `custom`, an object keyed by field key — `{}` on a record that has none, so a client can index it without a guard. Each
resource is judged against the definitions of **its own** record: a company body is
validated against the company fields, whatever a contact field of the same key holds.

- **POST** and **PATCH** accept `custom`. Values are converted by type exactly as a form
  answer is.
- A **PATCH** merges the keys it sends and keeps the rest; send `null` under a key to
  clear it.
- A key that is not a field of that record, a field that is retired, or a value the type
  cannot hold is refused with `400 validation_failed` and named in `fields` as
  `custom.<key>` — nothing is stored from that request.

## Retire, restore and delete {#retire-restore-delete}

**Retire** takes a field off every record page, every column and every form mapping.
Values already saved under it are kept and still export, and **Restore** brings the field
back with them intact.

**Delete** is offered only on a retired field. It removes the definition for good; values
saved under its key stay on the records that carry them, but nothing will show them
again — and a new field created with the same key would read them as its own, which is
why the key of a retired field still counts as taken when you create one on that tab.

## Recompute next activity {#recompute-next-activity}

**Recompute next activity** at the top of the Fields section rewrites every
contact's, company's and deal's [next activity](./tasks.md#next-activity) from
its open tasks — the figure every task write keeps, recomputed for the whole
organization at once. Run it after importing records that existed before the
figure did, or whenever a list's **Next activity** column looks stale; it is safe
to run any time, and it reads every open task once. An organization holding
more than twenty thousand open tasks is told only the first batch was read: the
records those tasks name are still written, but nothing stale is cleared, since
"nothing is scheduled against this record" cannot be said from a partial read.

## Related

- [CRM overview](./overview.md)
- [The contact record](./contact-record.md) — the fixed properties custom fields sit beside
- [Companies](./companies.md), [deals](./deals.md) and [leads](./leads.md) — the other
  records that carry them
- [Leads](./leads.md#what-a-lead-holds) — where the lead source values are picked
- [Import contacts from CSV](./import.md) — every custom field is an import target
- [Forms & lead capture](../forms/overview.md)
- [REST API — contacts](/api/resources/contacts), [companies](/api/resources/companies),
  [deals](/api/resources/deals), [leads](/api/resources/leads)
