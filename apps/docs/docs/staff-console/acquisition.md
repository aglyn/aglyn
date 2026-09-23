---
sidebar_position: 11
title: Acquisition
description: "Where an account or workspace came from: its first visit, the door it signed up through, and whether the sales workspace already knew the person — recorded once at creation, read from one card."
---

# Acquisition

:::warning Aglyn staff only
This card lives on **Staff → Users → _the account_** and **Staff → Organizations →
_the organization_**, and requires a staff claim. Every staff role can read it;
city-level geography is shown to the `super` role only.
:::

The **Acquisition** card answers "where did this person come from?" in one read. Before
it existed, answering that for one new workspace took twenty-five minutes across the
staff user page, Firestore, the analytics property and the marketing site's daily
referrer counts. The platform now records the answer on the account itself, at the
moment the account is created, and shows it here.

## What the card shows

The first line says it in words:

> Referral from g2.com → /pricing → signed up with password

Below it, the parts that line is built from:

| Row | What it is |
| --- | --- |
| **Channel** | One of organic search, paid search, social, referral, email or direct, from the [rule table](#channels) below — not from an analytics vendor's grouping. |
| **Source / medium** | `utm_source` / `utm_medium` when the landing URL carried them; otherwise the referring site and what the channel implies (`g2.com / referral`). `(direct) / (none)` means nothing external was known. |
| **Campaign** | `utm_campaign`, when present. `utm_content` and `utm_term` are shown too, when present. |
| **Landing page** | The first page the visitor landed on, without its query string. A landing on another of our hosts (the docs, say) shows its host. |
| **Referrer** | The external site that sent them — its host only, never the page. |
| **Arrived from** | One of our own hosts the visitor came from before anything recorded them. It means a surface that does not include the capture yet; see [Adding a first-party surface](first-party-surfaces.md). |
| **Ad click ids** | Whether the landing URL carried `gclid`, `fbclid` or `msclkid`. Only their presence is kept, never their values. |
| **Door** | How the account was created: the sign-up form with a password or with Google, accepting an invitation, or single sign-on. |
| **First visit / account created** | When the first visit landed, and when the account was created. Weeks apart is normal. |
| **Signed up from** | Where the account-creating request came from, as the network edge reported it. Country for every staff role; region and city for `super`. |
| **Latest sign-in** | The newest sign-in in the account's sign-in history, with the same rule for city-level detail. |

On an organization's page the card shows the record of the account that **created** the
workspace, copied onto the workspace when it was created, and links to that account.

## Did the sales workspace already know them? {#cross-check}

The bottom of the card checks the platform's own sales workspace — the organization
behind the marketing site (`PLATFORM_MARKETING_HOST_ID`) — for this person:

- **By address**, exactly. A contact or lead with the account's address is shown with
  when it was first seen and how the workspace came to know them (a form, outreach, an
  import). The contact the platform files for **every** new account is left out: it is
  the sign-up itself, not somebody already known.
- **By name**, as a resemblance, labeled **possible**. Both names need a first and a last
  word, the last words must match exactly, and the first words must be the same name —
  equal, a shortened form ("Matt" / "Matthew"), a common nickname ("Bob" / "Robert"), or
  one typo apart. This is how you spot a known lead who signed up on a personal address.
  It is a guess: confirm it before you act on it.

The check runs through every plugin that keeps people, so the card says **could not
check** for a plugin that failed rather than showing an absence it did not measure.
Opening the card writes a `user.acquisition-viewed` (or `org.acquisition-viewed`) row to
the audit trail, because it reads the sales workspace's people.

## Channels {#channels}

Rules are tried in order; the first match wins.

| Order | Channel | Matches |
| --- | --- | --- |
| 1 | Email | An email or newsletter medium or source, or a webmail referrer |
| 2 | Paid search | The landing URL carried `gclid` or `msclkid` |
| 3 | Social | A social network's source, referrer or click id (`fbclid`), or a social medium — a promoted post is still social |
| 4 | Paid search | A paid medium: `cpc`, `ppc`, `paid`, `sem` and their spellings |
| 5 | Organic search | A search engine's referrer or source, or `utm_medium=organic` |
| 6 | Referral | Any other external referrer or tagged link |
| 7 | Direct | Nothing external at all |

## When the card says "Source unknown"

- **"the account predates capture"** — the account was created before the capture
  existed, and the backfill stamped it so the card is never blank. The backfill fills
  what the sign-in records can still say: when the account was created, which provider
  created it, and where its first device was last seen from (shown as **First device,
  last seen**, because it is not where the account was created from).
- **"nothing was captured"** — the account was created after the capture existed, but the
  visitor's browser kept nothing: storage refused, or the sign-up page could not reach
  the platform. The door, provider and geography are still recorded.

## What is never recorded

No identifier: two visitors who arrived the same way carry the same record. Click ids as
presence only. Referrers as a host only. `utm_*` values are trimmed, capped at 100
characters, and dropped when shaped like an email address. The record is written once, by
the platform, and the database rules refuse the field to every client — the account
holder and staff alike — so it cannot be restated after the fact.

## Related

- [Adding a first-party surface](first-party-surfaces.md)
- [Users admin](overview.md#users-admin)
