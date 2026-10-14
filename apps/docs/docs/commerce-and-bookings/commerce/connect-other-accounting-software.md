---
sidebar_position: 22
title: Connect other accounting software
description: Post every sale, refund, Aglyn fee and Stripe payout from your store to accounting software other than QuickBooks Online or Xero, such as QuickBooks Desktop, NetSuite, Sage, FreshBooks, Zoho Books or Wave. Rolling out.
unlisted: true
---

# Connect other accounting software

:::caution Rolling out
Accounting is a **release-flagged feature** that is **not yet available** on
aglyn.com-hosted workspaces. Until it is switched on for your workspace, the
**Accounting** tab does not appear in your organization.
:::

When your books are not in QuickBooks Online or Xero, **Connect other
accounting software** links them through Codat, a service that connects to
accounting software such as QuickBooks Desktop, NetSuite, Sage, FreshBooks,
Zoho Books and Wave. Aglyn then posts your store's money to your books as it
happens: each paid order, each refund, the Aglyn fee on each sale, and each
Stripe payout to your bank. You choose the accounts; Aglyn never creates
accounts in your chart.

Only an organization **owner or admin** (anyone whose role includes **Manage
accounting**) can connect or change it. For QuickBooks Online or Xero, use
[Connect QuickBooks Online](./connect-quickbooks-online.md) or
[Connect Xero](./connect-xero.md) instead.

## Before you start

You need a login to your accounting software that can approve a connection,
and in its chart of accounts:

- an **income** account for sales (and, if you want shipping separate, one for
  shipping income);
- a **bank** account that stands for your Stripe balance, the **Stripe
  clearing** account. Create one named, for example, "Stripe clearing" if you
  do not have one;
- an **expense** account for Aglyn's fees;
- the **bank** account your Stripe payouts land in.

## Connect {#connect}

The **Connect your books** card links your accounting software: select
**Connect other accounting software**, pick your software on the page that
opens, and sign in to it there.

1. Open your organization, then **Accounting → Connection**.
2. Select **Connect other accounting software**.
3. On the page that opens, choose your accounting software and sign in to it.
   Your login is kept by Codat, not by Aglyn.
4. You come back to the Accounting page, which names your company and its
   software.

## Choose your books {#choose-your-books}

When the connection links more than one set of books, the **Choose your
books** card asks which one this workspace posts to: pick it and select **Use
these books**.

Nothing is posted until you choose. Every paid order, refund, fee and payout of
the workspace then goes to those books.

## Choose your accounts {#choose-your-accounts}

The **Accounts and tax** card sets where each kind of money is posted: pick the
accounts and tax codes, how sales are posted and a start date, then select
**Save**.

| Setting | What it is for |
| -- | -- |
| **Sales income** | Where item sales are recorded. |
| **Shipping income** | Where shipping you charge is recorded. Leave it empty to use sales income. |
| **Stripe clearing account** | Every sale is paid into it and every payout leaves it, so it returns to zero with each payout. |
| **Aglyn fee expense** | Where the Aglyn fee on each sale is recorded. |
| **Payout bank account** | The bank account Stripe pays out to. |
| **Sales tax codes** | The tax code for orders with sales tax, and for orders without. |

Nothing is posted until the accounts are chosen.

## What is posted

| In Aglyn | In your books |
| -- | -- |
| A paid order | Income paid in full into the Stripe clearing account. |
| A refund | A payment out of the Stripe clearing account against the income account. |
| The Aglyn fee on a sale | A cost from the Stripe clearing account to the fee expense account. |
| A Stripe payout | A **transfer** from the Stripe clearing account to the payout bank account. |

Sales and refunds are all filed under one customer, and fees under one
supplier, which Aglyn adds to your books the first time it posts.

Choose **One summary journal entry per day** to post one **journal entry** per
day instead of an entry per order, with the day's totals. It needs one more
account: **Sales tax liability**. Payouts are still posted one by one.

Your software takes each entry in its own time: seconds for most online
software, longer for QuickBooks Desktop, which waits for its Web Connector to
run. Until then the entry shows as waiting.

## Sales before you connected

Set a **Start date** before the day you connected, and Aglyn posts the sales,
fees and refunds from that day on. Payouts from the start date on are posted
too. Sales already posted are never posted twice.

## When something does not post {#when-something-does-not-post}

The **Sync activity** card lists everything posted, waiting or skipped:
**Needs attention** shows what your books refused, with the reason; fix the
cause, then select **Retry** on the item, or **Retry all**.

An entry your software did not take in time is listed there too, and nothing
was written for it, so **Retry** sends it again.

## Disconnect {#disconnect}

The card that names your connected books has **Disconnect**: it removes the
link to your software and stops posting. What was already posted stays in your
books, and the sync history stays in Aglyn.

If your software stops accepting the connection, because it was unlinked or
its login expired, the page shows **Reconnect required**. Select **Reconnect
your accounting software** to sign in again. Nothing is lost: what is waiting posts once you reconnect.

## Related

- [Connect QuickBooks Online](./connect-quickbooks-online.md)
- [Connect Xero](./connect-xero.md)
