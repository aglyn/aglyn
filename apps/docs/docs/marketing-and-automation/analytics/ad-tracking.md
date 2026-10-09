---
sidebar_position: 6
title: Ad tracking
description: Run your own Meta, TikTok, Pinterest, Google Ads and LinkedIn tags on your site — only for visitors who allow advertising.
---

# Ad tracking

Measure your ads in your own ad accounts. Your site can run the browser tags of
**Meta**, **TikTok**, **Pinterest**, **Google Ads** and **LinkedIn**.

Everything here uses **your own accounts**: the IDs are yours, and what the
tags send goes to your ad accounts, not to Aglyn's.

## Browser tags {#browser-tags}

**Site → Setup → Tracking.**

| Field | Where to find it |
| --- | --- |
| Meta pixel ID | Meta Events Manager — 8–20 digits |
| TikTok pixel ID | TikTok Ads Manager → Events — 16–24 capital letters and digits |
| Pinterest tag ID | Pinterest Ads → Conversions — 10–16 digits |
| Google Ads conversion ID | Google Ads — `AW-` and digits |
| LinkedIn partner ID | LinkedIn Campaign Manager — 4–10 digits |

Each is optional. A value that does not match its format cannot be saved.

Once a tag loads, your site reports these to Meta, TikTok and Pinterest under
each one's standard event names:

| What happened | Meta | TikTok | Pinterest |
| --- | --- | --- | --- |
| A product page was viewed | `ViewContent` | `ViewContent` | — |
| An item was added to the cart | `AddToCart` | `AddToCart` | `addtocart` |
| Checkout started | `InitiateCheckout` | `InitiateCheckout` | — |
| An order was paid | `Purchase` | `CompletePayment` | `checkout` |
| A form was submitted | `Lead` | `SubmitForm` | `lead` |

Google Ads and LinkedIn report page views; their conversions are set up in
those products.

A purchase's value excludes tax, as it does in [Google Analytics](./google-analytics.md#commerce).

:::note Nothing is sent from a preview or a development server
Tags only load on your published site, never in Preview or the editor.
:::

### TikTok pixel {#tiktok-pixel}

Paste the pixel code from TikTok Ads Manager → Events (16–24 capital letters and digits, like `C4ABCDEFGH1234567890`) to run your TikTok pixel on your site, under the same advertising consent as your other tags. With an access token on the Ad conversions card, the same events are also sent from the server.

### Pinterest tag {#pinterest-tag}

Paste the numeric tag ID from Pinterest Ads → Conversions (10–16 digits) to run your Pinterest tag on your site, under the same advertising consent as your other tags. With an access token on the Ad conversions card, the same events are also sent from the server.

## Consent {#consent}

**No advertising tag loads unless the visitor allowed advertising.** Advertising is its own question in your
[cookie consent](./cookie-consent.md) banner, separate from analytics, and it
has to be on: turn on **Also ask visitors about advertising storage** in the
Cookie consent card. Until it is, your advertising tags never load.

Which visitors that covers follows your consent mode:

- **In the UK, the EU and the EEA, and anywhere the region cannot be
  determined**, nothing loads until the visitor allows advertising.
- **Elsewhere**, under the default mode, advertising runs from the first visit
  and the visitor can turn it off at any time from **Your Privacy Choices**.
  Under **Opt-in everywhere**, every visitor is asked first.
- **Global Privacy Control** turns advertising off for that visitor.
- If you switch the consent tool off to run your own, Aglyn has no answer on
  file for anyone, so your advertising tags do not load.

When a visitor withdraws, the tags are told to stop, removed from the page and
their cookies deleted:

| Tag | Cookies |
| --- | --- |
| Meta pixel | `_fbp`, `_fbc` |
| TikTok pixel | `_ttp`, `_tt_enable_cookie`, `ttcsid` |
| Pinterest tag | `_pin_unauth`, `_pinterest_ct_ua`, `_pinterest_ct_rt`, `_epik`, `_derived_epik` |
| Google Ads | `_gcl_au` |
| LinkedIn Insight Tag | `li_sugr`, `UserMatchHistory`, `AnalyticsSyncHistory`, `li_gc` (`bcookie` and `lidc` are on LinkedIn's own domain, which only LinkedIn can clear) |

A tag you paste into **Custom HTML** yourself is not one of these: it is not
consent-gated by Aglyn and is never removed by a withdrawal.

## Related

- [Cookie consent](./cookie-consent.md) — the advertising question and the consent modes
- [Google Analytics events](./google-analytics.md) — the same moments, in your GA4 property
