---
sidebar_position: 1
title: Billing & Plans
description: How Aglyn's tiers, entitlements, quotas, usage meters, and seat add-ons work.
---

# Billing & Plans

Your **plan** determines which features you can use and how much of each. Aglyn checks
**entitlements** (can you use a feature) and **quotas** (how much) throughout the product,
and shows **usage meters** so you always know where you stand.

![The Billing page in the Aglyn console: the Current plan card with subscription status, Manage payment methods and Cancel subscription actions, beside the Usage card's meters](/img/billing-and-plans/billing-page.png)

:::info Plan availability
Every site has a plan. **Free**, **Starter**, **Pro**, **Business**, **Scale**, **Advanced**,
and **Agency** unlock progressively more, and **Enterprise** sits above them all.
:::

## Tiers & entitlements

:::tip Prices live on one page
Current prices — monthly, annual, transaction fees and per-unit overage rates —
are on **[aglyn.com/pricing](https://aglyn.com/pricing)**, and your own plan and
next invoice are in **Billing** in the console. This page explains how billing
WORKS; it deliberately does not restate the numbers, because a second copy is a
copy that goes stale.
:::

| Plan | Commerce |
|---|---|
| Free | Build & publish only — no selling |
| Starter | Sell products, with the highest transaction fee of the paid tiers |
| Pro | More products, a lower fee, POS, abandoned-cart recovery, reviews, dropshipping |
| Business | More products again, a lower fee, subscriptions & paywalls, gift cards |
| Scale | Higher product and site limits, lower fee again |
| Advanced | Unlimited products, no transaction fee, high-volume commerce & API |
| Agency | Many sites under one organization, white-label |
| Enterprise | Unlimited everything, SSO, white-label, no transaction fee |

Transaction fees are Aglyn platform fees on the sales you take through your site —
storefront orders, paid memberships and paid bookings alike — separate from
Stripe's payment-processing fees. Upgrading is the way to reduce them.

Every plan also includes an amount of monthly **traffic** — 5 GB on Free, rising to
unlimited on Enterprise. Passing it is metered and billed on a paid plan, and pauses the
site until the start of next month on Free. See [Bandwidth](bandwidth.md) for the table and
for what a paused site shows a visitor.

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
- Org admins also get an in-app **notification** when email sends, dataset count, data
  storage, or [bandwidth](bandwidth.md) crosses 80% or 100% — once per threshold per month,
  so nobody has to be watching the console to find out. The bandwidth message differs by
  plan, because what happens next differs by plan: paid organizations are told the extra is
  billed, Free organizations are told the site will be paused.
- The monthly email allowance caps **campaign sends**. Transactional mail — password
  resets, invites, order confirmations, booking reminders and workflow notifications — is
  counted toward your usage but is never blocked by the cap, at any plan. Going over shows
  up as an overage on the usage rollup rather than as mail your customers never receive.
- Usage is rolled up with a **cost-plus estimate** for metered features.

## Storage overage

Each site includes a fixed amount of storage. On a paid plan, going past it is **not** a
wall:

- **Uploads keep working.** You are never stopped from adding files because you reached
  your included storage.
- **The extra storage is billed** on your monthly invoice at our infrastructure cost
  plus 30% — the exact per-GB rate is on [the pricing page](https://aglyn.com/pricing)
  and in **Billing → Storage cap**.
- **We tell you before it happens.** You get an alert as you approach your included
  storage and another when you cross it, so the invoice is never the first you hear of
  it. See [usage meters](#usage-meters).

### If you would rather uploads stopped

Set a **monthly storage cap** in **Billing → Storage cap**. This is optional and off
unless you choose it. Once a month's storage overage would pass the amount you set,
new uploads are refused and you are never billed above that number.

You can change or remove the cap at any time, including while you are over your included
allowance. Nothing is ever deleted — a cap only affects *new* uploads, and removing one
takes effect immediately.

:::info Free plans are never billed for storage
On the Free plan there is no storage overage at all. Your included storage is a fixed
cap: uploads stop there, nothing is metered, and no amount of usage produces a charge —
so there is nothing to cap and nothing to configure. Enterprise storage is unlimited, so
it has no overage either.
:::

:::tip No surprise bills
Two things prevent one, and they work in different ways. The **alerts** at 80% and 100%
of your allowance mean nobody first learns about overage from an invoice. The optional
**cap** means anyone who wants a hard ceiling can have one, at a number they choose.
:::

## Usage budget

A **usage budget** is a monthly amount you choose, plus the percentages of it you want to
hear about — the same shape as a Google Cloud billing budget. Set it in
**Billing → Monthly usage budget**.

- **It warns, it never limits.** Passing a budget sends a notification and an email.
  Nothing stops, no upload is refused, and your bill is unaffected. If you want usage to
  actually stop, that is the [storage cap](#storage-overage) above — a different control,
  deliberately kept separate.
- **You choose the alert points.** The default is **50%, 90% and 100%**; you can set your
  own, including percentages above 100 so a runaway month keeps speaking. Up to six.
- **One alert per percentage per month.** Crossing 50% tells you once, not once an hour.
  Climbing to the next percentage alerts again, and every percentage resets when the month
  does.
- **Both channels.** Alerts arrive in the console notification menu **and** by email to
  your workspace owners and admins, so you do not have to be signed in to find out.
- **The figure is the invoice's own.** Budget alerts quote the same metered total the
  billing page shows and the invoice charges — totalled once a day, so the first days of a
  month may show no total yet.

Changing the amount clears the alert history for the month, so a budget you lower starts
warning you against the new number straight away.

## Seats

- **Team seats** (workspace-wide) and per-site **collaborator seats** are metered and
  enforced per tier — seats cover the people who build and manage your sites.
- Buy **paid seat add-ons** to grow your team beyond the included seats —
  self-serve from [Billing → Add-ons](add-ons.md), alongside extra sites,
  datasets, POS registers, and the Event Calendar.
- **Site member accounts are not seats**: visitors who sign up to your published
  site are unlimited on every plan.

## Audience (contacts)

:::caution Rolling out
The **[Contacts page](../../content-and-data/contacts/overview.md)** in the console
isn't available yet. Contacts are still captured from your sites and readable over the
[REST API](/api/resources/contacts), and the Free band below still applies — but while
the page is unavailable, **paid audience overage is not billed**. The rates below are
what will apply once Contacts opens.
:::

Your **contacts CRM** — form fills, member sign-ups, buyers, and bookings unified into
one people list — is priced as an **audience band**, not a hard cap:

- Each tier includes a band: Free 100, Starter 1,000, Pro 10,000, Business 50,000,
  Scale 100,000, Advanced 150,000, Agency 500,000 contacts. Enterprise is unlimited.
- On **paid tiers**, growing past the band never blocks or drops anything — extra
  contacts are **metered overage** on your monthly invoice, at a per-1,000 rate that
  falls as you move up the plans — see [pricing](https://aglyn.com/pricing) for the
  current rate on your plan, per extra 1,000
  contacts per month. Upgrading a tier is always cheaper than sustained overage.
- On **Free**, the band is a hard limit: new visitors past 100 keep their member
  accounts and orders, but no CRM record is kept. The count of missed sign-ups is
  recorded and will be shown on the contacts page once it opens.
- **The billed count is your list size at the end of the month**, not its size on any
  other day. Your list is a running total rather than a monthly tally, so a month has
  to be charged on one moment in it, and that moment is the last daily reading taken
  before the month closes. Contacts added after a month ends belong to the new month;
  contacts deleted after it ends do not undo the month that already ran.

## Organization data

- **Datasets are organization-scoped**: counts and storage meter against your
  organization, not individual sites.
- Each paid tier includes a number of datasets and an included **data storage** size
  (Starter 1 GB, Pro 5 GB, Business 25 GB, Scale 50 GB, Advanced 100 GB, Agency 500 GB).
- Extra datasets are a monthly **[add-on](add-ons.md)** whose price falls as you move up
  the plans; storage beyond the included size is **metered overage**, billed per
  GB-month on your monthly invoice.
- **The billed size is what you were storing at the end of the month**, on the same
  basis as the audience band above: the last daily reading taken before the month
  closes. Clearing datasets after a month has ended lowers the next invoice, not the
  one for the month that just finished.

## API access

The **customer REST API** is a **Business tier and above** feature — mint scoped API keys
and call the versioned `/v1` endpoints from anywhere. Requests are **metered per
organization**:

| Plan | Included requests / month | Overage |
|---|---|---|
| Business | 100,000 | Metered per additional 1,000 |
| Scale | 300,000 | Metered, at a lower rate than Business |
| Advanced | 1,000,000 | Metered, lower again |
| Agency | 5,000,000 | Metered, the lowest per-unit rate |
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

Your billing details live on the **Billing** page in the console, one card per thing you
might want to change. Each card saves on its own, so editing your address never touches
your tax ID and vice versa.

### Paying an outstanding invoice {#outstanding}

If a payment fails, the invoice stays **open** and the Billing page shows it with a
**Pay now** button.

- **It works even if the subscription has already been cancelled.** Dunning cancels
  subscriptions after enough failed retries; the invoice is still owed and still
  payable, and paying it does not require a plan.
- **Your bank may ask you to confirm the payment.** That step is your bank's, not
  ours, and it appears for the same reason it does anywhere else.
- **We do not mark it paid because the button worked.** The invoice updates when
  Stripe confirms the money arrived, so what you see is the settled state rather
  than an optimistic one.
- The amount is the amount the invoice was issued for. Tax on an invoice is fixed
  when it is issued and is never recalculated later.

### What a plan will cost {#plan-total}

Before you subscribe, the Billing page quotes the plan you are looking at with tax
included, taken from Stripe's own invoice preview rather than worked out here.

- **A total is only shown as final once tax has been calculated**, which needs your
  billing address. Until then the page says so rather than showing a total that
  quietly leaves tax out.
- **A zero tax is explained**, because a zero has several meanings: reverse charge
  applies and you account for the tax under your own registration; your account is
  registered as tax-exempt; or nothing is charged in your location.
- **Promotion codes are applied here.** An invalid or expired code is refused
  immediately, with the reason — not at the moment you are charged.

### Billing email {#billing-email}

**Invoices are sent to the billing email**, along with receipts and — the one that
matters most — the notices we send when a card fails and a subscription is about to
lapse.

- It is **not the same field as your organization's contact email**. The contact email is
  the workspace's public-facing address; it appears on your marketplace profile. The
  billing email is where the money mail goes, and most teams want that to be an
  accounting inbox rather than a published one.
- Until you subscribe, invoices go to the address on the account that signed up. Once
  you are on a paid plan you can send them somewhere else.

### Payment methods {#payment-methods}

The cards your subscription and any usage overage are charged to.

- **Add new card** opens **Stripe's own form**. Card numbers are typed into Stripe and
  go to Stripe — they never reach Aglyn's servers or logs, which is also why the form
  looks like Stripe's rather than ours.
- The **default** method is the one your next renewal charges. Changing it here updates
  the subscription as well as the customer record, so the change applies to the next
  invoice rather than only to one-off charges.
- **You cannot remove the last card while a subscription renews against it.** Doing so
  would not cancel anything — it would make the renewal fail weeks later, with a dunning
  email as the first sign. Add a replacement first, or cancel the subscription if that
  is what you meant.
- Wallets and Link appear here too, identified by email rather than by a card number.

### Billing address {#billing-address}

The address Aglyn issues **your** invoices to, and the address sales tax on your Aglyn
subscription is calculated from.

- **This page is where you edit it.** It also appears, read-only, on **Settings →
  Profile**, which links back here. One address, one place to change it.
- **It is not your payout address.** Money that flows *out* to you from marketplace or
  storefront sales is keyed by the identity Stripe holds for your connected account,
  which you set up under **Marketplace → Payouts**.
- **It is not your storefront's tax origin either.** Sales tax on orders *your* buyers
  place is calculated from the origin set per site in **Commerce → Settings → Taxes**.
- **It can be replaced but not emptied.** A workspace with no billing address cannot have
  tax calculated at all, so clearing the form is refused rather than obeyed; an
  addressless invoice in front of a tax authority is a worse outcome than a stale one.
- Changing it affects your **next** invoice. Invoices already issued are never re-rated.

### Tax IDs {#tax-ids}

A business tax ID — VAT, ABN, GST, EIN and the rest — printed on the invoices we issue
you.

- Choose the **type** and enter the value. The type is country-specific and decides how
  the number is printed and how a tax authority reads it, so the picker is searchable:
  type your country, the abbreviation, or the code your accountant gave you.
- The list of types is **Stripe's own** and is refreshed with the Stripe library, so a
  jurisdiction Stripe adds shows up without waiting on us.
- **Stripe validates the number** against the rules for the type you picked, and if it
  refuses you will see Stripe's own explanation of the format it expected. We do not
  second-guess it — a check of ours would eventually refuse a number that is perfectly
  valid.
- Some types are verified asynchronously; a number still being checked, or one that came
  back unverified, says so beside itself rather than looking accepted.
- Removing a tax ID stops it appearing on **future** invoices. Invoices already issued
  are unchanged — a finalized invoice is a record, not a document that gets edited.

### Sales tax {#sales-tax}

**Plan prices are quoted before tax.** Where Aglyn has a tax collection obligation,
sales tax is added on top at checkout and on every renewal, and appears as its own
line on the invoice.

- **Tax is calculated from the billing address on your workspace**, not from your
  card's country and not from your personal address. It is computed automatically at
  the moment each invoice is created, so moving your workspace changes the tax on
  your *next* invoice rather than re-rating past ones.
- **A workspace with no billing address cannot have tax calculated at all**, which is
  why the address can be replaced but not emptied — see the address bullets below.
- **Adding a business tax ID** (VAT, ABN, EIN and the like) puts it on the invoice.
  That's what makes an invoice usable for reclaiming tax or handing to an accountant,
  and in some jurisdictions it changes who accounts for the tax. Checkout collects one
  at purchase; the [Tax IDs](#tax-ids) card is where you add, change or remove one
  afterwards.
- **Every invoice states the tax separately** from the amount charged, so the figure
  you reclaim is never one you have to back out of a total yourself. Invoice PDFs and
  receipts are on the Billing page's **Billing history** table.
- **Marketplace plugin purchases** are taxed the same way, and **Aglyn collects and
  remits that tax as the marketplace provider** — the plugin's publisher does not
  charge you tax separately, and you should not receive two tax charges for one
  plugin purchase. If you ever do, that's a bug worth reporting.

Sales tax on **your own** storefront's sales to **your** customers is a separate
charge from the tax on your Aglyn invoice, and it is allocated by Terms of
Service §10.7: for storefront sales Aglyn acts as a **marketplace facilitator**,
so where applicable law gives Aglyn a collection obligation Aglyn calculates,
collects and remits that tax itself — added on top at checkout, and never
transferred to your connected payment account. Flat rates you configure yourself
(lodging, service and similar) stay yours to set and to remit. See
[Shipping &amp; taxes](../../commerce-and-bookings/commerce/overview.md#shipping--taxes).

### Platform fees

Sales you take through your site carry a **declining platform fee** on top of Stripe's
processing fee — higher tiers reduce it to 0%, which is the upgrade motion for sellers:

| Plan | Physical goods | Digital goods, memberships & bookings |
|---|---|---|
| Starter | 2% | 5% |
| Pro | 0% | 3% |
| Business | 0% | 2% |
| Scale | 0% | 1% |
| Advanced | 0% | 0% |
| Agency | 0% | 0% |
| Enterprise | 0% | 0% |

Paid **memberships, gated content and bookings** bill at the digital rate — the fee is
applied at checkout as the Stripe Connect application fee, on one-time sales and
recurring member subscriptions alike. A paid booking is a service sale and sits on
that same digital line rather than carrying a rate of its own; see
[Bookings](../../commerce-and-bookings/bookings/overview.md#payments-and-fees).
Selling requires a paid plan with commerce.

**In-person sales carry the same rate.** The fee is charged on the sale, not on the
tender, so a cash sale or a charge-to-room sale at the register is priced exactly like
a card sale. Card sales have the fee deducted from the Stripe payout; cash and
room-charge sales have no payout to deduct from, so their fees are added to your next
monthly invoice as a usage line. See
[POS &amp; reservations](../../commerce-and-bookings/commerce/pos-and-reservations.md#platform-fees-at-the-register).

- **Annual billing** — a toggle on the plan cards; annual billing is the discounted
  headline price (annual billing costs less per month than month-to-month; the two
  figures for your plan are on [pricing](https://aglyn.com/pricing)).
- **Plan switches** on an active subscription apply in place (no second checkout), and
  show you what's due before you confirm. **Upgrades** apply immediately and preview a
  **prorated** charge for the rest of the period. **Downgrades** take effect at the
  **end of the current period** and preview **$0 due today** plus the effective date —
  see [when each change takes effect](./downgrading-and-canceling.md#when-changes-take-effect).
- **Cancel any time** — the subscription runs to the end of the paid period; a warning
  chip shows the end date and you can resume before it hits. Cancel opens a short
  dialog that may offer you a smaller plan or a time-boxed discount first;
  [what the Cancel button actually opens](./downgrading-and-canceling.md#the-cancel-dialog)
  walks through every step of it.
- **Invoices & receipts** — the billing page's **Billing history** table lists every
  invoice with its date, status, and amount. Each row links to the **Stripe-hosted
  invoice** (View), a **PDF download** of the invoice, and the payment **Receipt** once
  it's paid — everything you need for expense reports and bookkeeping. Older invoices
  load on demand.
- **Changing your billing address** — edit it under **Billing → Settings**. It is
  the workspace's address, kept separate from the personal address on your own
  Manage Account page: the workspace's is what appears on invoices, and yours is
  visible only to you and to Aglyn staff. Saving pushes the change to the payment
  processor, so a workspace that moves gets the new address on its *next*
  invoice rather than keeping the one captured at signup. **Settings → Profile**
  shows the same address without letting you edit it there — a tax input with
  two forms behind it is a form that silently undoes the other one.
- **Clearing the address does not remove it from your invoices.** An invoice with
  no address on it cannot have tax calculated, so emptying those fields is not
  treated as an instruction to strip the address from your billing account — the
  one already on file keeps being used. When the two differ, **Settings → Profile**
  says so, and the same warning appears if a change ever fails to reach the
  payment processor. To *replace* the address, enter the new one under
  **Billing → Settings** and save; there is no supported way to leave a paying
  workspace with no billing address at all.
- **Billing details at checkout** — checkout asks for a **billing address**, a
  **phone number**, and optionally a **business tax ID** (VAT, ABN, EIN and the like).
  The address and tax ID appear on the invoice, which is what makes it usable for
  reclaiming tax or filing it with an accountant. Previously an address was collected
  only when the card happened to require one, and the phone and tax ID never were.
- **Manage payment methods** opens the Stripe **Billing Portal** — update cards, view
  receipts, and set tax details there. It works even after a subscription lapses.
- If a payment fails, the console shows a **past-due banner** while Stripe retries;
  access continues while you fix the card, and entitlements only downgrade if the
  subscription dies.
- **What happens after a failed payment.** Stripe retries the charge automatically,
  several times over a period of weeks. Your plan keeps working throughout — a
  past-due banner appears in the console, and nothing is switched off while the
  retries are still running. If every retry fails, the subscription ends and the
  workspace moves to **Free**; the console notifies the workspace's owners and admins
  when that happens. **Paying the outstanding invoice at any point beforehand
  restores the plan with no further action**, and you can update your card at any
  time from **Manage payment methods**, which keeps working even after a
  subscription lapses.
- **A shortcut straight to billing: `app.aglyn.com/billing`.** It doesn't name a
  workspace, so it's safe to bookmark or to follow from an email. Sign in and it
  takes you to your workspace's Billing page; if you manage several, it asks which
  one. It keeps working while a workspace is past due or suspended for non-payment —
  a lock over an unpaid bill must never be the thing that stops you paying it.
- **We don't quote you an exact number of retries or days**, and that is deliberate.
  The retry schedule is a Stripe-side setting rather than something Aglyn controls or
  can read back, so any specific figure we printed here would be one we could not
  guarantee. If you need the exact schedule for your account, the invoice in your
  Stripe billing portal shows the next scheduled attempt.

## Related

- [Add-ons](add-ons.md)
- [Teams, roles & membership](../teams-and-roles/overview.md)
- [Analytics](../../marketing-and-automation/analytics/overview.md)
