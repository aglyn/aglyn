# @aglyn/shared-util-first-touch

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-first-touch@beta

Where a visitor first arrived from, kept on their device until an account is
created and the platform writes it down. No analytics vendor, no identifier,
no configuration beyond the list of hosts the install serves itself.

## What it records

| Field | What it holds |
| --- | --- |
| `at` | When the visitor landed |
| `host`, `path` | The first page they landed on, without its query string |
| `ref` | The EXTERNAL host that sent them, or `null` |
| `via` | One of your own hosts they arrived from before any surface captured them |
| `utm` | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` — trimmed, capped at 100 characters, refused when shaped like an email address |
| `click` | Which of `gclid`, `fbclid`, `msclkid` the landing URL carried — presence only, never the value |

**An internal referrer is never a first touch.** A hop between two hosts the
install names as its own carries the record forward and never replaces it, so
"docs → pricing → signup" still reports whatever started the visit.

## Two ways to include it

As a script tag, on a page no bundler touches — the platform serves the kit's
own source with the host list and the hand-off endpoint already configured:

```html
<script src="https://app.example.com/api/first-touch" async></script>
```

Add `data-consent="pending"` when the page's consent tool decides after load;
the record is then held in memory until `setPageFirstTouchStorage(true)` (or
`window.aglynFirstTouch.setStorage(true)`) grants device storage.

As an import, in an app with a bundler:

```ts
import { bootFirstTouch, readFirstTouch } from '@aglyn/shared-util-first-touch'

bootFirstTouch({ hosts: ['example.com', '*.example.com'], storage: true })
// …later, at signup:
const touch = readFirstTouch()
```

## Where the record lives

1. A cookie, `aglyn_ft`, on the registrable domain of the page — found by
   asking the browser which domain accepts a cookie, not from a suffix list.
   Every subdomain reads the same value.
2. `sessionStorage`, when the browser refuses the cookie.
3. Memory, while storage is pending or refused. A link to another of your
   hosts can still carry the record in its URL as a sealed `_ft` token, which
   the receiving page strips from its address bar and adopts once.

## Channels

`classifyChannel(touch)` groups a touch as `organic-search`, `paid-search`,
`social`, `referral`, `email` or `direct` from a short, ordered rule table
(`DEFAULT_CHANNEL_RULES`), not from an analytics vendor's grouping. Pass your
own table to change it.
