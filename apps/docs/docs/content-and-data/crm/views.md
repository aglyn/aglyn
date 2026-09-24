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
existed keeps its filters as they were.

## Filters on the Contacts list

On the Contacts list the fields are the list's columns and a few that are not
— owner, stage, source, company, tags, form, orders, lifetime value, created
and updated dates, email verdict, next activity, and one field per
[custom field](./custom-fields.md) your organization has defined.

One chip reaches every contact and the rest narrow what it found. The
database answers one filter per query, so the first filter it can serve —
a name, an email, a tag, a form, a date, an order count — is run against the
whole collection, and every other filter narrows the newest thousand contacts
that query returned. The served chip is filled; the others are outlined; and
the caption under the chips says which is which. Owner, stage, source, company
and custom-field filters always narrow rather than reach, because those
facts are kept per site and no query can reach them directly. Sorting
reorders the loaded window.

## Filters on the other lists

- **Leads** — Status, Email, Owner, Lead source and Campaign; see
  [the leads list](./leads.md). The list reads the 200 most recently seen
  leads, and every filter and the search narrow those.
- **Companies** — Company (starts with or is) and Owner reach every company;
  the search box is the same **Company starts with** filter. The list is
  paged, so one of the two applies at a time.
- **Deals** (the table) — Status reaches every deal. There is no search box:
  nothing indexes a deal's title, and a search over one page would miss the
  deal on the next.
- **Tasks** — **Show** is the task view (My tasks, Overdue, Today, Upcoming,
  All open, Done) and reaches every task; Kind, Priority and Assignee, and
  the search over title and notes, narrow the rows that view loaded.

On the contacts, companies and deals lists, **Next activity** › **is empty**
keeps only the records with no open task scheduled against them (see
[next activity](./tasks.md#next-activity)). It narrows the rows already
loaded rather than the whole collection, the way a contacts filter that
cannot be served does, and it stays beside the companies and deals lists'
one served filter.

## Columns and sort

**Manage columns** in any list's column menu chooses what shows, and **Move
left** / **Move right** in the same menu put a column where you want it. A view
keeps both — the choice and the order — and a view saved before a column existed
shows the new column too, after the ones it names. Click a column header to
sort; a view keeps that as well.

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
