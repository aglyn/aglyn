---
sidebar_position: 21
title: Connect Xero
description: Post every sale, refund, Aglyn fee and Stripe payout from your store to Xero, mapped to the accounts you choose. Rolling out.
unlisted: true
---

# Connect Xero

:::caution Rolling out
Accounting is a **release-flagged feature** that is **not yet available** on
aglyn.com-hosted workspaces. Until it is switched on for your workspace, the
**Accounting** tab does not appear in your organization.
:::

Connect your Xero organization and Aglyn posts your store's money to it as it
happens: each paid order, each refund, the Aglyn fee on each sale, and each
Stripe payout to your bank. You choose the accounts; Aglyn never creates
accounts in your chart.

Accounting comes with every plan that includes selling online, at no extra
cost. Connecting or changing it takes the **Manage accounting** permission, which
organization owners and admins hold by default.

## Before you start

You need:

- A Xero organization, and a Xero login that can connect apps to it.
- In its chart of accounts:
  - a **revenue** account for sales (and, if you want shipping separate, one
    for shipping);
  - a **bank** account that stands for your Stripe balance — the **Stripe
    clearing** account. In Xero, add a bank account named, for example, "Stripe
    clearing" if you do not have one;
  - an **expense** account for Aglyn's fees;
  - the **bank** account your Stripe payouts land in.

## Connect

1. Open your organization, then **Accounting → Connection**.
2. Select **Connect Xero**. Xero asks you to sign in and to allow access.
3. If your login reaches more than one Xero organization, choose the one to use
   and select **Use this organization**.

## Choose an organization {#choose-an-organization}

When your Xero login reaches more than one organization, the Accounting page asks
which one this workspace posts to: pick it and select **Use this organization**.

Nothing is posted until you choose. Every paid order, refund, fee and payout of
the workspace then goes to that organization.

## Choose your accounts

Under **Accounts and tax**, pick the **Sales income**, **Shipping income**
(optional), **Stripe clearing account**, **Aglyn fee expense** and **Payout
bank account**, and the Xero **tax rate** for orders with sales tax and for
orders without. Then choose how sales are posted, set a **Start date**, and
select **Save**. Nothing is posted until the accounts are chosen.

Three more are asked for only when your sales need them:

- **Tips**: where tips taken at the register are recorded. Left empty, sales
  income; tips your staff are owed belong in a liability account.
- **Cash and other payments**: a bank account for money that does not go
  through Stripe — cash at the register, room charges, and sales on a
  marketplace.
- **Gift card liability**: where gift cards you sell are owed until they are
  spent.

## What is posted

| In Aglyn | In Xero |
| -- | -- |
| A paid order | An approved **sales invoice** — one line per item, shipping, any discount, with the order's own tax on each line — and a **payment** of the whole amount into the Stripe clearing account. |
| A refund | An approved **credit note**, refunded out of the Stripe clearing account, with the tax given back in proportion. |
| The Aglyn fee on a sale | A **spend money** transaction from the Stripe clearing account to the fee expense account, paid to a contact named **Aglyn**. |
| A Stripe payout | A **bank transfer** from the Stripe clearing account to the payout bank account. |
| A sale paid in cash, by room charge or on a marketplace | Its invoice and payment, then a **bank transfer** of that share from the Stripe clearing account to the cash and other payments account. |

Each invoice's number is the order's number with a short code for the site in
front of it, so two sites' order #1042 are two invoices. A customer with an
email address is filed under their own Xero contact, found by that address or
added; a sale with no name or address is filed under **Online customer**.

### How each payment is posted

Every sale is paid into the Stripe clearing account, so invoices read the same
whatever paid them. What did not come through Stripe then moves on:

- **Card**, online or at the register: stays in clearing until Stripe pays it
  out. Only the Aglyn fee Stripe took is posted.
- **Cash** and **room charges** at the register, and a **marketplace's** sale:
  a bank transfer moves that share to the cash and other payments account. A
  marketplace collects and remits its own sales tax, so its sales post without
  tax.
- **A gift card spent**, at the register or online: a line takes it off the
  gift card liability, since the card was paid for when it was sold. **A gift
  card sold** is a line on that liability too, untaxed, not a sale.
- **Store credit** (rewards or referral credit): a discount on the sale.
- **A tip**: its own untaxed line, to the tips account.

A refund comes back the same way, in proportion to how the sale was paid. A
sale made with Stripe in **test mode** is never posted.

### Sales tax collected by Aglyn

On a store that uses **Stripe Tax**, Aglyn posts those sales without the tax,
and refunds only your share of what went back to the buyer. On a
platform-managed (Express) account, set up before stores got their own Stripe
account, that tax is collected and remitted by Aglyn as the marketplace
facilitator and never reaches your Stripe account. Sales taxed at your own rate
post their tax as usual.

### One summary a day instead

Choose **One summary journal entry per day** to post one **manual journal** per
day instead of an invoice per order. It carries the day's sales, shipping,
refunds, sales tax and fees in totals, and needs one more account: **Sales tax
liability**. A day is posted after it ends in the time zone you set. Payouts are
still posted one by one.

### Currency

Each invoice names the order's currency. Xero accepts a currency other than
your organization's base currency only when that currency is added in your
Xero settings; otherwise the sale waits under **Needs attention**.

## Sales before you connected

Set a **Start date** before the day you connected, and Aglyn posts the sales,
fees and refunds from that day on, a page at a time. Payouts from the start date
on are posted too. Sales already posted are never posted twice.

## When something does not post

**Accounting → Sync activity** lists everything posted, waiting or skipped.
**Needs attention** shows what Xero refused, with its reason. Fix the cause in
Xero or in your account choices, then select **Retry** on the item, or **Retry
all**.

Xero allows an app 60 requests a minute and 5,000 a day for each organization.
Aglyn paces itself under both, so a busy day's sales may take a little longer
to appear; a request Xero turns away is retried on its own, waiting longer each
time.

## Disconnect

Select **Disconnect**. Aglyn removes its connection to your Xero organization,
revokes its access, and stops posting. What was already posted stays in Xero,
and the sync history stays in Aglyn, so reconnecting the same organization later
does not post anything a second time.

If Xero stops accepting the connection — it was disconnected from Xero's side,
or left unused for over 60 days — the page shows **Reconnect required**. What is
waiting posts once you reconnect.
