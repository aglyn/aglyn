---
sidebar_position: 1
title: Analytics
description: Built-in pageview analytics, the Traffic card and its growth figure, per-screen metrics, and average time on a screen.
---

# Analytics

Aglyn tracks how your site is doing out of the box — pageviews, referrers, devices, and
per-screen traffic — so you don't need a third-party tool to see the basics.

:::info Plan availability
**Free** dashboard traffic panel. **Per-screen traffic** and the `screenAnalytics`
entitlement are **Pro+**.
:::

![The site analytics page](/img/analytics/analytics-page.png)

## Pageview tracking

A lightweight **pageview beacon** records visits into daily counters. The site dashboard
shows a **traffic panel** summarizing your site's activity. Tracking is **cookieless** —
no visitor IDs, no fingerprinting.

## Visitors (approximate)

Alongside raw pageviews, the traffic panel shows an **approximate visitor count**. It is
deliberately imprecise so it can stay cookieless: each browser tab counts once per day,
so a visitor using two tabs — or returning on another day — counts again. Nothing links
one day's visits to the next.

## The Traffic card {#traffic-card}

The **Traffic** card on a site's dashboard is the one most people read. Its range picker
offers **7 days**, **14 days**, **30 days** and **90 days**, and defaults to 14.

It shows six figures for the window you picked:

| Figure | What it means |
|---|---|
| **Page views** | Total views in the window, with a growth figure beside it |
| **Visitors** | The approximate count described above |
| **Avg / day** | Page views divided by the days in the window |
| **Mobile / Desktop** | The share of views from each, largest first |
| **Top page** | The most-viewed path, with its view count |
| **Top referrer** | Where most visits came from, with its count |

### What the growth figure compares against {#traffic-delta}

The `+12.4% vs prior` beside **Page views** compares the window you selected against the
**window of the same length immediately before it** — 7 against the previous 7, 90 against
the previous 90. Change the range and the comparison changes with it; hovering the figure
says which one, in words.

It is green above zero, red below, and neutral at exactly zero.

**A first window shows no growth figure at all.** When there is no prior period to compare
against — a site published last week, asked for 30 days — Aglyn renders nothing rather than
`+100%` or `+0%`, both of which would be claims it cannot support. The same rule applies to
every delta in the product, including the ones on the Orders screen.

Percentages in the device split are each rounded on their own, so they need not add to
exactly 100. A device with no views is left out rather than shown as `0%`.

## Insights

Dig deeper with top **referrers** and full **device** breakdowns over the same selectable
ranges.

## Campaign tracking (UTM)

Links tagged with **utm_source**, **utm_medium**, and **utm_campaign** are broken down on
the analytics page, so you can see which newsletters, ads, or campaigns actually bring
visitors. Tag your links as you would for any analytics tool; Aglyn records the labels
from the URL — nothing about the visitor.

## Per-screen traffic

**Pro+** sites get a **per-screen traffic panel** on each screen's view page, with
pageviews attributed to the screen and broken down by **referrer** and **device** — and a
**Screens table** on the site's analytics page comparing pageview share across all your
screens over a selectable window. Plan cards surface analytics as an upsell for lower
tiers.

To find it: open a site, go to **Screens**, open a screen, open the version you want, and
look for the **Screen traffic (14 days)** card.

### Average time on a screen {#dwell-time}

Beside **Screen views**, that card shows **Avg. time on this screen** — how long a visitor
stayed before leaving it. It reads as `45s`, `2m 04s` or `1h 05m`.

Things worth knowing before you draw a conclusion from it:

- **It is an average over the visits that reported one, not over all views.** A visitor
  whose tab is killed, or whose browser closes before it can send, reports nothing. The
  figure divides by the visits that were measured.
- **It is capped at 30 minutes.** A tab left open all afternoon is counted as 30 minutes
  rather than as an afternoon, so one abandoned tab cannot dominate the average.
- **Visits under a second are ignored.** A bounce through a redirect is not time on the
  page.
- **It appears only once there is something to average.** A screen with no measured visits
  shows no figure at all — not a zero, not a dash.
- **Time is collected on every plan**, including Free. Only *reading* it is Pro+, so the
  history is already waiting the moment an organization upgrades.

Aglyn stores a running total and a count of measurements per screen per day. It never keeps
an individual visit's duration — that would be a behavioural record of a person, and the
average is the whole of what the feature needs.

## Google Analytics

Prefer your own tooling? Add a **Google Analytics** ID and Aglyn injects it alongside the
built-in tracking.

## Related

- [SEO toolkit](../../building-sites/seo/overview.md)
- [Billing & plans](../../workspace-and-billing/billing-and-plans/overview.md)
