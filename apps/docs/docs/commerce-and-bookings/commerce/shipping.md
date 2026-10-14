---
sidebar_position: 4
title: Shipping
description: Shipping zones and rates, local pickup, and the postal address each inventory location ships from.
---

# Shipping

Shipping is set up on **Products → Shipping & delivery**, on the **Shipping** card. Every
order that ships is priced from the zones and rates you save there, at the
storefront's cart, on a product's Buy button, and on a draft order's payment
link.

## Zones and rates

The **Shipping** card, on **Products → Shipping & delivery**, prices every parcel: group the
countries you ship to into zones, then give each zone one or more rates.

1. Under **Zones**, select **Add zone**, enter a **Zone name** and its
   **Countries** as two-letter codes, such as `US, CA`, or `*` for everywhere
   else.
2. Under **Rates**, select **Add rate**, choose its **Zone**, give it a
   **Name** buyers see (a rate without one is dropped at checkout), and choose
   its **Type** and price.
3. Optionally turn on **Offer free local pickup**.
4. Check the **Coverage** line, which names any destination no rate reaches,
   then select **Save shipping settings**.

A **zone** owns countries; `*` is the rest of the world. A **rate** belongs to
one zone and prices a parcel in one of four ways:

| Rate type | What the shopper pays |
| -- | -- |
| Flat | One price. |
| Free over subtotal | One price, or nothing once the cart reaches the subtotal you set. |
| Subtotal tiers | The price of the first tier the cart's subtotal fits under. |
| Weight tiers | The price of the first tier the cart's weight fits under. Weight is each variant's weight times its quantity. |

**Local pickup** adds a free collection choice beside your rates. It does not
widen where you ship: a destination no rate reaches is still refused.
To let buyers choose which location to collect from, with pickup hours and a
ready-for-pickup email, turn on pickup for the location instead: see
[Pickup & local delivery](./pickup-and-local-delivery.md).

Checkout charges only the rates of the zone the destination falls in, and
narrows the address it collects to that destination, so a shopper cannot pick
another zone's cheaper rate. The [destination coverage](./overview.md#destination-coverage)
rules explain what your zones make checkout ask and refuse.

## Ask Aglyn AI {#ask-aglyn-ai}

You can ask [Aglyn Assist](../../ai/assist-builds.md) to set up shipping in plain words,
such as *free shipping over $50, otherwise $5 flat in the US*, *add $15 express to
Canada* or *stop shipping to the UK*. The plan card lists each change, and **Confirm
plan** saves it.

- Aglyn AI saves exactly what this card saves: a zone with its countries, and a flat,
  free-over-subtotal, subtotal-tier or weight-tier rate in it. A zone or rate you already
  have is changed in place, found by its name.
- It uses only the prices you give. A rate you do not price is not added; Aglyn AI asks
  instead.
- If the change leaves some destinations with no rate, the build says so, as the
  **Coverage** line does.
- Changes work as soon as they are saved, like a save on this card. They cost no AI
  credits.
- Only an admin or editor on the site can ask Aglyn AI for these changes. An author can
  still make them on the card.

## Where parcels ship from

Each **inventory location** (the **Inventory locations** card in the store's
settings) can carry a postal address: choose **Add address** on its row, or **Edit address**
once it has one. The address is the street, an optional apartment or suite,
city, state or region, postal code, the two-letter country code and a phone
number, saved beside the location's name.
