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
Every site has a plan. **Free**, **Starter**, **Pro**, **Business**, **Scale**, **Advanced**,
and **Agency** unlock progressively more, and **Enterprise** sits above them all.
:::

## Tiers & entitlements

| Plan | Billed annually | Month-to-month | Commerce |
|---|---|---|---|
| Free | $0 | $0 | Build & publish only — no selling |
| Starter | $16/mo | $25/mo | Sell up to 100 products; 2% fee on physical, 5% on digital sales |
| Pro | $39/mo | $56/mo | 2,500 products, 0% physical / 3% digital fees, POS, abandoned-cart recovery, reviews, dropshipping |
| Business | $99/mo | $139/mo | 10,000 products, 0% / 2% fees, subscriptions & paywalls, gift cards |
| Scale | $179/mo | $249/mo | 25,000 products, 0% / 1% fees, 15 sites |
| Advanced | $299/mo | $399/mo | Unlimited products, 0% / 0% fees, high-volume commerce & API |
| Agency | $649/mo | $799/mo | 100 sites under one organization, white-label |
| Enterprise | Custom | Custom | Unlimited everything, SSO, white-label, 0% fees |

Transaction fees are Aglyn platform fees on storefront sales, separate from
Stripe's payment-processing fees. Upgrading is the way to reduce them.

### Enterprise

**Enterprise** is the one tier you cannot buy from the Billing page. It has no list
price — the plan, term, and invoicing are agreed with us, and we provision the
organization directly. On top of everything in Agency it lifts every quota to
unlimited and adds **SAML / OIDC single sign-on**, so your team signs in through your
own identity provider.

To start a conversation, use the **Contact sales** button on the Enterprise card at the
bottom of your Billing page. Once your organization is on Enterprise, plan changes go
through us rather than the self-serve upgrade and downgrade buttons.

#### Single sign-on and enforcement

Your people sign in through your identity provider. While SSO is on but **not enforced**,
any sign-in method someone already had — a password, a linked Google account — keeps
working, so nobody is locked out during rollout. New ones cannot be added: an account
governed by your IdP is not offered "Continue with Google".

**Turning on enforcement removes those other methods.** For every account in your
organization's identity tenant, we unlink every sign-in method that is not your IdP and
end that person's existing sessions, so access flows through your IdP from that moment —
including when you revoke it there. Affected people are notified in the console that their
sign-in methods changed.

Two things worth knowing before you ask us to switch it on:

- It applies to everyone in the tenant at once, and to anyone who joins afterwards.
- An account whose *only* sign-in method is not your IdP is left alone rather than
  stripped, because removing it would leave an account nobody could reach. Those are
  reported to us so they can be fixed rather than silently skipped.

Enforcement is switched on by us, at your request.

:::note Pricing is provisional (pre-release)
Aglyn is in pre-release: prices, plans, tiers, quotas, and the features included in each
tier are provisional and may change at any time — including for existing subscribers.
Nothing here guarantees that a price or feature set will remain the same.
:::

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
- The monthly email allowance caps **campaign sends**. Transactional mail — password
  resets, invites, order confirmations, booking reminders and workflow notifications — is
  counted toward your usage but is never blocked by the cap, at any plan. Going over shows
  up as an overage on the usage rollup rather than as mail your customers never receive.
- Usage is rolled up with a **cost-plus estimate** for metered features.

## Seats

- **Team seats** (workspace-wide) and per-site **collaborator seats** are metered and
  enforced per tier — seats cover the people who build and manage your sites.
- Buy **paid seat add-ons** to grow your team beyond the included seats —
  self-serve from [Billing → Add-ons](add-ons.md), alongside extra sites,
  datasets, POS registers, and the Event Calendar.
- **Site member accounts are not seats**: visitors who sign up to your published
  site are unlimited on every plan.

## Audience (contacts)

Your **contacts CRM** — form fills, member sign-ups, buyers, and bookings unified into
one people list — is priced as an **audience band**, not a hard cap:

- Each tier includes a band: Free 100, Starter 1,000, Pro 10,000, Business 100,000,
  Scale 500,000, Advanced 1,000,000 contacts. Agency and Enterprise are unlimited.
