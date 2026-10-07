---
sidebar_position: 5
title: Use ShipStation with Aglyn
description: Connect ShipStation to your Aglyn store as a Custom Store, so it imports the orders you still have to ship and each label you buy there marks the order shipped and emails your customer the tracking link.
---

# Use ShipStation with Aglyn

If you already buy labels in ShipStation, keep doing it. Connect your store to
ShipStation as a **Custom Store** and ShipStation imports the orders you still
have to ship. When you create a label, or mark an order shipped, ShipStation
sends the shipment back to Aglyn: the order is marked shipped with its tracking
number, and your customer gets the shipped email with the tracking link.

You need to be an **admin** of the site to connect ShipStation, because the
connection can read every order's name and address. You don't need a
ShipStation API key: ShipStation calls Aglyn, not the other way around.

## Connect ShipStation {#connect}

1. In Aglyn, open your site's **Products** hub, choose the **Settings** tab and
   find the **ShipStation** card.
2. Select **Connect ShipStation**. The card shows the **URL to custom XML
   page**, a **username** and a **password**. Aglyn keeps the password
   encrypted, and a site admin can select **Show** on the card to see it
   again later.
3. In ShipStation, go to **Settings → Selling Channels → Store Setup**, select
   **Connect a Store or Marketplace** and choose **Custom Store**.
4. Paste the URL, username and password from Aglyn.
5. Type the status names exactly as the Aglyn card shows them. ShipStation
   matches them letter for letter:

   | ShipStation field | Type |
   | --- | --- |
   | Unpaid Status | `unpaid` |
   | Paid Status | `paid` |
   | Shipped Status | `shipped` |
   | Canceled Status | `canceled` |
   | On-Hold Status | `on_hold` |

6. Select **Test Connection**, then **Connect**.

## What ShipStation imports {#what-imports}

ShipStation asks Aglyn for the orders that changed in a time window, and Aglyn
answers with every order that has something to ship:

- **Paid orders** arrive as **Awaiting Shipment**, with the ship-to address,
  the customer's email and phone, each item's SKU, quantity, price, weight,
  image and options, and the order's shipping, tax and discount.
- **Partly shipped orders** list only what is **still to ship**, so a second
  parcel never asks for the whole order again.
- An order you **cancel or refund** in Aglyn moves to ShipStation's canceled
  orders the next time it imports, and an order you ship from Aglyn moves
  to **Shipped**.
- Digital products, services and register sales handed over at the counter
  aren't sent, because there is nothing to ship.

Weights come from each product's variant weight in Aglyn. A product with no
weight is sent without one, and ShipStation uses the package you choose there.

An order without a complete ship-to address (street, city, postal code and
two-letter country) isn't sent, because ShipStation can't make a label for it
and refuses the whole import if one order is incomplete.

## When you ship in ShipStation {#ship}

Create the label as usual. ShipStation sends Aglyn the order number, the
carrier, the service, the tracking number and the items in the parcel. Aglyn:

- records a shipment on the order for those items, with the tracking number
  and a tracking link for USPS, UPS, FedEx, DHL, Canada Post, Royal Mail and
  Australia Post;
- marks the order **Fulfilled**, or **Partially fulfilled** when items are
  still to ship;
- sends your customer the **shipped** email with the tracking link.

The same tracking number on the same order is recorded once. If ShipStation
sends the shipment again, or you already typed that tracking number into the
order in Aglyn, nothing changes. To avoid your customer getting two shipped
emails, turn off ShipStation's own customer notification for this store, or
untick **Notify customer** there.

## Make a new password or disconnect {#manage}

- **Show** next to the password shows it again. Only a site admin can see it,
  and each time it's shown is recorded in the site's activity.
- **New password** on the ShipStation card makes a new password and ends the
  old one at once. Paste the new password into ShipStation's store settings.
- **Disconnect** stops ShipStation reading your orders. Shipments it sends
  afterwards are refused. Orders it already shipped stay shipped.

The card also shows when ShipStation last imported orders and last sent a
shipment, so you can tell the connection is working.

## Troubleshooting {#troubleshooting}

| ShipStation says | What to do |
| --- | --- |
| The username or password is wrong | Make a new password on the card and paste the new one into ShipStation. |
| Commerce is switched off for this site | Turn the store back on for the site in Aglyn. |
| This site's plan does not include selling | Selling needs a plan with commerce. |
| No order *n* on this site | The order was deleted, or ShipStation is connected to a different site's URL. |
| Too many requests | ShipStation retries on its own. |

## Related

- [Use Pirate Ship with Aglyn](use-pirate-ship.md)
- [Use ShippingEasy with Aglyn](use-shippingeasy.md)
- [Import and export store data](store-import-and-export.md)
- [Commerce](overview.md#orders)
