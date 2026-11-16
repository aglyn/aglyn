---
sidebar_position: 20
title: Connect QuickBooks Online
description: Post every sale, refund, Aglyn fee and Stripe payout from your store to QuickBooks Online, mapped to the accounts you choose.
---

# Connect QuickBooks Online

Connect your QuickBooks Online company and Aglyn posts your store's money to it
as it happens: each paid order, each refund, the Aglyn fee on each sale, and
each Stripe payout to your bank. You choose the accounts; Aglyn never creates
accounts in your chart.

Accounting comes with every plan that includes selling online, at no extra
cost. Connecting or changing it takes the **Manage accounting** permission, which
organization owners and admins hold by default.

## Before you start

You need:

- A QuickBooks Online company, and a login that can approve app connections
  for it.
- In that company's chart of accounts:
  - an **income** account for sales (and, if you want shipping separate, one
    for shipping income);
  - a **bank** account that stands for your Stripe balance — the **Stripe
    clearing** account. Create one named, for example, "Stripe clearing" if you
    do not have one;
  - an **expense** account for Aglyn's fees;
  - the **bank** account your Stripe payouts land in.
- If you charge sales tax, sales tax set up in that QuickBooks company
  (**Taxes** in QuickBooks). Until it is, a US company's sales that carry tax
  wait under **Needs attention**, because QuickBooks would otherwise record
  them without their tax.

## Connect

1. Open your organization, then **Accounting → Connection**.
2. Select **Connect QuickBooks Online**. QuickBooks asks you to sign in and to
   choose the company to connect.
3. Approve the connection. You come back to the Accounting page, which shows
   the company's name.

A connection made against a QuickBooks **sandbox** company shows a **Sandbox
company** label.

## Choose your accounts

Under **Accounts and tax**, pick:

| Setting | What it is for |
| -- | -- |
| **Sales income** | Where item sales are recorded. |
| **Shipping income** | Where shipping you charge is recorded. Leave it empty to use sales income. |
| **Stripe clearing account** | Every sale is paid into it and every payout leaves it, so it returns to zero with each payout. |
| **Aglyn fee expense** | Where the Aglyn fee on each sale is recorded. |
| **Payout bank account** | The bank account Stripe pays out to. |
| **Tips** | Where tips taken at the register are recorded. Leave it empty to use sales income; tips your staff are owed belong in a liability account. |
| **Cash and other payments** | A bank account for money that does not go through Stripe: cash at the register, room charges, and sales on a marketplace. Needed once one of those sales arrives. |
| **Gift card liability** | Where gift cards you sell are owed until they are spent. Needed once a gift card is sold or spent. |
| **Sales tax codes** | The QuickBooks tax code for orders with sales tax, and for orders without. |

Then choose how sales are posted, set a **Start date**, and select **Save**.
Nothing is posted until the accounts are chosen.

The first time you save, Aglyn adds two service items to your QuickBooks
products and services — **Aglyn sales** and **Aglyn shipping** — that post to
the income accounts you chose. Sales receipts name them on each line. Choosing a
tips account or a gift card liability adds **Aglyn tips** or **Aglyn gift
cards** the same way.

## What is posted

| In Aglyn | In QuickBooks Online |
| -- | -- |
| A paid order | A **sales receipt**: one line per item, shipping, any discount and the sales tax, deposited to the Stripe clearing account. |
| A refund | A **refund receipt** paid out of the Stripe clearing account, with the tax given back in proportion. |
| The Aglyn fee on a sale | An **expense** from the Stripe clearing account to the fee expense account. |
| A Stripe payout | A **transfer** from the Stripe clearing account to the payout bank account. |
| A sale paid in cash, by room charge or on a marketplace | Its sales receipt, then a **transfer** of that share from the Stripe clearing account to the cash and other payments account. |

Each sales receipt's number is the order's number with a short code for the
site in front of it, so two sites' order #1042 are two receipts.

### How each payment is posted

Every sale is deposited to the Stripe clearing account, so receipts read the
same whatever paid them. What did not come through Stripe then moves on:

- **Card**, online or at the register: stays in clearing until Stripe pays it
  out. Only the Aglyn fee Stripe took is posted as an expense.
- **Cash** and **room charges** at the register, and a **marketplace's** sale:
  a transfer moves that share to the cash and other payments account. A
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

Choose **One summary journal entry per day** to post one **journal entry** per
day instead of a receipt per order. It carries the day's sales, shipping,
refunds, sales tax and fees in totals, and needs one more account: **Sales tax
liability**. A day is posted after it ends in the time zone you set. Payouts are
still posted one by one.

### Currency

A sale in your company's home currency names no currency. A sale in another
currency names it, which QuickBooks accepts only when **multicurrency** is on
in your company's settings; otherwise the sale waits under **Needs attention**.

## Sales before you connected

Set a **Start date** before the day you connected, and Aglyn posts the sales,
fees and refunds from that day on, a page at a time over the next while. Payouts
from the start date on are posted too. Sales already posted are never posted
twice.

## When something does not post

**Accounting → Sync activity** lists everything posted, waiting or skipped.
**Needs attention** shows what QuickBooks refused, with its reason — an account
made inactive, a closed period, a currency the company does not use. Fix the
cause in QuickBooks or in your account choices, then select **Retry** on the
item, or **Retry all**.

A failure on QuickBooks' side, or its rate limit, is retried on its own, waiting
longer each time, before it is listed under Needs attention.

## Disconnect

Select **Disconnect**. Aglyn revokes its access to your company at Intuit and
stops posting. What was already posted stays in QuickBooks, and the sync history
stays in Aglyn, so reconnecting the same company later does not post anything a
second time.

If QuickBooks stops accepting the connection — it was disconnected from
QuickBooks' side, or left unused for over 100 days — the page shows **Reconnect
required**. Nothing is lost: what is waiting posts once you reconnect.
