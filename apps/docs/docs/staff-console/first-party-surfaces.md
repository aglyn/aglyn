---
sidebar_position: 12
title: Adding a first-party surface
description: "How to make a new site of ours — a forum, a status page, a second domain — count its visitors' first touch: register its host, include one script tag. Nothing else, and nothing to configure on a self-hosted install."
---

# Adding a first-party surface

:::warning Aglyn staff only
Registering a host needs the `super` staff role, on **Staff → Platform settings**.
:::

A visitor's first touch — where they first arrived from — can land on any site we run:
the marketing site, the docs, the blog, the console's sign-in page, a forum, a status
page. The [Acquisition card](acquisition.md) can only report it if the site the visitor
landed on recorded it. Every site we run therefore includes the same small capture, and
all of them agree on which sites are **ours**: a visitor moving between two of our sites
is one visit, and only a site that is not ours can be where it started.

Adding a surface takes two steps.

## 1. Register its host {#register}

Most of our hosts are already registered, because the list is built from configuration
the platform already has:

- the workspace domain and **every subdomain of it** — the console, its sign-in host,
  every workspace, and the docs when they live under it;
- the console, docs and home addresses, wherever they live.

A new site under the workspace domain is therefore registered already. Anything else — a
forum on its own domain, a hosted status page, a second domain — is added on **Staff →
Platform settings → First-party hosts**, one entry per line:

| Entry | Means |
| --- | --- |
| `forum.example.com` | That host exactly |
| `*.example.community` | Every subdomain of it, at any depth — but not `example.community` itself |
| `!*.sites.example.com` | EXCLUDE these, whatever else matches them |

Every change needs a reason and is written to the audit trail. It reaches every server
within five minutes, without a deploy.

**Customer sites are never ours.** A visitor who follows a customer's "made with" badge
to us arrived from somebody else's site, which is exactly the referral the record is
for. If your install serves customer sites under its own domain, the registry excludes
them automatically; add an exclusion for any other host that serves somebody else's
content.

## 2. Include the capture {#include}

On a page no bundler touches, one script tag, served by the console:

```html
<script src="https://app.example.com/api/first-touch" async></script>
```

The script arrives configured: the host list, where to seal a hand-off, and a storage
default for that visitor — their recorded consent answer when there is one, a refusal
when their browser sends Global Privacy Control, and otherwise their region's rule
(allowed where implied consent is lawful, pending where the law asks first).

If the page runs its own consent tool, mark the tag and forward the answer:

```html
<script src="https://app.example.com/api/first-touch" async data-consent="pending"></script>
<script>
  // Once your consent tool has an answer:
  window.aglynFirstTouch && window.aglynFirstTouch.setStorage(true) // or false
</script>
```

In an app with a bundler, import it instead and boot it once:

```ts
import { bootFirstTouch } from '@aglyn/shared-util-first-touch'

bootFirstTouch({ hosts, storage: true, handoffUrl: '/api/first-touch' })
```

## What the capture does, so you can check it

- It runs only on a registered host. A copy of the tag on anybody else's page records
  nothing.
- It keeps the record in a cookie, `aglyn_ft`, on the site's registrable domain, so every
  subdomain reads the same record. When the browser refuses the cookie it uses the tab's
  session storage; while consent is pending or refused it keeps the record in memory and
  writes nothing to the device.
- A link to one of our hosts the cookie cannot reach — another domain, or any of our
  hosts while the record is held in memory — carries the record in its URL as a sealed
  `_ft` token. The page it lands on removes the token from the address bar at once and
  adopts the record. Tokens expire after thirty minutes, so a pasted link does not hand
  one visitor's first touch to everyone who opens it.

To check a new surface: open it in a private window from a search result, sign up on the
console, and read the account's Acquisition card. It should name the search engine and
the new surface's page as the landing.

## On a self-hosted install

Nothing to configure. The capture is built into the console and the site runtime, the
host list is built from your own workspace domain, console, docs and home addresses, and
the hand-off is sealed with the signing secret your install already has. No analytics
vendor is involved at any step.
