---
sidebar_position: 4.03
title: Sell in other currencies
description: Show and charge prices in your shoppers' own currencies, with daily rates, rounding, a buffer, and fixed prices where you want them.
---

# Sell in other currencies

Your store has one currency of its own, set on the **Store settings** card. You
can also sell in other currencies: a shopper in New Zealand sees and pays
New Zealand dollars, a shopper in the UK pays pounds, and Stripe pays you in
your store currency.

Everything is set up on the **Currencies** card, on **Products → Checkout**,
beside **Store settings**.

## Turn on other currencies {#turn-on-other-currencies}

1. On the **Currencies** card, turn on **Sell in other currencies**.
2. Under **Add a currency**, pick each currency you want to sell in, such as
   New Zealand dollar, British pound, Euro or Australian dollar.
3. For each one, optionally set a **Manual exchange rate**, a **Price
   adjustment (%)** and **Round converted prices** (all explained below), and
   choose whether its **prices include tax**.
4. Leave **Show each shopper prices in their own currency, picked from where
   they are browsing** on, unless you want every shopper to start in your
   store currency.
5. Select **Save currencies**.

The card says when the rates were last updated, and under each currency the
rate it converts at and what one price becomes, for example
"$250.00 → NZ$426.03 (rate 1.7041, as of Nov 25)", so you can check the
result before you save.

To stop selling in a currency, select **✕** beside it and save. Turning off
**Sell in other currencies** keeps your list, so you can turn it back on later.

## How shoppers get their currency {#how-shoppers-get-their-currency}

With the automatic choice on, each shopper starts in the currency of the
country they are browsing from, when you sell in it. A shopper from a country
whose currency you have not added sees your store currency.

Shoppers can also pick a currency themselves. Add the **Currency selector**
element to your site's header or footer in the Besigner, and it lists your
store currency and every currency you added. Their pick is remembered on that
device.

Where two currencies share a sign, prices say which is which: US$29.00,
A$45.00, NZ$49.00.

## Exchange rates {#exchange-rates}

Prices convert from your store currency at the European Central Bank's
reference rates, which are published every working day and picked up the same
day. The card shows the rate each currency uses and the day it is from.

If the daily rates ever go more than a few days without an update, shoppers are
shown and charged your store currency until fresh rates arrive, so nobody pays
at an old rate.

To fix the rate yourself, enter a **Manual exchange rate**: how much of that
currency one unit of your store currency buys (1.70 means $1 = NZ$1.70). A
manual rate replaces the daily one and does not change until you change it.
Leave the field blank to go back to the daily rate.

## Rounding {#rounding}

Converted prices are charged to the cent unless you turn on **Round converted
prices** for a currency. Then choose the ending, and every converted price
rounds up to it, so you never earn less than the rate gives:

| Round up to | NZ$43.27 becomes |
| -- | -- |
| Ends in .99 | NZ$43.99 |
| Ends in .95 | NZ$43.95 |
| Whole number | NZ$44.00 |

Rounding applies to product prices. Add-ons and shipping convert to the cent,
so a small add-on is not rounded up to a whole extra dollar.

## Price adjustment {#price-adjustment}

**Price adjustment (%)**, from -90 to +100, raises or lowers every converted
price in that currency before rounding. Stripe's currency conversion fee
(about 1–2%) comes out of your payout, so a small rise here, such as 2%, is how
shoppers in that currency cover it. Leave it at 0 to charge the rate exactly.

## Fixed prices {#fixed-prices}

Where a converted price is not the one you want, set the price yourself. A
fixed price is charged exactly as you enter it, with no conversion,
adjustment or rounding. Leave a field blank to keep converting it; the blank field shows the
converted price in gray.

- **Products**: in the product editor, under **Prices in other currencies**,
  enter a price for any variant in any of your currencies.
- **Add-ons**: on an add-on choice, select **Other currencies** and enter what
  it adds in each currency.
- **Shipping**: on a **Flat** or **Free over subtotal** rate, on the
  **Shipping** card, enter the price in each currency, and for **Free over
  subtotal** the subtotal it is free at. A free-over threshold you leave blank
  converts from the one in your store currency.

These fields appear once you sell in at least one other currency.

## Prices that include tax {#prices-that-include-tax}

Shoppers in the UK, the EU, Australia and New Zealand expect a price to
include VAT or GST. Turn on **Prices in … include tax** for those currencies,
and the price a shopper sees is the price they pay, tax included.

Tax is worked out by Stripe Tax, so this needs your Stripe Tax setting on and a
Stripe Tax registration in each country that pays in that currency. See
[Tax settings](./overview.md#tax-settings).

## Charging and payouts {#charging-and-payouts}

- Checkout charges the shopper in the currency they shopped in, through your
  Stripe account. Every price, add-on, shipping rate, discount and fee on the
  order is in that currency.
- Stripe converts the payment and pays it out to you in your store currency.
  Stripe charges a conversion fee for this (about 1–2%), taken from the
  payment: raise prices with a price adjustment to cover it.
- Each order shows what the shopper paid in their currency, and the same
  amounts in your store currency.
- A refund goes back in the currency the shopper paid, for the amount they
  paid in it.

## What stays in your store currency {#what-stays-in-your-store-currency}

These are always priced and charged in your store currency:

- Gift cards, because a card's balance is kept in your store currency.
- Subscriptions, so each renewal charges the same amount.
- Quotes, invoices and payment links you send, and sales at the register.
- Your reports: sales figures add up every order in your store currency.

## Ship to other countries {#ship-to-other-countries}

Selling in a currency does not by itself let you ship there. Checkout collects
an address only in the countries your shipping zones name. To sell to the UK,
the EU, Australia or New Zealand, add a zone for each (or one **Rest of world**
zone) with a rate, on the **Shipping** card. See
[Shipping](./shipping.md#zones-and-rates).

## Related

- [Shipping](./shipping.md)
- [Commerce](./overview.md)
- [Product catalog](./catalog.md)
