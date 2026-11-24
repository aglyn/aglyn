---
sidebar_position: 1
title: "Before you switch: what moves and what doesn't"
description: What comes across when you move a store to Aglyn, what stays behind and what to do instead, and the go-live checklist the Shopify, Wix and Squarespace guides share.
---

# Before you switch: what moves and what doesn't

Moving a store is a set of small moves, each with its own file or button. This page covers
the parts that are the same wherever you come from. The guides for
[Shopify](switch-from-shopify.md), [Wix](switch-from-wix.md) and
[Squarespace](switch-from-squarespace.md) take you through the same steps in order, with
what to ask your current platform for first.

Keep your old store open until your new site is live on your domain. Nothing here changes
your old store, so you can export from it again at any point.

## What moves {#what-moves}

| What | How it comes across | Where |
| --- | --- | --- |
| Your pages, photos, menus, forms and search listings | **Bring my site** reads your current site and builds it again as a new Aglyn site | [Bring my site](../../ai/bring-my-site.md) |
| Old page addresses | Redirects from each old address to its new page | [Redirects from your old addresses](../../ai/bring-my-site.md#redirects) |
| Products, variants, stock and photos | Your old store's product file, in the products import | [Moving from Shopify, Wix or Squarespace](../../commerce-and-bookings/commerce/store-import-and-export.md#moving-from-shopify-wix-or-squarespace) |
| Customers and their marketing email choices | Your old store's customer file, in the contacts import | [Switching from an online store](../../content-and-data/crm/import.md#switching-from-an-online-store) |
| Gift card balances | A gift card import, which issues each card again | [Gift cards](../../commerce-and-bookings/commerce/store-import-and-export.md#gift-cards) |
| Redirects you already made | Your old store's redirect file or list, in the redirects import | [Moved a site into Aglyn](../../building-sites/redirects/migration-patterns.md#moved-a-site-into-aglyn) |
| Discount codes | Made again in **Discounts**, or imported from a spreadsheet | [Discounts and coupons](../../commerce-and-bookings/commerce/discounts-and-coupons.md) |
| Your domain | Connected to your new site, or transferred to Aglyn | [Your domain and your email](#domain-and-email) |

Every import shows you a dry run before it writes anything, and can be undone for seven
days. See [Import and export](../../workspace-and-billing/import-and-export.md).

What each needs from your plan:

- **Bring my site** is included on every paid plan.
- **Selling, the CRM and redirects** are included from Starter. Starter holds up to 25
  redirects on each site, and Pro and Custom have no limit.
- **Importing gift cards** and the **point of sale** need Pro.

## What can't move, and what to do instead {#what-cannot-move}

Some things stay with your old platform whoever you move to. Plan for each before you
go live.

| What stays behind | What to do instead |
| --- | --- |
| **Customer passwords.** No store's export includes them. | Customers make a new account on your site the first time they sign in. Tell them in your launch email. |
| **Order history.** Aglyn can't import past orders today. | Keep your old store's orders export for your records and your accountant. See [Your orders and your records](#orders). |
| **Cards saved in Shopify Payments.** | Customers enter their card again the first time they buy from your new site. |
| **Subscriptions.** They can't be imported, and Stripe's copy of saved cards leaves them out. | Set up your subscription products on your new site (recurring billing is on Pro), and ask each subscriber to subscribe there. Cancel the old subscription once they have. |
| **Shopify gift card codes.** Shopify's export shows only the last four characters of each code. | Issue each customer a new card for their balance, and email them the new code. See the [Shopify guide](switch-from-shopify.md#gift-cards). |
| **Reviews**, from Wix or Squarespace. Neither platform exports them. | Your store has product reviews built in, so new reviews start on your new site. You can also invite customers to review you on [Trustpilot or Yotpo](../../commerce-and-bookings/commerce/review-platforms.md). |
| **Wix blog posts.** Wix doesn't export them. | **Bring my site** reads your posts from your live site and brings each one in as a page. |
| **Card readers** that work with another payment company. | Your register works with the readers listed in [Card readers](../../commerce-and-bookings/commerce/pos-hardware.md#card-readers), which also says where you can buy one. |

## Your orders and your records {#orders}

Order history can't be imported today. Before you close your old store, download its orders
export and keep it with your business records. It is the copy your accountant will ask for,
and the one you'll use to look up a past order or a return.

Your accounting software keeps the sales it already holds. See
[Keep your books in one piece](#accounting).

## Payments {#payments}

Your store takes payments on a Stripe account of its own. You set it up from
**Products → Payments → Set up payments**. Only the workspace's owner can, and selling needs
a paid plan.

The business name, email, phone and website from your site's **Setup → Business profile**
are filled in on Stripe's form for you, so check them there rather than typing them again.

**If you already use Stripe**, sign in on Stripe's form with the Stripe login you already
have. Stripe offers to reuse an existing account's business details and payout bank
account, so you don't type them again. Choose your business and confirm. This makes a new
Stripe account for your Aglyn store under the same login. Your existing Stripe account
stays as it is, and Aglyn can't take it over. Stripe shows this choice only for an account
your login is an administrator of.

Once the **Payments** card's **Stripe account** line reads **Charges enabled**, set how you charge sales tax on
**Products → Taxes**. If you choose **Stripe Tax (automatic)**, the card shows what Stripe
still needs and links to it in your Stripe Dashboard, and checkout stays off until Stripe Tax
is on. See [Tax settings](../../commerce-and-bookings/commerce/overview.md#tax-settings).

### Customers' saved cards {#saved-cards}

A store on Wix or Squarespace that took payments on its own Stripe account can ask Stripe to
copy its customers and their saved cards into your new Stripe account. You start the copy
from your old Stripe account's Dashboard and accept it in the new one. Stripe says most
copies finish within 72 hours. Subscriptions aren't copied. Stripe's
[data copy guide](https://docs.stripe.com/get-started/data-migrations/pan-copy-self-serve)
has the steps.

The copied cards are kept in your Stripe account. Your Aglyn checkout doesn't use them, so a
customer still enters a card the first time they buy from your new site.

## Spending your earnings {#spending-your-earnings}

Stripe pays your sales out to your own bank account, on the payout schedule in your Stripe
account. Stripe charges nothing for standard payouts. To spend your earnings by card, use
the debit card from that bank account.

If you need money sooner, Stripe offers Instant Payouts to an eligible debit card from your
Stripe Dashboard, for a fee Stripe charges on each one. See Stripe's
[Instant Payouts](https://docs.stripe.com/payouts/instant-payouts) page.

## Fees {#fees}

What Aglyn takes from each sale depends on your plan, and Stripe bills its card processing
to your own Stripe account. Both are explained in one place:
[Platform fees](../../workspace-and-billing/billing-and-plans/overview.md#platform-fees).

## Keep your books in one piece {#accounting}

Aglyn posts your store's sales, refunds, fees and Stripe payouts to **Xero** or **QuickBooks
Online**. Accounting comes with every plan that includes selling.

1. **Pick a cut-over date.** This is the day your new site starts taking orders.
2. **Connect your books.** Open your organization, then **Accounting → Connection**, and
   connect [Xero](../../commerce-and-bookings/commerce/connect-xero.md) or
   [QuickBooks Online](../../commerce-and-bookings/commerce/connect-quickbooks-online.md).
3. **Use the accounts you already have.** Under **Accounts and tax**, choose the income,
   fee and bank accounts you use today, so this year's numbers stay in the same places.
   You'll also need a **Stripe clearing account**: a bank account in your books that stands
   for your Stripe balance. Add one named, for example, "Stripe clearing" if you don't
   have one.
4. **Set the Start date to your cut-over date**, and select **Save**. Aglyn posts its sales
   and payouts from that day on.
5. **On the cut-over date, disconnect your old store's accounting app** at your old store
   or in your accounting software, so no sale is posted twice.

What your books already hold stays as it is. Aglyn posts only sales made on Aglyn, and never
loads your old store's past orders into your books.

## Your domain and your email {#domain-and-email}

Your domain can stay where it is registered, or move to Aglyn.

- **Connect it.** Add one DNS record where your domain's DNS is managed, then choose
  **Verify & connect** on your site's **Custom Domain** page. See
  [Connect a domain](../../building-sites/custom-domains/connect-a-domain.md). You add the
  record yourself, and nobody needs your domain account's login.
- **Transfer it.** On your workspace's **Domains** page, choose **Transfer a domain in**.
  First unlock the domain at your current registrar and get its transfer code. A transfer
  takes up to about 5 to 7 days. A domain usually can't move within 60 days of being
  registered or transferred, or of a change to who it's registered to. See
  [Transfer a domain in](../../building-sites/custom-domains/manage-domains.md#transfer-in).

**Your email keeps working if its mail records do.** Email at your domain, such as
`hello@yourstore.com`, is delivered by your domain's mail (MX) records, not by your website.

- Connecting your site changes only your website's records, so your email isn't touched.
- Transferring the domain keeps its DNS where it is, so your email keeps working through
  the move.
- Moving your domain's DNS to Aglyn is the one step that can stop your email. Choosing
  **Use Aglyn's nameservers** on the domain's page means the records at your old DNS
  provider stop applying. Before you choose it, write down every mail record your current
  provider shows (MX, and the TXT records your email service gave you), then add them
  again under **DNS records**. See
  [DNS records](../../building-sites/custom-domains/manage-domains.md#dns).

If you pay your old platform for your email, ask it what happens to that email when you close
your store, and move it to an email service of your choice first if you need to.

Your redirects from old addresses start working once your domain points at your new site.

## Go-live checklist {#go-live-checklist}

1. Your new site's pages are in and published, and every **Redirect added** row looks right.
2. Products, photos, prices and stock are checked on a few product pages.
3. Customers are imported, with the marketing choices you confirmed.
4. The **Payments** card reads **Charges enabled**, and sales tax is chosen on **Products → Taxes**.
5. You placed a test order and refunded it.
6. Gift card balances are issued, and their holders have their codes.
7. Your accounting connection has its accounts and its **Start date** set.
8. Your mail records are written down, if you're moving your domain's DNS.
9. Connect your domain, and wait for its chip to say **live**.
10. Disconnect your old store's accounting app, and download its orders export.
11. Tell your customers: the new address if it changed, and that they make a new account.
12. Close your old store only after all of the above.

## Getting help {#getting-help}

Rather have the Aglyn team build your new site for you? Ask us through
[Support](../../workspace-and-billing/support-and-community.md). Once it's live,
[Site Care](../../workspace-and-billing/billing-and-plans/add-ons.md#site-care) can make your
small changes for you.

## Related

- [Switch from Shopify](switch-from-shopify.md)
- [Switch from Wix](switch-from-wix.md)
- [Switch from Squarespace](switch-from-squarespace.md)
- [Import and export](../../workspace-and-billing/import-and-export.md)
