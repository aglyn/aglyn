---
sidebar_position: 4
title: Shipping
description: Shipping zones and rates, local pickup, and the postal address each inventory location ships from.
---

# Shipping

Shipping is set up under **Products → Settings → Shipping**. Every order that
ships is priced from the zones and rates you save there, at the storefront's
cart, on a product's Buy button, and on a draft order's payment link.

## Zones and rates

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

Checkout charges only the rates of the zone the destination falls in, and
narrows the address it collects to that destination, so a shopper cannot pick
another zone's cheaper rate. The [destination coverage](./overview.md#destination-coverage)
rules explain what your zones make checkout ask and refuse.

## Where parcels ship from

Each **inventory location** (Products → Settings → Inventory locations) can
carry a postal address: choose **Add address** on its row, or **Edit address**
once it has one. The address is the street, an optional apartment or suite,
city, state or region, postal code, the two-letter country code and a phone
number, saved beside the location's name.
