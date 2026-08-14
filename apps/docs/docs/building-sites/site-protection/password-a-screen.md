---
sidebar_position: 2
title: Password-protect a screen
description: Require a password to view a specific screen.
---

# Password-protect a screen

Lock a single screen behind a **password** — useful for drafts, client previews, or gated
content, without setting up full membership.

![The screens list — open a screen from here; the password itself is set on the screen's own page](/img/getting-started/screens-list.png)

## Steps

1. Open **Screens** and click the screen you want to protect. The screens list has no
   visibility column — the control is on the screen's own page.
2. Find the **Page Access** card and set **Visibility** to **Password protected**.
3. A **Page password** field appears. Type the password and click **Save**. Once one is
   set, the field reads *"A password is set — save a new one to change it."*
4. Publish. Visitors are prompted for the password before they can view the screen.

The other visibility options on the same card are **Public** (anyone with the link, listed
in navigation and offered to search engines), **Unlisted** (reachable by URL only, kept out
of search results and the sitemap), and **Members only**. Password-protected and unlisted
screens are both kept out of search results.

Password attempts are limited to **10 per minute per screen, per visitor address**, so
the password can't be guessed by brute force. Someone who trips it is asked to wait a
moment and try again. The limit counts per address, so a shared office connection
tripping it won't lock out anyone else — but if a whole team is unlocking the same
screen at once, expect the occasional retry prompt.

## Password vs. members-only

| Password | Members-only |
| --- | --- |
| One shared secret | Individual accounts |
| No sign-up needed | Visitors sign in / sign up |
| Best for one-off gating | Best for ongoing member areas |

For account-based access, use a [members-only area](../../workspace-and-billing/teams-and-roles/members-only.md)
instead.

## Related

- [Custom error screens](error-screens.md)
- [Members-only areas](../../workspace-and-billing/teams-and-roles/members-only.md)
