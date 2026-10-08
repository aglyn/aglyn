---
sidebar_position: 4.8
title: Delivery apps (DoorDash, Uber Eats, Grubhub)
description: Take your DoorDash, Uber Eats and Grubhub orders at your POS register — accept, make and hand them over — with their items off the same shelf as every other sale. Rolling out.
unlisted: true
---

# Delivery apps: DoorDash, Uber Eats and Grubhub

:::caution Rolling out
Delivery apps are **not yet available** on aglyn.com-hosted workspaces. Until
they are, no **Delivery apps** card appears in your store's settings and no
delivery orders appear on the register.
:::

If you also sell on a delivery app, link your store there to your Aglyn store
and run every order from your [POS register](pos-and-reservations.md):

- **Orders come to the register.** Each new order shows above the products,
  with its items, options and the customer's instructions. Accept it or turn
  it down there, and the app is told at once.
- **One stock count.** An order you accept becomes one of your orders, with
  its own number, and its items come off the same shelf your website and
  register sell from, at the same moment.
- **Ready and picked up.** Tell the app the order is ready, and mark it
  picked up when the courier collects it.

Delivery apps come with the plans that include the POS register.

## Connect a store {#connect-a-store}

1. Open your store's **Settings** and find the **Delivery apps** cards.
2. On the service's card, enter the store ID the service shows you — the
   **DoorDash store ID**, the **Uber Eats store ID** from Uber Eats Manager, or
   the **Grubhub merchant ID** — and select **Connect**.
3. Turn on the integration for your store in the service as well, so it sends
   its orders to Aglyn rather than its tablet.

You need to be an admin of the site to connect, change or disconnect a store.
One service store can be linked to one site. On the card:

- **Accept orders automatically** accepts every order the moment it arrives.
  Off, each order waits on the register for someone to accept it — the
  service gives you a few minutes before it cancels an order nobody answered.
- **Prep time** is sent with each order you accept, so the courier arrives
  when the food is ready.
- **Disconnect** stops new orders reaching the register. Orders already taken
  stay in your store. Turn the integration off in the service too.

## The menu {#the-menu}

**Send menu** fills your store on the service from your products: each
product (and each of its variants) becomes an item, grouped by its category,
at its price. Sold-out items stay on the menu, unavailable. Send it again
after you change your products. Subscriptions, digital products and services
are left off.

Every order for an item from a menu you sent names the product it sold, so
its stock is counted exactly.

## Match items {#match-items}

If you built your menu on the service yourself, its items are matched to
your products by **SKU**: give each item the same merchant ID (or external
ID) on the service as the product's SKU here. An order item that matches no
product still comes in, by name, with no stock taken, and it is listed under
**Items** on the service's card. Select **Match** and choose the product it
should take stock from; later orders use it.

## Taking orders {#taking-orders}

Delivery orders appear on the register, oldest first, and a short message
announces each new one.

1. **Accept** records the order in your store and tells the service. Its
   items come off your shelf; if the service sold more than you had, the
   order still comes in and the register says how many are short. **Reject**
   asks for a reason, tells the service, and takes nothing off your shelf.
2. **Ready for pickup** tells DoorDash or Grubhub the order is ready. Uber
   Eats tracks this itself, so its orders go straight to **Picked up**.
3. **Picked up** marks the order fulfilled in your store. A ready order is
   marked picked up on its own two hours later.

If the service does not answer when you accept, reject or mark an order
ready, the register says so and Aglyn sends it again, several times over the
next few minutes; **Send again** tries at once.

What the service does after the order arrives comes to your store too:

- **Canceled on the service.** The order is canceled here and, if you had
  accepted it, its items go back on the shelf.
- **Items taken off the order.** The service's adjustment is recorded on your
  store order as a refund, and the items go back on the shelf if the order
  had not been picked up.
- **Refunded by the service.** The refund is recorded on your store order.

**Money.** The customer paid the service, which pays you out. Aglyn charges
nothing on these orders, and the service's commission is between you and the
service. The order's total is your food and its tax; the service collects
and remits that tax, and delivery fees and courier tips are the service's.
Refunds happen on the service and are recorded here.

The register shows each customer by first name and last initial. No email is
sent from your store to a delivery app's customers: the service sends its own.
