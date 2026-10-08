---
sidebar_position: 4.1
title: Pickup & local delivery
description: Let buyers pick up orders at your locations or have your own driver deliver them, with pickup hours, delivery zones, fees, minimums and delivery times.
---

# Pickup & local delivery

Besides shipping, your storefront cart can offer two more ways to get an order:

- **Pick up in store** — the buyer chooses one of your locations, and you email
  them when the order is ready to collect.
- **Local delivery** — your own driver brings the order. The buyer enters their
  postal code, sees your delivery fee, and books a delivery time.

Both are part of every plan that includes Commerce. A store that sets up neither
keeps its cart exactly as it was.

Local delivery is your own delivery. Orders that a marketplace courier collects
are covered by [Delivery apps](./delivery-apps.md), which work separately.

## Set up pickup {#set-up-pickup}

Pickup is set per location under **Products → Settings → Inventory locations**.
On a location's row, choose **Pickup**, then:

1. Turn on **Buyers can pick up orders here**.
2. Enter the **Pickup hours**, one line per set of days, like `Mo-Fr 09:00-17:00`
   and `Sa 10:00-14:00`. A line that doesn't read as days and times is flagged
   before you save.
3. Add **Arrival instructions** if buyers need them, such as which door to use.
4. Choose how long an order is **Usually ready in**, or leave it unsaid.

Give the location an address too (**Add address** on its row), so buyers know
where to go. Every location with pickup on is offered at the cart, with your
default location first.

When a buyer picks up at a location, that location's stock is reserved while
they check out and sold from that location when they pay. If the location
doesn't have enough, the cart says so and the buyer can choose another location
or have it shipped. Canceling the order puts the stock back at the same
location.

The **Offer free local pickup** switch on the Shipping card is the older,
unnamed pickup choice. Once any location offers pickup, the cart uses your
locations instead.

## Set up local delivery {#set-up-local-delivery}

Local delivery is set up on the **Local delivery** card under **Products →
Settings**:

1. Turn on **Deliver orders yourself** and enter the two-letter **Country** you
   deliver in.
2. Optionally choose the location orders **Leave from**. Its stock is reserved
   and sold for delivery orders.
3. Add one or more **Zones**. A zone lists the postal codes it covers: exact
   codes such as `10001`, a prefix ending in `*` such as `100*`, or a range such
   as `10010-10020`. Each zone has its own **Fee**, an optional **Minimum order**
   and an optional **Free over** amount. When a postal code is in more than one
   zone, the zone listed first is used.
4. Enter your **Delivery windows**, one per line, like `Mo-Fr 09:00-12:00`. Each
   line is offered on each of its days.
5. Choose how long before a window an order must be placed (**Order at least**)
   and how many days ahead buyers can book.
6. Optionally add **What buyers should know**, such as "We text when we're 10
   minutes away." It shows at the cart and on the receipt.

The card lists anything that stops checkout from offering delivery, such as a
zone with no postal codes or no delivery windows.

At the cart, the buyer enters their postal code and sees the fee, or why
delivery isn't available, such as an order below the zone's minimum. Checkout
charges the fee as the order's shipping and asks for an address in your country
only. If the address the buyer then enters is outside all of your zones, the
order is flagged and you're notified, so you can contact the buyer or refund
the delivery.

## The pickup & delivery queue {#queue}

The **Pickup & delivery** card on the **Orders** page lists what needs doing,
soonest first:

| Tab | What's in it |
| -- | -- |
| **To prepare** | Pickup orders you haven't marked ready. |
| **Ready for pickup** | Pickup orders waiting to be collected. |
| **To deliver** | Local deliveries, by delivery time. |
| **Out for delivery** | Deliveries your driver has taken out. |
| **Delivery failed** | Deliveries that couldn't be completed, to send out again. |

Pick a location at the top of the card to see only that location's orders.
Each row has its next step as a button, and **Open** shows the whole order. The
same steps are in the order's dialog.

| Step | What happens |
| -- | -- |
| **Mark ready** | The buyer gets the **Order ready for pickup** email with the location, your pickup hours and instructions. **Not ready yet** takes it back. |
| **Picked up** | The order is fulfilled and delivered, and the buyer gets a short confirmation. |
| **Out for delivery** | The buyer gets the **Order out for delivery** email with their delivery time. |
| **Delivered** | The order is fulfilled and delivered, and the buyer gets the **Order delivered** email. |
| **Couldn't deliver** | The delivery moves to **Delivery failed**, with an optional note. Send it out again when you're ready. |

Each email is sent once per step, and each can be turned off on the
**Customer notifications** card. When [text messages](./order-notifications.md#text-messages)
are available, buyers can add a mobile number at the cart to get these updates
by text as well. Picked
up and delivered orders count as fulfilled for your reports, outbound webhooks
and accounting, exactly like shipped ones.

The buyer's [order status page](./order-notifications.md) shows where to pick
up, the pickup hours, or the delivery time, and each step as it happens.

## Related

- [Shipping](./shipping.md)
- [Order emails & status page](./order-notifications.md)
- [Orders & returns](./orders-and-returns.md)
- [Delivery apps](./delivery-apps.md)
