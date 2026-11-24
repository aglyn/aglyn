---
sidebar_position: 2
title: Switch from Shopify
description: Move a Shopify store to Aglyn in order, from the files to export first to your site, products, customers, gift cards, payments, books and domain.
---

# Switch from Shopify

Follow these steps in order. Your Shopify store keeps running the whole time, so close it
only at the end. What is the same for every platform, and what can't move from any of
them, is on [Before you switch](before-you-switch.md).

## 1. Get your files from Shopify {#get-your-files}

Export these from your Shopify admin and keep them together:

- [ ] **Products** (CSV). It lists each photo by its web address, so Aglyn can copy your
      photos across.
- [ ] **Customers** (CSV). It carries each customer's email marketing choice.
- [ ] **Orders** (CSV), for your records and your accountant. Aglyn can't import orders.
- [ ] **URL redirects** (CSV), if you made any.
- [ ] **Gift cards** (CSV), if you sell them. It shows only the last four characters of
      each code, so it's a list of cards, not a way to move them. See
      [Gift cards](#gift-cards).
- [ ] A list of your **discount codes**, to make them again.

## 2. Bring your site across {#site}

1. Open **Sites**, choose **Create site**, then **Bring my site**.
2. Type your store's address, then prove the site is yours with a DNS record, a tag on your
   home page, or a code by email.
3. Choose **Keep my site** or **Improve it**, then **Read my site**, and start the waves.

Your pages, photos, menus, forms and search listings come across. Blog posts come in as
pages. Shopify's cart, checkout and account screens are skipped: your new store has its
own. See [Bring my site](../../ai/bring-my-site.md).

Each page's old address redirects to its new one once a wave is in, for pages that are
published. Publish more pages later? Choose **Add redirects for published pages** on the
import's page. See [Redirects from your old addresses](../../ai/bring-my-site.md#redirects).

## 3. Import your products {#products}

1. Open **Products** and choose **Import** above the table.
2. Upload the Shopify products file as it is. Every column maps across, with nothing to pick.
3. Read the **Review** step. It says how many photos will be copied into your media library,
   in a folder named **Imported products**, and lists any it can't copy.
4. Choose **Import**. **Undo** is there for seven days.

See [Import and export store data](../../commerce-and-bookings/commerce/store-import-and-export.md#products).

## 4. Import your customers {#customers}

1. In the CRM, open **Contacts** and choose **Import**.
2. Upload the Shopify customers file. The columns map themselves.
3. On **Permission**, confirm only if these people really agreed to hear from your business,
   for example by ticking the box at your Shopify checkout. A customer the file says
   unsubscribed is always kept unsubscribed.

Text message marketing choices and total spent are read and not kept. Passwords never leave
Shopify, so customers make a new account on your site. See
[Switching from an online store](../../content-and-data/crm/import.md#switching-from-an-online-store).

## 5. Bring your redirects {#redirects}

On your site's **Redirects** page, choose **Import** on the **URL redirects** card and
upload Shopify's redirect file. Its **Redirect from** and **Redirect to** columns are
recognized by name. See [Migration patterns](../../building-sites/redirects/migration-patterns.md#moved-a-site-into-aglyn).

## 6. Issue your gift cards again {#gift-cards}

A Shopify gift card can't keep its code, because Shopify's export shows only its last four
characters. Give each holder a new card for their balance instead:

1. Make a spreadsheet with a **Balance** column, and a **Recipient email** column for each
   card. Leave **Code** out, so each card gets a new code.
2. On the **Gift cards** card, choose **Import** and upload it.
3. On **Confirm the cards**, type the total, and turn on **email each recipient their code**.

Importing gift cards needs Pro. See
[Gift cards](../../commerce-and-bookings/commerce/store-import-and-export.md#gift-cards).
Until your Shopify store closes, its old cards can still be spent there, so issue the new
cards close to your go-live day.

## 7. Set up payments {#payments}

Shopify Payments stays with Shopify, so your store gets a Stripe account of its own. Choose
**Products → Payments → Set up payments**. If you already have a Stripe login, sign in with
it on Stripe's form to reuse your business details and bank account. See
[Payments](before-you-switch.md#payments).

Cards saved in Shopify Payments don't come with you. Customers enter their card again the
first time they buy from your new site.

Then choose how you charge sales tax on **Products → Taxes**.

## 8. Your Shopify Balance card {#shopify-balance}

Stripe pays your Aglyn sales into your own bank account, free for standard payouts, so use
that bank's debit card to spend them. See
[Spending your earnings](before-you-switch.md#spending-your-earnings).

Shopify Balance and its card are tied to your Shopify store. Ask Shopify how to move your
money out of Shopify Balance before you close the store.

## 9. Connect your books {#accounting}

Connect Xero or QuickBooks Online, choose the accounts you use today, and set the **Start
date** to the day your new site takes its first order. On that day, disconnect Shopify's
accounting app, so nothing is posted twice. See
[Keep your books in one piece](before-you-switch.md#accounting).

## 10. Move your domain {#domain}

If you bought your domain through Shopify, you can keep it there and connect it, or transfer
it to Aglyn. Write down your mail records first if you plan to move your domain's DNS. See
[Your domain and your email](before-you-switch.md#domain-and-email).

## 11. Go live {#go-live}

Work through the [go-live checklist](before-you-switch.md#go-live-checklist), then close
your Shopify store.

## Related

- [Before you switch: what moves and what doesn't](before-you-switch.md)
- [Platform fees](../../workspace-and-billing/billing-and-plans/overview.md#platform-fees)
- [Commerce end to end](../commerce-end-to-end.md)
