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

## The views control

Above each list, a button names the view the list is showing — **All
contacts** when none is — and opens the views menu:

- **My views** are the ones you saved for yourself.
- **Shared with the team** lists views a colleague saved and shared.
- On the Contacts list, your saved [segments](./overview.md#segments) are
  offered under their own heading; choosing one puts its tags and sources on
  the filter bar.

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

## Filters on the Contacts list

The Contacts list keeps its filters as **chips** above the table, and **Add
filter** adds one: pick a field, a condition and a value. The fields are the
list's columns and a few that are not — owner, stage, source, company, tags,
form, orders, lifetime value, created and updated dates, and one field per
[custom field](./custom-fields.md) your organization has defined. Owner,
stage, source and company are picked from a list; a date from a calendar;
anything else typed.

One chip reaches every contact and the rest narrow what it found. The
database answers one filter per query, so the first filter it can serve —
a name, an email, a tag, a form, a date, an order count — is run against the
whole collection, and every other filter narrows the newest thousand contacts
that query returned. The served chip is filled; the others are outlined; and
the caption under the chips says which is which. Owner, stage, source, company
and custom-field filters always narrow rather than reach, because those
facts are kept per site and no query can reach them directly. Sorting
reorders the loaded window.

On the other four lists the filter is the control the list already had — the
companies grid's column filter, the deals table's **All / Open / Won / Lost**,
the task view, the leads **Show** — and a view keeps it with the columns and
the sort.

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
  tags and sources on the filter bar, where you can narrow further and save
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

- [Contacts](./overview.md) — the hub and its sections
- [Bulk actions](./bulk-actions.md) — act on the rows a view shows
- [Custom fields](./custom-fields.md) — each becomes a filter and a column
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md) — segments and views as audiences
