---
sidebar_position: 3
title: Google Analytics events
description: Every event your site sends to your own GA4 property, with the exact parameters each one carries — so you can build a report against it before you have any data.
---

# Google Analytics events

Add your own **Google Analytics** measurement ID and your site sends events to
your property, under your account, alongside Aglyn's own built-in
[pageview analytics](./overview.md). This page is the list: every event name,
every parameter, and where it comes from.

You need this list *before* the data arrives, because GA4 will not show you a
custom dimension you have not registered — and it cannot register one for a
parameter it has never received.

## Turn it on {#setup}

**Site → Setup → Tracking.**

| Field | Format |
| --- | --- |
| Google Analytics measurement ID | `G-` followed by 4–16 letters and digits |
| Google Tag Manager container ID | `GTM-` followed by 5–10 letters and digits |

Both are optional and independent. A value that does not match the format is
ignored rather than injected, so a mistyped ID fails silently — check the field
if nothing arrives.

:::note Nothing is sent from a preview or a development server
Tracking only runs on a production deployment. A site you are previewing sends
no events at all, to your property or ours, so an empty GA4 report from a test
run is expected rather than broken.
:::

## What consent does to it {#consent}

**The tag never loads for a visitor whose recorded consent does not grant
analytics.** This is structural, not a filter: with no tag on the page, every
event below is dropped where it is raised, and nothing is queued for later. A
visitor who grants consent halfway through a session starts being measured from
that point, not retroactively.

Which visitors that covers depends on your consent posture — see
[Cookie consent](./cookie-consent.md). The short version: under the opt-in
posture nobody is measured until they say yes, and under opt-out everyone is
measured until they say no.

Your Google Tag Manager container is gated the **same way** and never more
loosely. A container that loads only after analytics consent cannot be used to
install a tag that runs before it.

## Events GA4 collects by itself {#automatic}

Aglyn sends **no `page_view` of its own**. Your property gets GA4's automatic
collection — `page_view`, `session_start`, `first_visit`, `user_engagement` —
plus whatever enhanced measurement you have enabled in the property (scroll
depth, outbound clicks, file downloads, and so on).

Everything in the tables below is *in addition* to that.

## Engagement {#engagement}

| Event | Parameters | Sent when |
| --- | --- | --- |
| `generate_lead` | `form_name` (string), `form_location` (the page path) | A form is submitted successfully. `form_name` is the form's name, or `Form` if unnamed; `Newsletter` for a newsletter signup block, `Booking` for a free booking, `Popup` for an overlay form. |
| `select_content` | `content_type` (always `cta`), `content_id`, `surface` (`site`) | A visitor clicks a call-to-action link. `content_id` combines the section, the link label and a `plan=` qualifier where the destination carries one; it falls back to the destination path so an unlabeled CTA is still counted. |
| `click` | `link_domain` (the destination hostname), `link_id` (when the link is identifiable), `surface` (`site`) | A visitor clicks a link to another domain. Same-host links are not sent — the destination's own pageview already counts them. |
| `aglyn_overlay` | `overlay_action`, `overlay_id` | An overlay or popup is shown, dismissed or converted. |
| `aglyn_experiment` | `experiment_id`, `variant_id`, `experiment_action` (`exposure` or `conversion`) | A visitor is assigned to an A/B variant, and again when that variant converts. |
| `sign_up` | `method` (always `password`) | A visitor creates a site member account. |
| `login` | `method` (always `password`) | A site member signs in. |

## Commerce {#commerce}

These come from the commerce and bookings features and follow GA4's standard
ecommerce shape, so GA4's built-in ecommerce reports work without any mapping.

| Event | Parameters |
| --- | --- |
| `view_item` | `items`: one entry with `item_id` and `item_name` |
| `add_to_cart` | `items`; plus `currency` and `value` **only when the item has a price**. An unpriced item sends the pair not at all rather than sending zero. |
| `view_cart` | `currency`, `value` (the server-calculated subtotal), `items` |
| `begin_checkout` | `currency`, `value`, `items` |
| `purchase` | `transaction_id`, `currency`, `value` (gross, excluding tax), `shipping`, `items` with `item_id`, `item_name`, `price` and `quantity` |

Three things to know before you build a revenue report:

- **`value` on `purchase` excludes tax.** There is no `tax` parameter, so a
  GA4 revenue figure will not match a tax-inclusive settlement report.
- **Items carry no `item_category`.** Category breakdowns are not available
  from this data.
- **Refunds are not sent from the browser.** Cancellations and refunds happen
  server-side and do not reach your property, so GA4 revenue is gross of them.

## Page speed {#web-vitals}

Core Web Vitals are reported as events named after the metric: **`LCP`**,
**`CLS`**, **`INP`** and **`TTFB`**. Each carries:

| Parameter | Meaning |
| --- | --- |
| `value` | The metric *delta*, not the total. GA sums `value`, and summing deltas keeps a twice-reported metric's page total correct. |
| `metric_id` | An id unique to that measurement, for de-duplicating |
| `metric_value` | The metric's current value |
| `metric_delta` | The change since the last report of the same metric |
| `metric_rating` | `good`, `needs-improvement` or `poor`, when the library assigns one |
| `surface` | `site` |

Report on `metric_value` — averaging `value` will give you the average *change*,
which is not a number that means anything.

## Your own events {#authored-events}

Any element on a screen can send an event you name yourself, via the
**Track an analytics event** interaction step. It lands in the same property as
everything above. See
[Interactions](../../building-sites/besigner/interactions-and-custom-html.md#analytics-event-step)
for the naming rules, the parameter limits and what gets stripped.

## What your property never receives {#never-sent}

Some measurement exists on Aglyn's side and is deliberately kept off your
property:

- **Aglyn's own product events** — workspace and site creation, publishing,
  billing and assistant usage. These go to Aglyn's console analytics, never to
  a site's property.
- **`traffic_type` and `content_group`** — internal-traffic marking and content
  grouping are applied only to Aglyn's own marketing site.
- **Advertising tags** — Meta, Google Ads and LinkedIn tags are installed only
  on Aglyn's own marketing site. On your site the advertising machinery renders
  nothing and installs nothing.
- **Server-side events**, including refunds and subscription cancellations.
  They are sent from the server with credentials that are not per-site, so
  there is no way to route them to your property.
- **The built-in pageview beacon.** Aglyn's own Traffic card is fed by a
  first-party, cookieless request that is not GA4 and does not appear in your
  property.

## Related

- [Analytics](./overview.md) — the built-in Traffic card and per-screen figures
- [Cookie consent](./cookie-consent.md) — what has to be true before any of this runs
- [Interactions](../../building-sites/besigner/interactions-and-custom-html.md) — sending an event of your own
