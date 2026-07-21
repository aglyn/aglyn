---
sidebar_position: 1
title: Billing & Plans
description: How Aglyn's tiers, entitlements, quotas, usage meters, and seat add-ons work.
---

# Billing & Plans

Your **plan** determines which features you can use and how much of each. Aglyn checks
**entitlements** (can you use a feature) and **quotas** (how much) throughout the product,
and shows **usage meters** so you always know where you stand.

![The Billing page in the Aglyn console: the current plan card with subscription status, cancel and payment-method actions, beside the plan comparison and usage meters](/img/billing-and-plans/billing-page.png)

:::info Plan availability
Every site has a plan. **Free**, **Pro**, and **Business** unlock progressively more.
:::

## Tiers & entitlements

| Plan | Billed annually | Month-to-month | Commerce |
|---|---|---|---|
| Free | $0 | $0 | Build & publish only — no selling |
| Starter | $16/mo | $25/mo | Sell up to 100 products; 2% fee on physical, 7% on digital sales |
| Pro | $39/mo | $56/mo | 2,500 products, 0% physical / 5% digital fees, POS, abandoned-cart recovery, reviews, dropshipping |
| Business | $99/mo | $139/mo | 10,000 products, 0% / 2% fees, subscriptions & paywalls, gift cards |

Transaction fees are Aglyn platform fees on storefront sales, separate from
Stripe's payment-processing fees. Upgrading is the way to reduce them.

- Each tier maps to a set of **entitlements** and quota limits.
- The runtime enforces them with `checkEntitlement` and `checkQuota`, so gated features are
  consistent across the console and the live site.
- Entitlement follows the **subscription state**: organizations without a plan resolve as
  Free, and a canceled or unpaid subscription downgrades enforcement to Free until payment
  resumes (`past_due` keeps working as a grace period).
- Feature pages in these docs note the tier they require in a **Plan availability** callout.

## Usage meters

- The **billing page** shows meters for every quota — storage, bandwidth, datasets, seats,
  sends, and more — with redesigned plan cards.
- A **usage-cap banner** appears site-wide at 80% and 100% of a quota, with an upgrade link.
- Org admins also get an in-app **notification** when email sends, dataset count, or data
  storage crosses 80% or 100% — once per threshold per month, so nobody has to be watching
  the console to find out.
- Usage is rolled up with a **cost-plus estimate** for metered features.

## Seats

- Team and site-member **seats** are metered and enforced per tier.
- Buy **paid seat add-ons** to grow your team beyond the included seats —
  self-serve from [Billing → Add-ons](add-ons.md), alongside extra sites,
  datasets, POS registers, and the Event Calendar.

## Organization data

- **Datasets are organization-scoped**: counts and storage meter against your
  organization, not individual sites.
- Each paid tier includes a number of datasets and an included **data storage** size
  (Starter 1 GB, Pro 5 GB, Business 25 GB).
- Extra datasets are a monthly **[add-on](add-ons.md)** ($2/mo on Starter and Pro, $1/mo
  on Business); storage beyond the included size is **metered overage** at $0.25 per
  GB-month on your monthly invoice.

## API access

The **customer REST API** is a **Business & Advanced** feature — mint scoped API keys and
call the versioned `/v1` endpoints from anywhere. Requests are **metered per organization**:

| Plan | Included requests / month | Overage |
|---|---|---|
| Business | 100,000 | $0.50 per additional 1,000 |
| Advanced | 1,000,000 | $0.20 per additional 1,000 |

- Requests past the included quota **keep working** and bill as metered overage on your
  monthly invoice — never a hard wall mid-integration.
- The billing page shows an **API requests** meter, and the usage-cap banner warns at 80%
  and 100% of the included quota.
- Only requests that pass authentication and the rate limit are counted — rejected calls
  (bad key, wrong plan, rate-limited) are never billed.

## Payments

Billing runs through **Stripe**. Paid features (commerce, bookings, campaigns) share the
same Stripe integration.

- **Annual billing** — a toggle on the plan cards; annual billing is the discounted
  headline price (e.g. Pro $39/mo billed annually vs $56 month-to-month).
- **Plan switches** on an active subscription show a **prorated preview** of today's
  charge before you confirm, and apply in place (no second checkout).
- **Cancel any time** — the subscription runs to the end of the paid period; a warning
  chip shows the end date and you can resume before it hits.
- **Invoices & receipts** — the billing page's **Billing history** table lists every
  invoice with its date, status, and amount. Each row links to the **Stripe-hosted
  invoice** (View), a **PDF download** of the invoice, and the payment **Receipt** once
  it's paid — everything you need for expense reports and bookkeeping. Older invoices
  load on demand.
- **Manage payment methods** opens the Stripe **Billing Portal** — update cards, view
  receipts, and set tax details there. It works even after a subscription lapses.
- If a payment fails, the console shows a **past-due banner** during Stripe's retry
  window; access continues while you fix the card, and entitlements only downgrade if
  the subscription dies.

## Related

- [Add-ons](add-ons.md)
- [Teams, roles & membership](../teams-and-roles/overview.md)
- [Analytics](../../marketing-and-automation/analytics/overview.md)
