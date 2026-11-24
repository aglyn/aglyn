---
sidebar_position: 3
title: Switch from Wix
description: Move a Wix site and store to Aglyn in order, from the files to export first to your site, products, contacts, payments, books and domain.
---

# Switch from Wix

Follow these steps in order. Your Wix site keeps running the whole time, so close it only at
the end. What is the same for every platform, and what can't move from any of them, is on
[Before you switch](before-you-switch.md).

## 1. Get your files from Wix {#get-your-files}

Export these from your Wix dashboard and keep them together:

- [ ] **Products** (CSV). Wix doesn't export digital products, so list those to make again.
- [ ] **Contacts** (CSV). It carries each contact's email subscriber status.
- [ ] **Orders**, for your records and your accountant. Aglyn can't import orders.
- [ ] **URL redirects** (CSV), from Wix's URL Redirect Manager, if you made any.
- [ ] A list of your **gift cards**, with each code and remaining balance, if you sell them.
- [ ] A list of your **discount codes**, to make them again.

What Wix can't give you:

- **Your site's design.** Wix sites can't be exported. **Bring my site** builds your pages
  again from your live site instead.
- **Blog posts.** Wix doesn't export them. **Bring my site** reads them from your live site
  and brings each one in as a page.
- **Reviews.** Wix doesn't export them. New reviews start on your new store.

## 2. Bring your site across {#site}

1. Open **Sites**, choose **Create site**, then **Bring my site**.
2. Type your site's address, then prove the site is yours with a DNS record, a tag on your
   home page, or a code by email.
3. Choose **Keep my site** or **Improve it**, then **Read my site**, and start the waves.

Your pages, photos, menus, forms and search listings come across. Wix's cart, checkout and
account screens are skipped: your new store has its own. See
[Bring my site](../../ai/bring-my-site.md).

Each page's old address redirects to its new one once a wave is in, for pages that are
published. Publish more pages later? Choose **Add redirects for published pages** on the
import's page. See [Redirects from your old addresses](../../ai/bring-my-site.md#redirects).

## 3. Import your products {#products}

1. Open **Products** and choose **Import** above the table.
2. Upload the Wix products file as it is. Each product and its variant rows become one
   product, with each variant's choice, SKU and stock.
3. Read the **Review** step. It says how many photos will be copied into your media library,
   in a folder named **Imported products**, and lists any it can't copy.
4. Choose **Import**. **Undo** is there for seven days.

Check these afterward:

- **Photos.** A Wix file often names a photo without saying where it is online. Those
  photos can't be copied, and the **Results** step lists each product it happened to. Add
  those photos in the product editor.
- **Weights.** The file doesn't say if they're in pounds or kilograms, so set them on each
  product that ships.
- **Stock.** Stock written as **In stock** isn't counted. Set the number on the product.
- **Handles.** Wix doesn't export product addresses, so each handle is made from the
  product's name. To import the file again later, keep the SKUs the same.

See [Moving from Shopify, Wix or Squarespace](../../commerce-and-bookings/commerce/store-import-and-export.md#moving-from-shopify-wix-or-squarespace).

## 4. Import your contacts {#customers}

1. In the CRM, open **Contacts** and choose **Import**.
2. Upload the Wix contacts file. The columns map themselves, and labels become tags.
3. On **Permission**, confirm only if these people really agreed to hear from your business.
   A contact the file says unsubscribed is always kept unsubscribed.

Text message subscriber status is read and not kept. Passwords aren't in any export, so
members make a new account on your site. See
[Switching from an online store](../../content-and-data/crm/import.md#switching-from-an-online-store).

## 5. Bring your redirects {#redirects}

On your site's **Redirects** page, choose **Import** on the **URL redirects** card and
upload Wix's redirect file. Its **Old URL** and **New URL** columns are recognized by name.
See [Migration patterns](../../building-sites/redirects/migration-patterns.md#moved-a-site-into-aglyn).

## 6. Issue your gift cards {#gift-cards}

Make a spreadsheet with each card's **Code** and **Balance**, and a **Recipient email** if
you have one. On the **Gift cards** card, choose **Import** and upload it. Keeping a card's
code means its holder's card keeps working. If you can't see a card's full code, leave
**Code** blank: the card gets a new one, and **email each recipient their code** on
**Confirm the cards** sends it to the holder. Importing gift cards needs Pro. See
[Gift cards](../../commerce-and-bookings/commerce/store-import-and-export.md#gift-cards).

## 7. Set up payments {#payments}

Choose **Products → Payments → Set up payments**. If your Wix store took payments through a
Stripe account of your own, sign in with that Stripe login on Stripe's form to reuse your
business details and bank account. See [Payments](before-you-switch.md#payments).

That old Stripe account can also copy your customers and their saved cards into your new
one. See [Customers' saved cards](before-you-switch.md#saved-cards).

Then choose how you charge sales tax on **Products → Taxes**.

## 8. Connect your books {#accounting}

Connect Xero or QuickBooks Online, choose the accounts you use today, and set the **Start
date** to the day your new site takes its first order. On that day, disconnect any
accounting app your Wix store used, so nothing is posted twice. See
[Keep your books in one piece](before-you-switch.md#accounting).

## 9. Move your domain {#domain}

If you bought your domain through Wix, you can keep it there and connect it, or transfer it
to Aglyn. Write down your mail records first if you plan to move your domain's DNS. See
[Your domain and your email](before-you-switch.md#domain-and-email).

## 10. Go live {#go-live}

Work through the [go-live checklist](before-you-switch.md#go-live-checklist), then close
your Wix site.

## Related

- [Before you switch: what moves and what doesn't](before-you-switch.md)
- [Platform fees](../../workspace-and-billing/billing-and-plans/overview.md#platform-fees)
- [Commerce end to end](../commerce-end-to-end.md)
