---
sidebar_position: 4.65
title: Inventory and ERP sync (Cin7 Core, inFlow, Brightpearl)
description: Keep stock counts, products and paid orders in step with your own Cin7 Core, inFlow Inventory or Brightpearl account. Rolling out.
unlisted: true
---

# Inventory and ERP sync: Cin7 Core, inFlow and Brightpearl

:::caution Rolling out
Inventory sync is **not yet available** on aglyn.com-hosted workspaces. Until
it is, no **Inventory and ERP** card appears in your store's settings, and
your stock is counted the way it is today.
:::

If you run your stock in **Cin7 Core** (formerly DEAR Inventory), **inFlow
Inventory** or **Brightpearl**, connect that account to your store and Aglyn
keeps the two in step:

- **Stock counts** follow whichever side you say is right: the system's count
  of each SKU becomes your store's, or your store's count is written into the
  system.
- **Products** can come into your store from the system, or your store's
  products can be made in the system.
- **Paid orders** go to the system as sales orders, so it can pick, pack and
  account for them.

A store syncs with one system at a time.

## Connect a system

You need to be an admin of the site to connect, change or disconnect a
system.

1. Open your store's **Settings** and find the **Inventory and ERP** card.
2. Connect the system you use:
   - **Cin7 Core:** in Cin7 Core, go to **Integrations → API** and add an API
     application. Paste its **Account ID** and **Application key** into the
     card and select **Connect Cin7 Core**.
   - **inFlow:** in inFlow, go to **Options → Integrations** and generate an
     API key (your inFlow plan needs the API access add-on). Paste the
     **Company ID** and **API key** and select **Connect inFlow Inventory**.
   - **Brightpearl:** enter your Brightpearl **account code** (the name in
     your Brightpearl address) and select **Connect Brightpearl**. Sign in to
     Brightpearl and allow access; you come back to the store settings with it
     connected.

Keys are checked with the system before they are saved, and stored
encrypted. They are never shown again. Aglyn never sees your Brightpearl
password.

When you connect, nothing is synced until you choose what to sync below.

## Stock counts

**Which counts are right** decides the direction:

| Choice | What happens |
| --- | --- |
| **The system** (Cin7 Core, inFlow or Brightpearl) | About every 30 minutes, the system's count of each SKU that can be sold now (on hand, less what the system has set aside for its own orders) becomes your store's count. Each change appears in your products' **Stock movements**, counted by the system. |
| **The store** | About every 30 minutes, the system's count of each SKU is adjusted to match your store's. Each run is one stock adjustment in the system. |
| **Don't sync counts** | Counts are left alone on both sides. |

Choose the **location** (in Brightpearl, the **warehouse**) whose counts are
synced. To push your store's counts into the system you must choose one
location; reading counts from the system can also add up all locations.

- Counts are matched by **SKU**. A SKU only one side has is left alone, and
  the card says how many there were.
- An order that is paid but not yet sent to the system is allowed for, so a
  unit is never sold twice while the order is on its way.
- A product that **does not track stock**, or that counts stock **per
  location**, is left alone when counts come from the system.
- Only counts that changed are written each run, and every count is written
  again once a day, so a count edited by hand on one side comes back in step.

## Products

| Choice | What happens |
| --- | --- |
| **Import from** the system | About every 6 hours, products added or changed in the system are added to your store as **drafts**, with their SKU and price in your store's currency, and kept in step after that. Review a draft and publish it when it is ready. A product you delete in the store is not added again. |
| **Make store products in** the system (Cin7 Core and inFlow) | Store products with a SKU the system does not have are made there, with their name, description and barcode, and in Cin7 Core their price and weight. In inFlow, set the price in inFlow's pricing scheme. |
| **Match by SKU only** | Nothing is made on either side. |

Brightpearl products are made in Brightpearl, since each needs a brand, a
product type and channel choices, so Brightpearl offers **Import** and
**Match by SKU only**.

Each run makes or updates up to 50 products and carries on with the rest on
the next run. A product the system has no price for in your store's currency
is not imported, and the activity says so.

## Orders

Turn on **Send paid orders** and choose who orders are recorded under:

- **Cin7 Core and inFlow:** the **name** of a customer that already exists in
  the system, such as "Web Sales".
- **Brightpearl:** the **ID** of an existing Brightpearl contact.

In Cin7 Core you can also name the **tax rule** order lines carry; leave it
empty to use the customer's own.

Each paid order is sent within about 15 minutes with its items, buyer,
shipping address, shipping, discount, tax and total. It carries a reference
such as `AG1042-3fa9c2d1` (your order number and a short code), which you can
search for in the system. An order is never recorded twice: before sending,
Aglyn looks for its reference in the system.

- Items are matched by **SKU**. An item with no SKU is left off and the order
  says so. If the system has no product for a SKU, the order is not sent; add
  the product in the system, then select **Send again**.
- If the system cannot be reached, the order is retried several times over a
  few hours. If it still cannot be sent, or the system refuses it, it appears
  under **Orders not sent** on the card, with the reason and **Send again**.
- On the order, the system's section shows whether it was sent, its number
  in the system and its reference.

### Canceling and refunds

When you **cancel** an order, or **refund it in full**:

- **Cin7 Core** voids the sale, and **inFlow** cancels the sales order. If
  the system will not, for example because the order has shipped, the order
  tells you to check it there.
- **Brightpearl:** cancel the order in Brightpearl. The order reminds you,
  with its number there.

An order canceled before it was sent is not sent. A **partial refund**
changes nothing in the system; the order reminds you to change it there if
it should not ship in full.

## Activity

The card lists what happened, newest first: orders sent, stock and product
syncs, cancellations and errors. **Sync now** syncs stock and products and
sends any waiting orders straight away.

Each system limits how fast it can be called. When it asks Aglyn to slow
down, everything for that store waits until the system says to come back, and
then carries on where it stopped.

If the system stops accepting the keys or the access, the card asks you to
**Connect again**. Orders paid in the meantime wait and are sent once you
reconnect.

**Pause** stops all syncing until you resume. **Disconnect** stops syncing
and deletes the stored keys and activity. Orders not yet sent stay unsent.
What the system already has stays there, and so do your store's products and
counts.
