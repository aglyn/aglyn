---
sidebar_position: 4
title: Switch from Squarespace
description: Move a Squarespace site and store to Aglyn in order, from the files to export first to your site, products, customers, gift cards, payments, books and domain.
---

# Switch from Squarespace

Follow these steps in order. Your Squarespace site keeps running the whole time, so close it
only at the end. What is the same for every platform, and what can't move from any of them,
is on [Before you switch](before-you-switch.md).

## 1. Get your files from Squarespace {#get-your-files}

Export these from Squarespace and keep them together:

- [ ] **Products** (CSV). Squarespace leaves out variant images, and doesn't export download
      products or gift cards, so list those to set up again.
- [ ] **Customers** (CSV). It has no marketing column.
- [ ] Your **mailing lists**, from the **Lists & Segments** panel. Each list downloads as a
      .zip of three CSV files: subscribed, unsubscribed and cleaned.
- [ ] **Gift cards** (CSV), if you sell them. The file has each card's full code, so keep it
      as safe as the cards themselves.
- [ ] **Orders** (CSV), for your records and your accountant. Aglyn can't import orders.
- [ ] Your **URL mappings**: the redirects you made. Squarespace has no file for these. Open
      **Settings**, then **Developer tools**, then **URL mappings**, and copy all of the
      text in the box.
- [ ] A list of your **discount codes**, to make them again.

What doesn't come from a Squarespace export:

- **Blog posts.** Squarespace exports its blog as a file for WordPress, which Aglyn doesn't
  import as posts. **Bring my site** reads your posts from your live site and brings each one
  in as a page instead.
- **Reviews.** Squarespace doesn't export product reviews. New reviews start on your new
  store.

## 2. Bring your site across {#site}

1. Open **Sites**, choose **Create site**, then **Bring my site**.
2. Type your site's address, then prove the site is yours with a DNS record, a tag on your
   home page, or a code by email.
3. Choose **Keep my site** or **Improve it**, then **Read my site**, and start the waves.

Your pages, photos, menus, forms and search listings come across. Squarespace's cart,
checkout and account screens are skipped: your new store has its own. See
[Bring my site](../../ai/bring-my-site.md).

Each page's old address redirects to its new one once a wave is in, for pages that are
published. Publish more pages later? Choose **Add redirects for published pages** on the
import's page. See [Redirects from your old addresses](../../ai/bring-my-site.md#redirects).

## 3. Import your products {#products}

1. Open **Products** and choose **Import** above the table.
2. Upload the Squarespace products file as it is. Rows are grouped into products by their
   product ID, and each product keeps its Squarespace address as its handle where it can.
3. Read the **Review** step. It says how many photos will be copied into your media library,
   in a folder named **Imported products**, and lists any it can't copy.
4. Choose **Import**. **Undo** is there for seven days.

Check these afterward:

- **Variant photos.** They aren't in the file, so add them in the product editor.
- **Download products.** They aren't in the file, so make them again as digital products.
- **Weights.** The file doesn't say if they're in pounds or kilograms, so set them on each
  product that ships.
- **Stock.** **Unlimited** stock isn't counted. Set the number on the product.

See [Moving from Shopify, Wix or Squarespace](../../commerce-and-bookings/commerce/store-import-and-export.md#moving-from-shopify-wix-or-squarespace).

## 4. Import your customers {#customers}

1. In the CRM, open **Contacts** and choose **Import**.
2. Upload the Squarespace customers file. The columns map themselves: shipping details
   become the mailing address, billing details the other address.

The customers file has no marketing column, so your customers arrive with no marketing
choice recorded. Bring your subscribers in from your mailing list export instead: import the
subscribed file into an email audience with the
[email list import](../../marketing-and-automation/email-campaigns/overview.md#import-a-list),
and keep your unsubscribed people out of your email with a
[suppression import](../../marketing-and-automation/email-campaigns/overview.md#import-export-suppressions).

Total spent and order counts are read and not kept. Passwords aren't in any export, so
customers make a new account on your site. See
[Switching from an online store](../../content-and-data/crm/import.md#switching-from-an-online-store).

## 5. Bring your redirects {#redirects}

On your site's **Redirects** page, choose **Import** on the **URL redirects** card. Paste
your URL mappings into **Or paste rows** and choose **Read pasted rows**. Each line becomes a
redirect, with its `301` or `302` kept. See
[Moved from Squarespace](../../building-sites/redirects/migration-patterns.md#moved-from-squarespace).

## 6. Issue your gift cards {#gift-cards}

On the **Gift cards** card, choose **Import** and upload a file with each card's **Code** and
**Balance**. Use each card's remaining value from Squarespace as its balance. Keeping a
card's code means its holder's card keeps working, so leave **email each recipient their
code** off. Importing gift cards needs Pro. See
[Gift cards](../../commerce-and-bookings/commerce/store-import-and-export.md#gift-cards).

Gift card rows in your products file are skipped with a note, so the gift card import is the
one place they come in.

## 7. Set up payments {#payments}

Choose **Products → Payments → Set up payments**. If your Squarespace store took payments
through a Stripe account of your own, sign in with that Stripe login on Stripe's form to
reuse your business details and bank account. See [Payments](before-you-switch.md#payments).

That old Stripe account can also copy your customers and their saved cards into your new
one. See [Customers' saved cards](before-you-switch.md#saved-cards).

Then choose how you charge sales tax on **Products → Taxes**.

## 8. Connect your books {#accounting}

Connect Xero or QuickBooks Online, choose the accounts you use today, and set the **Start
date** to the day your new site takes its first order. On that day, disconnect any
accounting app your Squarespace store used, so nothing is posted twice. See
[Keep your books in one piece](before-you-switch.md#accounting).

## 9. Move your domain {#domain}

If you bought your domain through Squarespace, you can keep it there and connect it, or
transfer it to Aglyn. Write down your mail records first if you plan to move your domain's
DNS. See [Your domain and your email](before-you-switch.md#domain-and-email).

## 10. Go live {#go-live}

Work through the [go-live checklist](before-you-switch.md#go-live-checklist), then close
your Squarespace site.

## Related

- [Before you switch: what moves and what doesn't](before-you-switch.md)
- [Platform fees](../../workspace-and-billing/billing-and-plans/overview.md#platform-fees)
- [Commerce end to end](../commerce-end-to-end.md)