- On **paid tiers**, growing past the band never blocks or drops anything — extra
  contacts are **metered overage** on your monthly invoice: $1.00 (Starter), $0.75
  (Pro), $0.50 (Business), $0.40 (Scale), or $0.25 (Advanced) per extra 1,000
  contacts per month. Upgrading a tier is always cheaper than sustained overage.
- On **Free**, the band is a hard limit: new visitors past 100 keep their member
  accounts and orders, but no CRM record is kept — the contacts page shows how many
  were missed so you can upgrade before it matters.

## Organization data

- **Datasets are organization-scoped**: counts and storage meter against your
  organization, not individual sites.
- Each paid tier includes a number of datasets and an included **data storage** size
  (Starter 1 GB, Pro 5 GB, Business 25 GB, Scale 50 GB, Advanced 100 GB, Agency 500 GB).
- Extra datasets are a monthly **[add-on](add-ons.md)** ($2/mo on Starter and Pro, $1/mo
  on Business); storage beyond the included size is **metered overage** at $0.25 per
  GB-month on your monthly invoice.

## API access

The **customer REST API** is a **Business tier and above** feature — mint scoped API keys
and call the versioned `/v1` endpoints from anywhere. Requests are **metered per
organization**:

| Plan | Included requests / month | Overage |
|---|---|---|
| Business | 100,000 | $0.50 per additional 1,000 |
| Scale | 300,000 | $0.35 per additional 1,000 |
| Advanced | 1,000,000 | $0.20 per additional 1,000 |
| Agency | 5,000,000 | $0.15 per additional 1,000 |
| Enterprise | Unlimited | — |

- Requests past the included quota **keep working** and bill as metered overage on your
  monthly invoice — never a hard wall mid-integration.
- The billing page shows an **API requests** meter, and the usage-cap banner warns at 80%
  and 100% of the included quota.
- Only requests that pass authentication and the rate limit are counted — rejected calls
  (bad key, wrong plan, rate-limited) are never billed.

## Payments

Billing runs through **Stripe**. Paid features (commerce, bookings, campaigns) share the
same Stripe integration.

### Platform fees

Storefront sales carry a **declining platform fee** on top of Stripe's processing fee —
higher tiers reduce it to 0%, which is the upgrade motion for sellers:

| Plan | Physical goods | Digital goods & paid memberships |
|---|---|---|
| Starter | 2% | 5% |
| Pro | 0% | 3% |
| Business | 0% | 2% |
| Scale | 0% | 1% |
| Advanced | 0% | 0% |
| Agency | 0% | 0% |
| Enterprise | 0% | 0% |

Paid **memberships and gated content** bill at the digital rate — the fee is applied at
checkout as the Stripe Connect application fee, on one-time sales and recurring
member subscriptions alike. Selling requires a paid plan with commerce.

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
- **Changing your billing address** — edit it under **Settings → Profile**. It is
  the workspace's address, kept separate from the personal address on your own
  Manage Account page: the workspace's is what appears on invoices, and yours is
  visible only to you and to Aglyn staff. Saving pushes the change to the payment
  processor, so a workspace that moves gets the new address on its *next*
  invoice rather than keeping the one captured at signup.
- **Clearing the address does not remove it from your invoices.** An invoice with
  no address on it cannot have tax calculated, so emptying those fields is not
  treated as an instruction to strip the address from your billing account — the
  one already on file keeps being used. When the two differ, **Settings → Profile**
  says so, and the same warning appears if a change ever fails to reach the
  payment processor. To *replace* the address, enter the new one and save; there
  is no supported way to leave a paying workspace with no billing address at all.
- **Billing details at checkout** — checkout asks for a **billing address**, a
  **phone number**, and optionally a **business tax ID** (VAT, ABN, EIN and the like).
  The address and tax ID appear on the invoice, which is what makes it usable for
  reclaiming tax or filing it with an accountant. Previously an address was collected
  only when the card happened to require one, and the phone and tax ID never were.
- **Manage payment methods** opens the Stripe **Billing Portal** — update cards, view
  receipts, and set tax details there. It works even after a subscription lapses.
- If a payment fails, the console shows a **past-due banner** during Stripe's retry
  window; access continues while you fix the card, and entitlements only downgrade if
  the subscription dies.

## Related

- [Add-ons](add-ons.md)
- [Teams, roles & membership](../teams-and-roles/overview.md)
- [Analytics](../../marketing-and-automation/analytics/overview.md)
