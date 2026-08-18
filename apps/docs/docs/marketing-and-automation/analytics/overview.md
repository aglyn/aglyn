---
sidebar_position: 1
title: Analytics
description: Built-in pageview analytics, traffic insights, and per-screen metrics.
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

## Insights

Dig into traffic with **insights**: top **referrers**, **device** breakdowns, and
selectable date **ranges**.

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

## Google Analytics

Prefer your own tooling? Add a **Google Analytics** ID and Aglyn injects it alongside the
built-in tracking.

## Related

- [SEO toolkit](../../building-sites/seo/overview.md)
- [Billing & plans](../../workspace-and-billing/billing-and-plans/overview.md)
