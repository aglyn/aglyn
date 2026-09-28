---
sidebar_position: 5
title: Saved views
description: Keep a CRM list's filters, columns and sort under a name, open it from the views menu or a link, share it with the team, and use a contacts view as an email audience.
---

# Saved views

Every list in the CRM — **Contacts**, **Leads**, **Companies**, **Deals** (the
table) and **Tasks** — can be saved as a **view**: the filters narrowing it, the
columns showing, and the column it is sorted by, under a name. A view is the
list the way you work it — "my open leads in Texas" — and it is there again
when you come back.

:::info Plan availability
Saved views are part of the **CRM**, included from **Starter**. On Free every CRM list is
shown locked, and with it the views menu and the Contacts list's
[segments](./overview.md#segments).
:::

## The views control

Above each list, a button names the view the list is showing — **All
contacts** when none is — and opens the views menu:

- **My views** are the ones you saved for yourself.
- **Shared with the team** lists views a colleague saved and shared.
- On the Contacts list, your saved [segments](./overview.md#segments) are
  offered under their own heading; choosing one puts its tags and sources
  among the list's filters.

Beneath them are the acts on the open view:

| Action | What happens |
| --- | --- |
| **Save changes** | The filters, columns and sort as they are now become the view's. Offered on a view you may change — one you made, or any view when you are an organization-wide member. |
| **Save as view…** / **Save as new view…** | Name the current arrangement and keep it. Tick **Share with the team** to list it for everyone who can open the section. |
| **Rename…** | Change the name. |
| **Share with the team** / **Stop sharing** | List the view for the whole team, or take it back to yours alone. |
| **Set as default** / **Clear default** | Open the section on this view whenever you come to it. The default is yours: a colleague's default is theirs. |
| **Discard changes** / **Clear filters** | Back to the view's saved arrangement, or to the plain list. |
| **Save as segment…** | Contacts only — see [Segments and views](#segments-and-views). |
| **Delete view…** | After a confirmation. The records themselves are untouched. |

A view you have changed is marked **Modified** beside its name, so a list that
reads "My open leads" and shows something else cannot pass for the saved one.

## A view is a link

The address of a section carries the open view as `?view=…`. Copy the address
and a colleague who can open the section lands on the same list. On the
Contacts list the key sits beside the ones a form's page or the Inbox link
with, so "the people this form captured, in my usual view" is one address.

## Filters

Every CRM list filters through its table's own toolbar: **Filters** opens the
filter panel, **Search** finds a record by its name and the words beside it,
and each column's menu has **Filter** too. Pick a column, a condition and a
value; a field with fixed choices — a status, a stage, an owner, a lead
source, a campaign, a kind, a priority — is picked from a list, a date from a
calendar, anything else typed.

The panel edits one filter at a time. Filters on different columns add up:
filter one column, then another, and the list keeps both. Every filter in
force shows as a **chip** beside the views control, where its ✕ removes it,
and all of them are part of the saved view. A view saved before the panel
existed keeps its filters as they were. The toolbar works the way it does on
every console list — see [Filter and search a list](../../getting-started/console-tour.md#filter-and-search) — and the sections
below say what each CRM list's filters offer.

On every CRM list the filters and the search are answered by the list's own
query, so they reach every record, a page at a time, and never only the rows
on screen. The search matches whole words from their start — "cof" finds
*Coffee*, a fragment from the middle of a word does not — one word at a time:
type several and it searches the first, and says so. It reads the first 12
letters of a long word.

A few combinations cannot be answered by one query — two "contains" or "any
of" filters at once, say, or one of them beside the search. Then the list does
not apply that filter, and a notice above the table names it and says why.

## Filters on the Contacts list

On the Contacts list the fields are the list's columns and a few that are not
— the address, source, company, form, site, orders, lifetime value, the
created date, and one field per [custom field](./custom-fields.md) your
organization has defined.

Each field offers what the list's query can answer:

| Field | Filter by |
| --- | --- |
| **Contact** | The name **contains** a word, **equals** a whole name, **starts with** or **ends with** some letters. |
| **Email** (the address) | **equals** an address, or **starts with** some letters. |
| **Email** (the verdict column) | **is** one verdict, or **is any of** several. |
| **Tags** | **contains** a tag, **is any of** several, or **is not empty**. |
| **Form ID** | **contains** a form's ID — the form's own page links here with it. |
| **Site ID** | **equals** a site's ID, or **is any of** several. |
| **Orders**, **Lifetime value (cents)** | **is not empty** — the person has bought, or is worth something. Each site keeps its own figures on its own record of the person, where no range reaches, so there are no numeric ranges. |
| **Created** | **is**, **is after**, **is on or after**, **is before** or **is on or before** a date. |
| **Last activity** | The same five date conditions, asked of when the contact's record last changed; its chip reads **Updated**. |
| **Next activity** | **is empty** — no next activity scheduled. |
| **Owner**, **Stage** | **is** one, or **is any of** several. **Owner** offers **Me** first. |
| **Source** | **is** one, or **is any of** several. |
| **Company** | **is** one. |
| A custom field | **is** a choice, or **is any of** several, for a choice field; **equals** and **is not empty** for text; **=** and **is not empty** for a number; **is not empty** for a date; **is** ticked or not for a checkbox. |

**Search** finds a person by a word of their name, their email addresses or
their company, or by the digits of their phone number — the whole number, or
its last seven or last four digits, typed without spaces or brackets. Tags
have their own filter.

**Created**, and a name or address that **starts with** or **ends with**
some letters, each order the list by their own field, so each stands on its
own: with another filter or the search beside it, it is not applied, and the
notice says so. **Last activity** combines with anything.

Under a site, the owner, stage, source, company, tags, custom-field and orders
filters read that site's own record of the person; at the organization level,
they match on any site's record.

Only one of these filters stands at a time: a name **contains** word,
**Tags**, **Form ID**, one of the other per-site fields — Owner, Stage,
Source, Company, a custom field, Orders or Lifetime value — or the search.
A second one is not applied, and the notice says so. Under a site, the
site's own narrowing already holds that one place, so a name **contains**
word is not applied there — use **starts with**, or the search; Tags, Form
ID and the per-site fields take the narrowing's place for an
organization-wide member. A member whose access is limited to
particular sites cannot use the per-site fields or **Form ID** under a site;
the notice says that too. Their search matches the start of a contact's name,
and a notice says so.

The list shows the most recently changed contacts first and keeps that order
— the column headers do not re-sort it — a page at a time, with the usual
footer to turn the page.

## Filters on the other lists

- **Leads** — Status, Email, Owner and Lead source (one, or any of several)
  and Campaign (one); the search
  finds a lead by a word of its name, email address, company, title or tags.
  **Campaign** and the search cannot be combined. See
  [the leads list](./leads.md#filter-the-leads).
- **Companies** — Company (**equals**, or **starts with**, which orders
  the list by name), Owner (one teammate, or any of several) and Next
  activity; the search finds a company by a word of its name or domain. See
  [the companies list](./companies.md#the-companies-list).
- **Deals** (the table) — Status (open, won or lost; one, or any of them) and
  Next activity; the search finds a deal by any word of its title. See
  [the board and the table](./deals.md#the-board-and-the-table).
- **Tasks** — **Show** is the task view (My tasks, Overdue, Today, Upcoming,
  All open, Done); Kind, Priority and Assignee (one, or any of several)
  filter it, and the search finds a task by a word of its title. See
  [the tasks page](./tasks.md#the-tasks-page).

On the contacts, companies and deals lists, **Next activity** › **is empty**
keeps only the records with no open task scheduled against them (see
[next activity](./tasks.md#next-activity)). Like every other filter, it is
answered by the query and adds up with the rest.

## Columns and sort

**Manage columns** in any list's column menu chooses what shows, and **Move
left** / **Move right** in the same menu put a column where you want it. A view
keeps both — the choice and the order — and a view saved before a column existed
shows the new column too, after the ones it names. On the Leads, Contacts and
Tasks lists the column headers do not sort: each keeps its query's order —
newest first, or for tasks soonest due first (**Done**: most recently due
first). On the Companies and Deals tables a column header sorts the rows of
the page on screen only; the pages themselves keep the list's own order.

## Segments and views

A [segment](./overview.md#segments) is the older, narrower thing: saved tags
and sources, usable as a campaign audience. Views keep everything a segment
kept and more, and the two meet in two places:

- Every segment is offered in the Contacts views menu. Choosing one puts its
  tags and sources among the list's filters, where you can narrow further and save
  the result as a view.
- **Save as segment…** in the views menu keeps the tag and source filters of
  the current view as a segment. The other filters stay on the view.

A **contacts view** can also be an email audience in its own right. When you
[build an audience from a rule](../../marketing-and-automation/email-campaigns/overview.md#email-lists),
pick it under **Saved view**, beside **Saved segment**: the view's filters —
owner, stage, company, tags, sources, dates, purchases and custom fields —
always apply, the way a segment's do. Only views whose filters can be an
audience are offered: a view filtered by a name or an email, or by the updated
date, describes a list on a screen rather than a set of people, and is left
out. A view that is deleted, or edited past what an audience can express after
a rule named it, makes that audience select nobody rather than everybody.

## Who sees what

A view is read by whoever can read the section, but a view you have not shared
is listed for you alone. Changing or deleting a view is the creator's, or an
organization-wide member's; a colleague on the same site who opens a shared
view can save a copy of their own, and cannot rename or remove yours. Your
default view per section is kept on your own profile, beside your
notification settings.

## Related

- [CRM](./overview.md) — the hub and its sections
- [Bulk actions](./bulk-actions.md) — act on the rows a view shows
- [Custom fields](./custom-fields.md) — each becomes a filter and a column
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md) — segments and views as audiences
