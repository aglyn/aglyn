---
sidebar_position: 3
title: Search the console
description: What the console search palette can find, how it matches what you type, and the two things it deliberately does not search.
---

# Search the console

The magnifier in the console app bar — or <kbd>⌘</kbd><kbd>K</kbd> on a Mac,
<kbd>Ctrl</kbd><kbd>K</kbd> elsewhere — opens a search palette over whatever
page you are on, including the [Besigner](../building-sites/besigner/overview.md).

Type at least two characters. Results are grouped by kind, and clicking one
takes you straight to it.

## What it searches

Everything below is searched **within the site you currently have open**, plus
your sites across the workspace:

| Group | What a row is | Where clicking it goes |
| --- | --- | --- |
| Sites | A site you belong to in this workspace | The site dashboard |
| Pages | A screen on the open site | The screen's version view |
| Emails | An email screen on the open site | The email in the Besigner |
| Components | A reusable component | The component page |
| Layouts | A shared layout | The layout page |
| Templates | A site template | The template page |
| Content | A content collection | The Content page |
| Authors | A content author | The Content page |
| Workflows | A workflow | The Automation page |
| Products | A product | The Products page |
| Redirects | A redirect, matched on its source path | The Redirects page |
| Services | A bookable service | The Bookings page |
| Contacts | A person in the CRM, matched on their name, email, phone number or company name | The contact's own page in the CRM |

A group only appears if your plan includes it. On the Free plan there are no
workflows, products, services or redirects, so those groups are neither shown
nor searched. **Contacts** appear only while the [CRM](../content-and-data/contacts/overview.md)
is available to you and your role can manage data — the same rule that opens
the CRM itself — so a person you could not open never shows up as a result.

## How matching works

It matches **any part of a name**, not just the beginning. Searching `layout`
finds "Main Layout"; so does `lay`, `main`, and `main lay`.

Ranking puts the closest match first: an exact name, then a name that starts
with what you typed, then a word inside the name, then anything else. Pages
and products can also be found by their slug or route, but a match on the name
always ranks above a match on a slug.

Accents are ignored, so `cafe` finds "Café".

## What it does not search

Being precise about this matters — an empty result should mean "you do not
have one", not "search could not see it".

- **Orders and bookings** are not searchable. They are found on their own
  pages, which have their own filters.
- **Media** has its own, richer search on the Media page, including wildcards
  and searching by tag or custom field. See
  [the media library](../content-and-data/media/overview.md).
- **Other workspaces.** Search only ever covers the workspace named in the
  page address you are on.
- **Other people's sites.** You only ever see sites you are a member of.

## Why a group sometimes says it was only partly searched

To keep search fast and cheap, each group reads a capped number of items
rather than your entire site. If a group is larger than that cap, the palette
says so underneath the results — that line means there may be matches it did
not look at, so try a more specific word.

Most sites never hit the cap.

If a group could not be read at all, it says that too, in red. That is a
different thing from "no matches", and it is worth retrying or reporting.
