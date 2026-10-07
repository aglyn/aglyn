---
sidebar_position: 5
title: Carrier rates and labels
description: Live carrier rates at checkout, shipping labels from your orders, batch labels, tracking, address checks, and how label costs are paid.
---

# Carrier rates and labels

:::note Rolling out
Carrier rates and labels appear in your console only where the platform you
use has connected a carrier provider. Until then, none of the cards below and
no **Carrier rates** rate type are shown, and your shipping works exactly as
your [zones and rates](./shipping.md) say.
:::

Buy postage for an order from the order itself, print the label, and the order
is marked shipped with its tracking. Carrier updates then move the order
along: in transit, out for delivery, delivered.

## Set up

Under **Products → Settings**:

- **Shipping labels** — where parcels ship from (one of your locations, or an
  address of its own), the boxes you ship in with their sizes and empty
  weights and which one a label starts with, the label format (PDF 4 × 6 in
  for thermal printers, PDF on letter paper, or ZPL for Zebra printers),
  whether a signature is required, whether each label is insured for the value
  of what it carries, who signs customs declarations, and which services
  checkout may offer.
- **Carrier accounts** — the carriers your labels and rates come from. By
  default these are the provider's own accounts, with its discounted rates.
  If you have your own UPS or FedEx account, **Connect your own account**;
  UPS then asks you to sign in at ups.com to finish. Labels on your own
  account are billed to you by that carrier. Carrier accounts are shared by
  every site in your workspace.

## Buy a label

Each paid order's address is checked with the carrier as soon as the order
comes in. When the carrier cannot deliver to it, or suggests a correction,
the order shows a warning above its labels, so you can contact the customer
before you buy one.

Open an order and choose **Buy label**:

1. **Check address** asks the carrier whether it can deliver to the order's
   address, and offers a corrected address when it has one. **Use this**
   buys the label for the corrected address; the order's own address is left
   as the customer gave it.
2. Choose the **units in this parcel** — everything not yet shipped, or fewer
   to split an order across boxes.
3. Choose the **box**, or **Another size**. The **weight** is summed from the
   products and the box; change it to your scale's reading.
4. **Get rates**, pick one (the cheapest and fastest are marked), and
   **Buy label**.

The label opens to print, the order records a shipment for those units with
the carrier and tracking number, and the customer gets the shipped email.
**Print** opens it again; a parcel crossing a border also has its
**Customs invoice**.

**Void** cancels a label you will not use, within the carrier's window. The
carrier refunds it, and when it does, the label's charge is given back.

**Return label** buys a label the other way round, from the customer to
your ship-from address, for units already shipped. Send it to the customer;
carriers charge most return labels only when they are scanned.

## Batch labels

Tick orders in the orders list and choose **Buy labels**. Pick the box and the
service rule — the cheapest or the fastest for each order — and **Get rates**.
Review the price for each order, then **Buy labels**. When they are bought,
**All labels** opens one page linking every label, and **Packing slips**
prints one slip per parcel with the address and what goes in the box.

## Tracking

Every label is followed for you, and so is a shipment you record by hand with
a carrier and tracking number. Each carrier update is added to the order's
timeline. When every parcel of a fully shipped order is delivered, the order
moves to **Delivered** and the customer gets the delivered email.

## Carrier rates at checkout

A **Carrier rates** rate in your [shipping zones](./shipping.md#live-carrier-rates)
quotes the parcel to the shopper's address at checkout, with your markup and
handling fee, and falls back to the rate you choose whenever a live quote is
not available.

## Paying for labels

Labels on the provider's accounts are charged at the carrier's price, with
nothing added. Each one is paid by the first of these that applies:

- **From your Stripe balance**, when you allow it under **Shipping labels →
  Paying for labels**: the label's cost is taken from your store's Stripe
  balance when you buy it, and returned there when a voided label is refunded.
- **On your monthly invoice** otherwise, or when your balance cannot cover a
  label: it is added to your workspace's next invoice with your other usage.

If neither is possible — balance payments not allowed and no payment method on
file — buying a label is refused before anything is charged. **Billing → Usage
→ Shipping labels** shows what labels cost each month, how much came from your
balance and how much is on your invoice, and what voids gave back.

Labels and carrier rates come with every plan that includes commerce.
