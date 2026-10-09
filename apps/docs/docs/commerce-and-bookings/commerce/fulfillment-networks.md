---
sidebar_position: 4.6
title: Fulfillment networks (ShipBob, ShipMonk and Amazon MCF)
description: Send paid orders to ShipBob, ShipMonk or Amazon Multi-Channel Fulfillment, get their shipments and tracking back on the order, and keep stock counts in step. Rolling out.
unlisted: true
---

# Fulfillment networks: ShipBob, ShipMonk and Amazon Multi-Channel Fulfillment

:::caution Rolling out
Fulfillment networks are **not yet available** on aglyn.com-hosted
workspaces. Until they are, no **Fulfillment networks** card appears in your
store's settings, and your orders are shipped the way they are today.
:::

If your stock sits in a **ShipBob** or **ShipMonk** warehouse, or in Amazon's
warehouses as **FBA inventory**, connect that account to your store and Aglyn hands each paid
order to it:

- **Paid orders go to the network.** The items it stocks are sent to it to
  pick, pack and ship. Items it does not stock stay with you, so one order can
  be split between the network and your own packing table.
- **Shipments come back to the order.** Each parcel the network ships is
  recorded on the order with its carrier and tracking number, and your
  customer gets the same shipped email as for a parcel you ship yourself.
- **Stock counts follow the warehouse,** if you choose: the network's count of
  each SKU becomes your store's count.

## Connect a network

1. Open your store's **Settings** and find the **Fulfillment networks** card.
2. Next to **ShipBob** or **Amazon Multi-Channel Fulfillment**, select
   **Connect**.
3. Sign in to that account and allow Aglyn access. You come back to the store
   settings with the network connected.

You need to be an admin of the site to connect, change or disconnect a
network. Aglyn never sees your ShipBob or Amazon password; it keeps only the
access the network grants, encrypted.

### ShipMonk: connect with your API key

ShipMonk connects with an **API key** from your own ShipMonk account instead
of a sign-in:

1. In ShipMonk, open **Account Settings**, then **Integration API Keys**. If
   you have no **API store** yet, ShipMonk sets one up for you when you ask
   under **Stores**.
2. Create an API key for your API store, and note the store's **id** shown
   beside it.
3. In your store's **Settings**, select **Connect ShipMonk**, paste the key,
   enter the store id and select **Connect**.

Aglyn checks the key with ShipMonk before keeping it, keeps it encrypted, and
never shows it again. To use a new key, revoke the old one in ShipMonk: the
card asks you to **Connect again**, and you paste the new one.

After you connect, the card shows a **webhook address** and a **signing
secret**, once. Give both to ShipMonk (its webhook settings under
**Integrations**, or ShipMonk support) so it tells Aglyn the moment an order
ships. Aglyn checks every webhook's signature and ignores any that does not
match. Without webhooks, Aglyn still reads each order back from ShipMonk
every 15 minutes. **New webhook secret** makes a new secret and ends the old
one at once.

- **ShipBob** creates a channel for Aglyn in your ShipBob account. Orders
  appear under it.
- **Amazon** asks you to choose the **marketplace** whose FBA inventory ships
  your orders, if your seller account sells in more than one.

## Settings

| Setting | What it does |
| --- | --- |
| **Sending** | **Automatic** sends every paid order with a shipping address. **Manual** sends an order only when you select **Send to** it on the order. |
| **Ship option** (ShipBob) | The ShipBob ship option orders ask for, as named in your ShipBob account. Standard unless you change it. |
| **Shipping service** (ShipMonk) | The shipping service orders ask for. It must match a shipping mapping in your ShipMonk account. Standard unless you change it. |
| **Shipping speed** (Amazon) | Standard, Expedited or Priority. Amazon bills you for the speed you choose. |
| **Marketplace** (Amazon) | The marketplace whose inventory ships. |
| **Keep stock counts in step** | Sets your store's count of each SKU to what the network can ship. Off until you turn it on. |

**Pause** stops new orders going to the network. Orders it already has keep
coming back as they ship. An order paid while a network is paused is not sent
later; send it from the order if you want the network to ship it.

## How orders are sent

Orders are sent within about 15 minutes of being paid. When an order is sent,
each item goes to the network **whole** if:

- the item has a **SKU** that matches a product at the network,
- the network can ship **all** of that item's units now, and
- no one else is already shipping it, such as another network or a
  print-on-demand supplier.

Anything else stays with you, and the order says why. The network ships what
it took; you ship the rest, by buying a label or marking it shipped as usual.
While a network holds items, buying a shipping label leaves them off, so a
customer never gets the same item twice.

Nothing is sent for:

- an order with no shipping address, such as an in-person sale or a digital
  order;
- a **test order**, paid in test mode. A network connected to its **sandbox**
  takes only test orders;
- an order whose address is missing a name, street, city, postal code or
  country (or, in the US and Canada, a state). The order says so; fix the
  address, then select **Send to** on the order.

If the network refuses an order, for example because it cannot ship to the
address, the order shows the network's reason and nothing is retried. Select
**Send to** on the order to try again once it is fixed.

On the order, the **Fulfillment networks** section shows where it stands with
each network: waiting to be sent, with the network, partly or fully shipped,
canceled, or not sent and why.

## Stock counts

With **Keep stock counts in step** on, Aglyn reads the network's count about
once an hour and sets your store's count of each matching SKU to it. Each
change appears in your products' **Stock movements** as **Count synced**,
counted by the network.

- An order that is paid but not yet sent is taken off the count, so it is not
  sold twice.
- A product that **does not track stock** is left alone.
- A product that counts stock **per location** is left alone: one number
  would erase the counts you keep for each location.
- Turn this on only for SKUs the network holds all of. If you also keep some
  of a SKU on your own shelf, the network's count replaces yours.

The card shows how many SKUs the network holds and how many of your counts
the last sync changed. **Sync now** counts again straight away.

## Shipments and tracking

Each parcel the network ships becomes a shipment on the order, with its
carrier and tracking number. When every item has shipped, the order is
**Fulfilled**.

- **Amazon** reports where each parcel is. Aglyn follows it until it is
  delivered or returned, for up to 30 days, and the order moves to
  **Delivered** when every parcel has arrived.
- **ShipBob** tells Aglyn when a parcel is delivered or has a delivery
  problem, and the order shows it.
- **ShipMonk** reports each package of an order, including the parts of an
  order it split, and where the order is. Aglyn follows it until it is
  delivered, for up to 30 days. If ShipMonk holds an order, for example on
  backorder or because it needs an address fixed, the order says so.

## Canceling and refunds

When you **cancel** an order, or **refund it in full**, Aglyn asks the network
to cancel it. You can also select **Cancel at** a network on the order. Once
the network has started packing, it may be too late: the order says so, and
anything that ships still comes back to the order. ShipMonk's warehouse may
confirm a cancellation later; the order says it was requested until it does.

A **partial refund** does not cancel anything at the network. If it covered
items the network still holds, the order tells you, so you can cancel them in
the network's own account if they should not ship.

## Activity

Each connected network has an **activity** list on the card: orders sent,
parcels shipped, cancellations, stock syncs and errors, newest first.

If a network stops accepting the connection, for example after you remove
Aglyn's access there, the card asks you to **Connect again**. Orders paid in
the meantime wait and are sent once you reconnect.

**Disconnect** stops sending orders and removes the stored access. Orders the
network already holds are left with it: check them in the network's own
account, and ship anything it has not shipped another way.
