---
sidebar_position: 1
title: Billing & Plans
description: How Aglyn's tiers, entitlements, quotas, usage meters, and seat add-ons work.
---

# Billing & Plans

Your **plan** determines which features you can use and how much of each. Aglyn checks
**entitlements** (can you use a feature) and **quotas** (how much) throughout the product,
and shows **usage meters** so you always know where you stand.

:::info Plan availability
Every site has a plan. **Free**, **Pro**, and **Business** unlock progressively more.
:::

## Tiers & entitlements

- Each tier maps to a set of **entitlements** and quota limits.
- The runtime enforces them with `checkEntitlement` and `checkQuota`, so gated features are
  consistent across the console and the live site.
- Feature pages in these docs note the tier they require in a **Plan availability** callout.

## Usage meters

- The **billing page** shows meters for every quota — storage, bandwidth, datasets, seats,
  sends, and more — with redesigned plan cards.
- A **usage-cap banner** appears site-wide at 80% and 100% of a quota, with an upgrade link.
- Usage is rolled up with a **cost-plus estimate** for metered features.

## Seats

- Team and site-member **seats** are metered and enforced per tier.
- Buy **paid seat add-ons** to grow your team beyond the included seats.

## Payments

Billing runs through **Stripe**. Paid features (commerce, bookings, campaigns) share the
same Stripe integration.

## Related

- [Teams, roles & membership](../teams-and-roles/overview.md)
- [Analytics](../analytics/overview.md)
