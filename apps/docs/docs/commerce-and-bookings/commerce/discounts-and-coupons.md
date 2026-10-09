---
sidebar_position: 4.2
title: Discounts and coupons
description: Create discount codes and automatic promotions with a minimum spend, a use limit and start and end dates, add percent-off coupons, and show the code field on your cart and product pages.
---

# Discounts and coupons

Discounts take money off an order: either a **code** a shopper types at
checkout, or an **automatic promotion** that applies to every cart that
qualifies, with nothing to type. You set them up on your site's **Products**
page, under **Promotions**.

Anyone who can edit the site can add, change and delete discounts. Shoppers pay
through your own Stripe account, so [connect Stripe](overview.md) before you
promote a sale.

The **Promotions** tab holds two cards for money off:

| Card | What it makes |
| -- | -- |
| **Discounts** | Codes and automatic promotions: percent off, a fixed amount off, or free shipping, with a minimum subtotal, a use limit and dates. Use this one for anything new. |
| **Coupons** | Simple percent-off codes with a use limit and an expiry date. Codes you made here before Discounts existed keep working. |

Gift cards and store credit sit on the same tab; see
[Gift cards & store credit](overview.md#gift-cards).

## Add a discount {#add-a-discount}

1. Open your site's **Products** page and choose **Promotions**.
2. On the **Discounts** card, select **Add discount**.
3. Fill in the **New discount** dialog:
   - **Code (blank = automatic)**: the code shoppers type, such as `SAVE10`.
     It is saved in capital letters, and anything other than letters, numbers,
     `-` and `_` is dropped. Leave it empty to make an
     [automatic promotion](#automatic-promotions), and give it a
     **Promotion name** instead, such as "Summer sale".
   - **Type**: **Percent off**, **Fixed amount off** or **Free shipping**. A
     percent or fixed discount asks for its amount in the **%** or **$ off**
     field next to it.
   - **Min subtotal ($)**: optional. The cart's items must add up to at least
     this much.
   - **Max uses**: optional. Leave it empty for no limit. See
     [Use limits](#use-limits).
   - **Starts** and **Ends**: optional dates. A discount works from the start
     of its **Starts** day to the end of its **Ends** day.
4. Select **Save**. **Save** stays unavailable until a percent or fixed
   discount has an amount above zero.

Each discount on the card reads as one line: its code or name, what it takes
off, whether it is **store-wide** or limited to some products, any minimum, and
how many times it has been used. A switched-off discount ends in
**· disabled**. **Edit** opens the same dialog and **Delete** removes the
discount straight away.

### Discount types {#discount-types}

- **Percent off** takes that share off the items in the cart.
- **Fixed amount off** takes that amount off the items, never more than they
  cost.
- **Free shipping** charges the shopper no shipping, whichever rate they pick.

Discounts come off the items before tax, so tax is worked out on the discounted
price. They never come off shipping, except a free shipping discount.

### Discounts for some products only {#product-discounts}

A discount can cover only certain products. Its line on the card then says,
for example, **2 products only**, and a percent or fixed discount is worked out
on those products' share of the cart, not the whole cart. A code for products
the shopper doesn't have in their cart is refused with **This discount does not
apply to your items**.

The dialog doesn't choose products. To limit a discount to some products,
export your discounts, fill in the **Product IDs** column and import the file
again. See [Import and export store data](store-import-and-export.md#discounts-and-coupons).

## Automatic promotions {#automatic-promotions}

A discount with no code is an automatic promotion. It shows on the card as a
chip with its **Promotion name**, or **Automatic** when it has none.

Every cart that meets an automatic promotion's minimum and dates gets it,
without the shopper doing anything. When several could apply, the cart gets the
one that takes the most off. Discounts never stack: when a shopper enters a
valid code, the code applies **instead of** any automatic promotion.

## Discount codes {#discount-codes}

A shopper types a code into the code field on your cart or product page. If the
code can't be used, checkout stops and tells them why, rather than charging
the full price. See [What shoppers see](#what-shoppers-see).

Codes are matched without regard to capital letters, so `save10` works for
`SAVE10`. A code that isn't one of your discounts is checked against your
[Coupons](#coupons) next.

## Use limits {#use-limits}

**Max uses** counts orders, not items: one order uses a discount once, however
many items it covers.

While a shopper is on the payment page, their use is **held** for them, so a
limited discount can't be handed out more times than its limit allows. The card
shows held uses separately, for example **97/100 used · 3 held in checkout**. A
held use is given back when that checkout expires or is abandoned, and counted
when it's paid.

When every use is taken or held, the next shopper is told **This discount has
been fully redeemed**. If someone else's checkout lets go of a held use, the
code works again.

## Where discounts apply {#where-discounts-apply}

| Where | Codes | Automatic promotions |
| -- | -- | -- |
| Cart checkout | Yes | Yes |
| A product's **Buy** button | Yes | Yes |
| A [draft order](overview.md#orders)'s payment link | No | Yes |
| The register and the self-service kiosk | No | Yes, except free shipping |

At the register, an automatic promotion is added to the cashier's own
**Discount %**. The cashier's percentage is limited by the store's **Maximum
register discount (%)** setting; your promotions are not. See
[POS & reservations](pos-and-reservations.md).

## Coupons {#coupons}

The **Coupons** card makes simple percent-off codes for your online checkout.

1. On the **Coupons** card, select **Add coupon**.
2. Enter the **Code** (letters and numbers; it is saved in capital letters),
   the **Percent off**, and optionally **Max redemptions** and an **Expires**
   date. The code works through the end of the day it expires.
3. Select **Create**.

Each coupon's line shows its code, how much it takes off, how many times it has
been used, and its expiry, or **expired** once that day has passed. Use
**Disable** to stop a coupon working and **Enable** to turn it back on.

When a code matches both a discount and a coupon, the discount wins.

## Import and export {#import-and-export}

The **Discounts** and **Coupons** cards each have **Import** and **Export** in
their header. A discount or coupon you import starts switched off, unless the
file has an **Active** column that says otherwise. How many times one has been
used is exported but never imported. See
[Import and export store data](store-import-and-export.md#discounts-and-coupons).

Aglyn AI can also propose discounts for your store. They are created switched
off. See [Products with AI](../../ai/products-with-ai.md).

## Show the code field to shoppers {#show-the-code-field}

Shoppers can only enter a code where your site shows a code field. In
Besigner, select the element and turn on its setting:

- **Cart** and **Cart page**: **Show coupon and gift card fields**. This one
  setting shows both the **Coupon code** field and the **Gift card** field.
- **Product detail** and **Product page**: **Show discount code field**. This
  shows a **Discount code** field above the Buy button.

Automatic promotions need no field: they apply on their own.

## What shoppers see {#what-shoppers-see}

A shopper whose code works pays the discounted price. When a code can't be used,
checkout stops before payment and the shopper sees one of these messages:

| Message | Why |
| -- | -- |
| **This discount has not started yet** | Today is before its **Starts** date. |
| **This discount has expired** | Its **Ends** date has passed. |
| **This discount is disabled** | The discount is switched off. |
| **Spend $… to use this** | The cart's items add up to less than **Min subtotal**. |
| **This discount does not apply to your items** | The discount covers only some products, and none of them are in the cart. |
| **This discount has been fully redeemed** | Every use is taken or held in someone else's checkout. |
| **Invalid or expired coupon** | The code is neither a discount nor a coupon, or the coupon is switched off or past its expiry. |
| **A promotion on your cart has just been fully redeemed. Refresh your cart to see the current price.** | An automatic promotion ran out while the shopper was checking out. Refreshing prices the cart without it. |

## Troubleshooting {#troubleshooting}

| What happens | What to do |
| -- | -- |
| A shopper can't find where to type the code | Turn on the code field on your cart or product page. See [Show the code field to shoppers](#show-the-code-field). |
| A discount ends in **· disabled** | It was imported or proposed by Aglyn AI, which start switched off, or turned off in a file. Import it again with **Active** set to yes. |
| A capped discount says it is used up but you have fewer orders | Some uses are held by shoppers on the payment page. They come back when those checkouts expire. |
| A code works online but not at the register | Codes aren't entered at the register. Make it an automatic promotion, or use the cashier's **Discount %**. |
| A free shipping promotion didn't apply at the register | Register sales don't ship, so free shipping has nothing to take off there. |

## Related

- [Commerce](overview.md)
- [Gift cards & store credit](overview.md#gift-cards)
- [Rewards, referrals and store credit](rewards-and-referrals.md)
- [Import and export store data](store-import-and-export.md)
