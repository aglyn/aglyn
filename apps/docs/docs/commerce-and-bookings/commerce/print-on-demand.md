---
sidebar_position: 4.6
title: Print on demand (Printful and Printify)
description: Connect your own Printful or Printify account, import its products into your store, and paid orders are sent to it to make and ship, with tracking written back to each order. Rolling out.
unlisted: true
---

# Print on demand: Printful and Printify

:::caution Rolling out
Print on demand is **not yet available** on aglyn.com-hosted workspaces. Until
it is, no **Print on demand** card appears in your store's settings.
:::

Sell T-shirts, mugs, posters and the rest of a print-on-demand catalog without
holding stock. Connect your own **Printful** store or **Printify** shop, import
the products you designed there, and every paid order for them is sent to the
service to be made and shipped to your buyer. When the service ships, the
carrier and tracking number land on the order in Aglyn, and your buyer gets the
same shipping email as for any parcel you ship yourself.

Print on demand comes with every plan that includes selling, at no extra cost.
You pay Printful or Printify directly for what they make and ship, at their own
prices; Aglyn adds nothing to them.

## Before you start

- **An account with the service.** Create your products in Printful or Printify
  first, with their designs, variants (colors and sizes) and retail prices.
- **A token you make there.** Aglyn connects with a token from your own
  account, so no password is shared:
  - **Printful:** sign in to the Printful Developer Portal and create a
    **private token** for your store that may view and manage its orders,
    products and webhooks.
  - **Printify:** open your account's **Connections** page and generate a
    **personal access token** that may read shops and products and read and
    write orders and webhooks.
- **The same currency.** The service's prices must be in the currency your
  store sells in. Aglyn never converts prices, so a product priced in another
  currency is not imported.
- **A payment method at the service.** Printful and Printify charge your
  account for each order they make.

## Connect

1. Go to **Commerce → Settings** and find the **Print on demand** card.
2. Select **Connect**, choose Printful or Printify, and paste your token.
3. If the token reaches more than one store or shop, choose which one to
   connect.

The token is checked with the service before it is saved, and it is stored
encrypted. You can connect one Printful store and one Printify shop to each
site.

Two settings sit under each connection:

- **Send paid orders for production automatically** — on by default. Turn it
  off to have each paid order wait at the service as a **draft** until you
  confirm it from the order.
- **Use the service's retail prices when products update** — off by default,
  so your store keeps the prices you set in Aglyn.

## Import products

Select **Import products** on a connection to see the products in your
Printful store or Printify shop. Choose the ones to sell and select
**Import**. Each product comes in with:

- its variants, as options such as **Color** and **Size**;
- the retail price you set at the service, for each variant;
- its photos, copied into your site's media library;
- its description and, from Printify, its tags.

New products arrive as **drafts** unless you turn on **List new products in the
store now**. Edit them like any other product: change the name, description,
photos or prices in Aglyn and your changes are kept.

Imported products update **every day** from the service: new variants are
added, variants the service no longer offers are removed, a variant the service
cannot make right now shows as sold out, and each variant's cost is refreshed.
To bring the service's name, description and photos in again, choose the
product in **Import products** with **Update names, descriptions and photos**
turned on, or use **Update** from the product's menu under **Imported
products**.

Each imported product counts toward your plan's product allowance like any
other. **Stop filling through the service** in the product's menu keeps the
product in your store but stops sending its orders to the service.

## Costs and margins

The product editor shows, for an imported product, what the service charges you
for each variant next to its retail price there. Each order's **Print on
demand** section shows what the service charged for that order — items,
shipping and tax — next to what your buyer paid for those items, and the
difference, before your own shipping charge and payment fees.

## Orders

When an order is paid, its lines for imported products are sent to the service
right away. An order with products from both services is sent to each, and
lines for your own products stay with you to ship as usual: a shipping label
you buy for the order leaves off the items a service is making.

The order's **Print on demand** section shows where it stands at the service:

| Status | What it means |
| --- | --- |
| Sending | Being sent, or waiting to be tried again after the service did not answer. |
| Draft at the service | Waiting for you to confirm it, or a test order. |
| Sent | Confirmed; the service has not started yet. |
| On hold | The service is holding it, usually for a payment or file problem. Fix it at the service. |
| In production | The service is making it. |
| Partly shipped / Shipped | Parcels are on their way. |
| Canceled | Canceled at the service, or never sent. |
| Not sent | The service refused it, or every try failed. The reason is shown. |

From the order you can **Confirm for production** (a draft), **Send again** (an
order that was not sent), **Check for updates**, or **Cancel at the service**.
**Orders sent to services** under the card lists every order sent, newest first.

If the service does not answer, the order is tried again by a job that runs
every 15 minutes, waiting longer between tries — up to six hours — for six
tries in all. If it still is not sent, or
the service refuses it (an address it cannot ship to, a payment problem), the
order shows **Not sent** with the service's reason, and the site's admins and
editors are notified.

### Test orders

An order paid with a Stripe test card is sent as a **draft** and never
confirmed, so you can check the whole flow without anything being made or
charged. Delete the draft at the service when you are done.

### Canceling and refunding

Canceling an order in Aglyn, or refunding it in full, cancels it at the service
too, as long as the service has not started making it. Once it is in
production the service will not cancel it from Aglyn; you are notified, and
can ask the service directly. A partial refund does not change what the
service makes.

## Shipments and tracking

When the service ships a parcel, its carrier, tracking number and tracking
link are added to the order as a shipment, for the items it carried — exactly
as when you record a shipment yourself, so the order's status and your buyer's
shipping email follow the same rules.

Aglyn asks the service to notify it of each shipment as it happens. If the
service already sends its notifications somewhere else (Printful keeps one
address per store), the connection shows **Checked every 15 min** and Aglyn
asks the service about open orders instead, so a parcel still reaches the
order.

## Disconnect

Choose **Disconnect** from the connection's menu. New orders are no longer sent
to the service, and orders already sent stop being followed in Aglyn. Your
imported products stay in your store; fill their orders yourself, or connect
the service again to resume.

## What is sent to the service

For each paid order with imported products: your buyer's name, shipping
address, phone number and email address, the order number, and each line's
variant, quantity and the price your buyer paid. Your token authenticates each
call. No card or payment details are sent. Reading your products sends nothing
about your customers.

The service is one you chose and connected with your own account; the data is
sent to it on your instruction so it can make and ship your orders.
