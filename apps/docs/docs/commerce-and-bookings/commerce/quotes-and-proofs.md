---
sidebar_position: 3.1
title: Quotes
description: Price a customer's order before they buy, with products and their add-ons, items typed for the job, things included at no charge, a discount, shipping, notes and terms, and tax worked out as you go.
---

# Quotes

A quote prices an order for one customer before they buy: the canopy with their
logo, the sign at the size they asked for, the job with its materials and labor.
You build it in the console from your products and from items you type for the
job, and Aglyn works out the totals, tax included, as you go.

Quotes are on your site's **Products** hub, on the **Orders** tab, in the
**Quotes** card under the orders list.

## What a quote holds {#what-a-quote-holds}

- **The customer.** When your workspace keeps contacts, find someone by name,
  email or phone; or type their name, company, email and phone. A contact keeps the
  quote tied to their record.
- **Items.** Any mix of:
  - **Products** from your catalog, with the option you pick and any add-ons the
    product offers. They are priced from the product, add-ons included, exactly as
    the point of sale prices them.
  - **Custom items**, typed for this job: a name, an optional description and SKU,
    a unit price and a quantity. Turn off **Ships** for work that doesn't ship, such
    as design or installation. A custom item never changes your stock.
  - **Included** items. Turn on **Included at no charge** for anything that comes
    with the order, a product or a custom item, and it is listed at no charge.
- **Discount**: an amount off, or a percent off the items.
- **Shipping**: the amount you charge to ship it. Leave it empty when nothing ships.
- **Ship to** and **Bill to** addresses.
- **Notes for the customer** and **Terms**.

Each quote also keeps whether **Customers approve the proof before they can pay**.
New quotes start with your store's setting, in the **Quotes** card on the
**Checkout** settings page, and you can change it on each quote.

## Make a quote {#make-a-quote}

1. On the **Orders** tab, choose **New quote** in the **Quotes** card.
2. Find the customer in your contacts, or type their details.
3. Choose **Add product** or **Add custom item** for each line, and set its
   quantity.
4. Add a discount, shipping, the addresses, notes and terms as you need them.
5. Choose **Create quote**.

The quote gets the next number from your store's order numbers and is listed as
**Quote #1042**, for example. Choose a quote in the list to open it again; change
anything and choose **Save**. A draft quote you no longer need can be deleted.

The list shows each quote's customer, total, status and when it last changed, and
sorts by any column.

## Totals and tax {#totals-and-tax}

The totals add up the items (included items count nothing), take off the
discount, then add shipping and tax. Tax follows your store's
[tax settings](overview.md#tax-settings):

- **Manual rates**: the rate for the quote's ship-to state and country, or for your
  store's address when the quote has no ship-to country. The discount comes off
  before tax, and shipping is not taxed. A product marked tax-exempt is left out.
- **A connected tax service** ([Tax services](tax-services.md)) prices the quote when
  you save it, and the quote shows its figure.
- **Stripe Tax**: the quote says **Tax is added at payment**, because Stripe works
  out the tax when the customer pays.
- **No sales tax**: no tax is added.

If your store hasn't chosen how it handles sales tax, the quote shows no tax and
says so, with a link to **Taxes**.

## Quotes are not orders {#quotes-are-not-orders}

A quote shares your order numbers, but until it is paid it is not an order. It
stays out of the orders list, the money tiles, the analytics, exports, the shipping
tools and the customer's account page.

## Who can make quotes {#permissions}

Making, editing and deleting quotes takes the **Create and edit quotes** permission.
Everyone who can manage orders on the site has it to start with; a custom role or a
per-member override can grant or deny it. See
[Order permissions](../../workspace-and-billing/teams-and-roles/custom-roles.md#order-permissions).
