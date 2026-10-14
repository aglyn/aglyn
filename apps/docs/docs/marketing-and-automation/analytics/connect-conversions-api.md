---
sidebar_position: 6.5
title: Server-side ad conversions
description: Send purchases and leads to your own Meta, TikTok and Pinterest ad accounts from the server, paired with your browser tags — only for visitors who allow advertising.
---

# Server-side ad conversions

Send purchases and leads to **Meta**, **TikTok** and **Pinterest** from the
server as well as from the browser tag, so a conversion is still counted when an
ad blocker or a closed tab stops the tag. Everything uses **your own accounts**:
the access tokens are yours, and what is sent goes to your ad accounts, not to
Aglyn's.

## Connect an account {#conversions-api}

**Site → Setup → Ad conversions.** Each vendor has its own card there. Connect
it with an access token from your own account.

### Meta Conversions API {#meta-conversions-api}

Send purchases and leads to your Meta pixel from the server, for visitors who allowed advertising, so ad blockers and closed tabs do not lose them.

- **Access token:** Events Manager → your pixel → Settings → Conversions API → Generate access token.
- **Also needed:** the Meta pixel ID on the Tracking tab.

### TikTok Events API {#tiktok-events-api}

Send purchases and leads to your TikTok pixel from the server, for visitors who allowed advertising, so ad blockers and closed tabs do not lose them.

- **Access token:** Ads Manager → Assets → Events → your pixel → Settings → Events API → Generate access token.
- **Also needed:** the TikTok pixel ID on the Tracking tab.

### Pinterest Conversions API {#pinterest-conversions-api}

Send purchases and leads to your Pinterest ad account from the server, for visitors who allowed advertising, so ad blockers and closed tabs do not lose them.

- **Access token:** Pinterest Ads → Conversions → Conversions API → Generate new token.
- **Also needed:** your ad account ID.

### How it works {#how-it-works}

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

- [Ad tracking](./ad-tracking.md) — the browser tags these events are paired with
- [Cookie consent](./cookie-consent.md) — the advertising question both depend on
