---
sidebar_position: 6
title: Use Pirate Ship with Aglyn
description: Export the orders you still have to ship as a spreadsheet Pirate Ship reads, buy the labels there, then import Pirate Ship's shipment report to mark each order shipped and email your customers their tracking links. The same works for Shippo, EasyPost and other label tools.
---

# Use Pirate Ship with Aglyn

Pirate Ship has no connection other apps can call, so you move orders with two
files: one out, one back. The same steps work for Shippo, EasyPost and any
label tool that reads a spreadsheet.

1. **Export for shipping** in Aglyn writes the orders you still have to ship.
2. Upload it to Pirate Ship and buy the labels.
3. Export Pirate Ship's shipments and **Import tracking** in Aglyn. Each order
   is marked shipped and your customer gets the shipped email with the
   tracking link.

Both buttons are in the header of the **Orders** card, on the **Orders** tab
of your site's **Products** hub.

## Export the orders to ship {#export}

1. Select **Export for shipping** and choose **Pirate Ship**.
2. The export dialog opens on the orders still to ship: paid and partly
   shipped orders that have something physical in them. Downloads, services
   and register sales aren't included.
3. Select **Export**. The file has one row per order with the columns Pirate
   Ship expects: **Order ID**, **Name**, **Email**, **Phone**, **Address 1**,
   **Address 2**, **City**, **State**, **Zip**, **Country**, **Ounces** and
   **Items**.

**Ounces** is the weight of what is still to ship, from each product's
variant weight. When no product in the order has a weight, the cell is blank
and Pirate Ship uses the default package weight you enter when you upload.
A partly shipped order lists only what is left.

The other presets lay out the same orders for other tools:

| Preset | Columns |
| --- | --- |
| **Shippo** | Shippo's order CSV: Order Number, Recipient Name, Street Line 1, City, State/Province, Zip/Postal Code, Country, Order Weight and Order Weight Unit (oz), and more. |
| **EasyPost** | `reference`, `to_address.*` and `parcel.weight_oz`. EasyPost also needs your from address, carrier and service in each row; add those columns before you upload. |
| **Shipping (any tool)** | Every shipping column under its own name, with the weight in ounces and pounds. |

You can change the fields before you export, like any export.

## Buy the labels in Pirate Ship {#labels}

1. In Pirate Ship, choose **Ship → Upload a Spreadsheet** and drop in the file.
2. The first time, Pirate Ship asks what each column holds. Map **Ounces** to
   the weight override. Pirate Ship remembers the mapping for next time.
3. Buy the labels.

## Import the tracking numbers {#import}

1. In Pirate Ship, open your shipments (a blank search on the **Ship** page),
   make sure the **Order ID**, **Tracking Number** and **Carrier** columns are
   showing, and select **Export**.
2. In Aglyn, select **Import tracking** on the Orders card and upload the file.
3. Aglyn matches the columns: order number, tracking number, carrier, and
   optionally a tracking link, a SKU and a quantity. Check the matching and
   continue.
4. Each row is matched to its order by the order number. Review what will
   happen, then **Apply**.

What each row does:

- **The order still has items to ship**: the row records a shipment with the
  tracking number and ships everything left on the order. Your customer gets
  the shipped email. To split an order across parcels, give each row the
  **SKU** and **Quantity** in that parcel.
- **The tracking number is already on the order**: nothing changes. Importing
  the same file twice is safe.
- **The order has already shipped with a different tracking number**: that's a
  conflict, and you decide on the **Conflicts** step. **Keep existing** (the
  default) leaves the order as it is. **Overwrite** for Tracking number
  replaces the tracking on its latest shipment.
- **No order with that number**, or a canceled, refunded or unpaid order: the
  row fails and the results say why. A tracking file never creates an order.

You need to be an admin or editor of the site to import tracking numbers.
**Undo** on the import's results takes back what it recorded: each shipment it
made is canceled, and each tracking number it replaced is put back.

## Related

- [Use ShipStation with Aglyn](use-shipstation.md)
- [Import and export store data](store-import-and-export.md)
- [Commerce](overview.md#orders)
