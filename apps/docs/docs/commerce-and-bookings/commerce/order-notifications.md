---
sidebar_position: 5
title: Order emails & status page
description: The emails your customers get about their orders, the private order status page they link to, and how to resend a receipt.
---

# Order emails & status page

Your customers hear about their order at every step, without you doing
anything: when it's paid, each time part of it ships, when it's delivered,
when you refund it and when you cancel it. Every one of these emails links to
a private **order status page** on your site where the customer can see the
order, its shipments and their tracking.

## What your customers get {#customer-emails}

| When | Email | What it says |
| -- | -- | -- |
| An order is paid | **Order receipt** | The items, the total, any license keys and download links, and your receipt footer. Sent for checkout and Buy buttons, for payment links you send from a draft order, and for register sales when the customer gives an email. |
| You ship part or all of an order | **Order shipped** | The items in that package, the carrier and tracking number with a tracking link, and how many items are still to ship. One email per package. |
| You mark an order delivered | **Order delivered** | The order and its items. |
| You refund an order | **Order refunded** | The amount, the items you refunded by name (if you picked any), and whether the order is now refunded in full. One email per refund. |
| You cancel an order | **Order canceled** | The order and its items. Canceling doesn't refund a payment: refund first if the customer paid. |

A dropship supplier who posts tracking for their part of an order sends the
customer the same **Order shipped** email.

Each email is sent **once**. If a payment confirmation arrives twice, or you
click a button twice, the customer still gets one email. A second package or a
second partial refund is a new email.

Register sales and orders with only digital or service items don't send a
shipping or delivery email unless you add a tracking number.

### Tracking links

Tracking links are built from the carrier you type when you fulfill: USPS,
UPS, FedEx, DHL, Canada Post, Royal Mail and Australia Post are recognized,
including spellings like "UPS Ground" or "Fed Ex". For any other carrier the
email shows the carrier and tracking number without a link.

### Turning emails off

All five emails are **on** for every store. To turn one off, open **Commerce →
Settings → Customer notifications** and switch it off. Switching the receipt
off stops automatic receipts only; you can still [resend one](#resend-receipt).

### Changing the wording and colors

Each email is designable under **Emails**, like your other site emails, and
uses your site's theme colors. Order emails can use these tokens:

| Token | Emails | Value |
| -- | -- | -- |
| `{{order.number}}` | all | The order number, like #1042 |
| `{{order.statusUrl}}` | all | The customer's private order status page |
| `{{order.summary}}` | receipt, delivered, canceled | The items, one per line |
| `{{order.total}}` | receipt | The order total |
| `{{shipment.summary}}` | shipped | The items in this package |
| `{{shipment.carrier}}`, `{{shipment.trackingNumber}}` | shipped | The carrier and tracking number, empty when none was given |
| `{{shipment.tracking}}` | shipped | A sentence with the carrier, number and tracking link, empty with no tracking number |
| `{{shipment.remaining}}` | shipped | How many items will ship separately, empty when this package completes the order |
| `{{refund.amount}}`, `{{refund.summary}}`, `{{refund.note}}` | refunded | The amount, the items refunded by name, and whether the order is fully refunded |
| `{{cancel.note}}` | canceled | A line for paid orders telling the customer how to reach you; empty for unpaid ones |

## The order status page {#order-status-page}

Every order email links to `/order-status` on your site, with a private link
for that one order. The page shows, in your site's header, footer and theme:

- the order number and status, with a timeline from placed to delivered
- each package, its carrier and tracking number, and a **Track package** button
- the items, what's shipped so far, and the totals, refunds included

Customers don't need an account. The link only works for that order, and the
page never shows the customer's email, phone or address, so a forwarded email
reveals nothing the email didn't already say. Search engines are told not to
index it.

To design the page yourself, create a page at `/order-status` and place the
**Order status** element on it (under **Commerce** in the Besigner). Your page
is used instead of the built-in one.

## Resend a receipt {#resend-receipt}

Open an order and click **Resend receipt**. The customer's email is filled in;
change it to send the receipt somewhere else. The order's timeline records
each send. To stop accidental floods, an order's receipt can be resent five
times an hour.

## Text messages {#text-messages}

:::caution Rolling out
Text messages for order updates aren't available yet. Until they are, every
order notification is sent by email, and no option to text a customer appears
anywhere in your console.
:::

When text messages are available, the **Customer notifications** settings get an
**Also send as texts** switch, and **Resend receipt** can send by text. Customers
can reply STOP to any text to stop receiving them.

## Related

- [Commerce overview](overview.md#orders)
- [POS & reservations](pos-and-reservations.md)
