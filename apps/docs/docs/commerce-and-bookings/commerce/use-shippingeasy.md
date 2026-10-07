---
sidebar_position: 5
title: Use ShippingEasy with Aglyn
description: Connect your ShippingEasy account so paid orders go there as they are paid, and each label you buy marks the order shipped and emails your customer the tracking link.
---

# Use ShippingEasy with Aglyn

If you buy labels in ShippingEasy, connect it to your Aglyn store. Each order is
sent to your ShippingEasy account as soon as it is paid. When you buy a label
there, ShippingEasy tells Aglyn: the order is marked shipped with its tracking
number, and your customer gets the shipped email with the tracking link.

You need to be an **admin** of the site to connect ShippingEasy, because the
connection sends every order's name and address to your ShippingEasy account.
You use your own ShippingEasy account and its API keys. There is nothing to
sign up for in Aglyn.

## Before you start {#before-you-start}

In ShippingEasy:

1. Add a store of the **API** type, if you don't have one yet. Aglyn sends
   orders into this store.
2. Note three values:
   - the **API key** and **API secret**, under **Settings → API Credentials**;
   - the **store API key** of your API store, under **Settings → Stores &
     Orders**.

## Connect ShippingEasy {#connect}

1. In Aglyn, open your site's **Products** hub, choose the **Settings** tab and
   find the **ShippingEasy** card.
2. Select **Connect ShippingEasy** and paste the API key, API secret and store
   API key. Aglyn checks them with ShippingEasy before it saves them, and keeps
   the secret encrypted. Nobody can see the secret in Aglyn again, including you.
3. The card shows a **Callback URL**. Copy it and paste it into your API
   store's settings in ShippingEasy, so each label you buy there comes back to
   Aglyn.
4. Select **Send open orders** to send the orders that were paid before you
   connected.

## What Aglyn sends {#what-is-sent}

- **Paid orders** are sent when they are paid, as **Awaiting Shipment**, with
  the ship-to and billing address, the customer's email and phone, each item's
  SKU, quantity, price, weight and options, and the order's shipping, tax and
  discount.
- **Partly shipped orders** list only what is **still to ship**.
- An order you **cancel or fully refund** in Aglyn is canceled in ShippingEasy.
- **Test orders** from Stripe's test mode aren't sent, because a label you buy
  in ShippingEasy is real postage.
- Digital products, services and register sales handed over at the counter
  aren't sent, because there is nothing to ship. An order without a complete
  ship-to address (street, city, postal code and country) isn't sent either.

Weights come from each product's variant weight in Aglyn. Each order is sent
once: sending open orders again skips the ones already in ShippingEasy.

## When you ship in ShippingEasy {#ship}

Buy the label as usual. When the label is ready, printed or the order is marked
shipped, ShippingEasy sends Aglyn the tracking number, the carrier and the
items. Aglyn:

- records a shipment on the order for those items, with the tracking number
  and a tracking link for USPS, UPS, FedEx, DHL, Canada Post, Royal Mail and
  Australia Post;
- marks the order **Fulfilled**, or **Partially fulfilled** when items are
  still to ship;
- sends your customer the **shipped** email with the tracking link.

The same tracking number on the same order is recorded once. If ShippingEasy
sends the shipment again, or you already typed that tracking number into the
order in Aglyn, nothing changes. To avoid your customer getting two shipped
emails, turn off ShippingEasy's own customer notification for this store.

A label you void in ShippingEasy isn't recorded.

## Change keys or disconnect {#manage}

- **Change keys** replaces the API key, secret and store API key, for example
  after you make a new secret in ShippingEasy.
- **Send open orders** sends the open orders from the last 90 days that aren't
  in ShippingEasy yet, up to 100 at a time.
- **Disconnect** deletes the keys from Aglyn. New orders stop going to
  ShippingEasy and shipments it sends afterwards are refused. Orders already in
  ShippingEasy stay there, and orders already shipped stay shipped.

The card shows when an order was last sent and a shipment last received. When
something goes wrong, the card says **Needs attention** and shows why, and the
site's admins and editors get a notification if an order could not be sent
after several tries.

## Troubleshooting {#troubleshooting}

| The card says | What to do |
| --- | --- |
| ShippingEasy did not accept these keys | Copy all three again. The store API key belongs to an API store. |
| ShippingEasy refused the API key, secret or store API key | The keys changed in ShippingEasy. Select **Change keys** and paste the new ones. |
| Order *n* was refused by ShippingEasy | Fix what ShippingEasy names, usually the address, then select **Send open orders**. |
| Order *n* could not be canceled in ShippingEasy | Cancel it in ShippingEasy yourself. |
| Shipments never arrive | Check that the callback URL in your ShippingEasy API store is the one on the card. |

## Related

- [Use ShipStation with Aglyn](use-shipstation.md)
- [Use Pirate Ship with Aglyn](use-pirate-ship.md)
- [Commerce](overview.md#orders)
