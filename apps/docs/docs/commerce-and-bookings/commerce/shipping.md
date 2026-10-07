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

## Carrier accounts

The **Carrier accounts** card lists the carriers your labels and checkout
rates come from, for every site in the workspace. By default these are
Aglyn's own accounts, marked **Discounted rates**. A switch on each row turns
that carrier on or off.

If you have your own negotiated UPS or FedEx account, choose **Connect your
own account** and enter the account number, a contact and the account's
address. UPS then asks you to sign in at UPS; a row that still needs it shows
**Sign-in needed** or **Reconnect needed**. Labels bought on your own account
are billed to you by the carrier, so Aglyn charges nothing for them.

## Shipping labels

A label bought on Aglyn's carrier accounts is charged to the workspace at the
carrier's price, with nothing added. It is taken from your Stripe balance when
the label is bought, once a member has agreed to that; when Stripe cannot take
it, the label goes on the workspace's monthly invoice instead. A voided label
that the carrier refunds is given back the same way it was paid.

**Billing → Usage** shows a **Shipping labels** card once the workspace has
bought a label: for each month, how many labels, how much came from the Stripe
balance, how much went on the invoice, and what voided labels returned.
