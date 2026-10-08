---
sidebar_position: 6
title: Ad tracking
description: Run your own Meta, TikTok, Pinterest, Google Ads and LinkedIn tags on your site, and send purchases and leads to Meta, TikTok and Pinterest from the server — only for visitors who allow advertising.
---

# Ad tracking

Measure your ads in your own ad accounts. Your site can run the browser tags of
**Meta**, **TikTok**, **Pinterest**, **Google Ads** and **LinkedIn**, and can
send purchases and leads to **Meta**, **TikTok** and **Pinterest** from the
server as well, so a conversion is still counted when an ad blocker or a closed
tab stops the browser tag.

Everything here uses **your own accounts**: the IDs and access tokens are
yours, and what the tags and the server send goes to your ad accounts, not to
Aglyn's.

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

## Consent {#consent}

**No advertising tag loads, and no server event is sent, unless the visitor
allowed advertising.** Advertising is its own question in your
[cookie consent](./cookie-consent.md) banner, separate from analytics, and it
has to be on: turn on **Also ask visitors about advertising storage** in the
Cookie consent card. Until it is, your advertising tags never load.

Which visitors that covers follows your consent mode:

- **In the UK, the EU and the EEA, and anywhere the region cannot be
  determined**, nothing loads until the visitor allows advertising.
- **Elsewhere**, under the default mode, advertising runs from the first visit
  and the visitor can turn it off at any time from **Your Privacy Choices**.
  Under **Opt-in everywhere**, every visitor is asked first.
- **Global Privacy Control** turns advertising off for that visitor, and a
  server event is never sent for a request that carries it.
- If you switch the consent tool off to run your own, Aglyn has no answer on
  file for anyone, so your advertising tags do not load and no server event is
  sent.

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

## Server-side events {#conversions-api}

**Site → Setup → Ad conversions.** Connect the **Meta Conversions API**, the
**TikTok Events API** or the **Pinterest Conversions API** with an access token
from your own account:

| | Access token | Also needed |
| --- | --- | --- |
| Meta | Events Manager → your pixel → Settings → Conversions API → Generate access token | The Meta pixel ID on Tracking |
| TikTok | Ads Manager → Assets → Events → your pixel → Settings → Events API → Generate access token | The TikTok pixel ID on Tracking |
| Pinterest | Pinterest Ads → Conversions → Conversions API → Generate new token | Your ad account ID |

The token is stored encrypted and is never shown again; to change it, use
**Replace token**.

Once connected, your site sends from the server:

- **Purchases** — every paid online order whose shopper allowed advertising
  when they started checkout. Orders taken at the register are not sent, and
  a subscription's first payment is reported by the browser tag only; renewals
  are not reported at all.
- **Leads** — every form submitted by a visitor who allowed advertising.

Each server event carries the same event ID as the browser tag's event for the
same purchase or lead, so Meta, TikTok and Pinterest keep one and count it once.
An order event Aglyn receives twice is still sent once.

**What is sent.** The order's ID, value (excluding tax), currency and items, or
for a lead, nothing about the form's fields. The shopper's email address, phone
number, name, city, state, postal code and country are sent only as SHA-256
hashes, normalized the way each vendor asks. Each vendor also needs the
visitor's IP address, browser user agent and its own browser ID (`_fbp`/`_fbc`,
`_ttp`, `_epik`), which are sent as they are. No payment details are sent.

Events are sent within about 15 minutes. One a vendor refuses is retried when
the vendor was unavailable, and given up when it refused the event itself; the
card shows the last event sent and the last failure with the vendor's reason.
If a vendor refuses the access token, the card asks you to connect again.

**Pause** stops new events; **Disconnect** deletes the stored token and any
events not yet sent. Neither touches the browser tag on the Tracking tab.

## Test events {#test-events}

- **Meta and TikTok**: paste the **test event code** from the vendor's test
  events tool into the card. **Send test event** sends one test `Purchase` with
  it, and orders paid in Stripe's test mode are sent with it too. Real orders
  never carry it. Without a code, nothing from a test-mode order is sent.
- **Pinterest**: test events and test-mode orders are sent with Pinterest's
  test flag, which Pinterest checks and does not record as a conversion.

A test-mode order is never sent as a real conversion.

## Related

- [Cookie consent](./cookie-consent.md) — the advertising question and the consent modes
- [Google Analytics events](./google-analytics.md) — the same moments, in your GA4 property
