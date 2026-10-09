---
sidebar_position: 4.15
title: Couriers for local delivery (DoorDash Drive)
description: Send a DoorDash courier for your own local deliveries from your own DoorDash Drive account, with the courier's tracking link and arrival time on the order. Rolling out.
unlisted: true
---

# Couriers for local delivery: DoorDash Drive

:::caution Rolling out
Couriers are **not yet available** on aglyn.com-hosted workspaces. Until they
are, no **Couriers** card appears in your store's settings, and your local
deliveries go out with your own driver, as they do today.
:::

When you offer [local delivery](./pickup-and-local-delivery.md), your own
driver takes each order out. With couriers, you can send a **DoorDash**
courier for any local delivery instead, booked from your own **DoorDash
Drive** account:

- **Get a quote, then send.** Aglyn asks DoorDash what the delivery costs and
  when it would arrive. Send the courier, and DoorDash sends a Dasher to your
  store now.
- **Follow it on the order.** The courier's progress, live tracking link and
  arrival estimate show on the order, in the **Pickup & delivery** queue and on
  your buyer's order status page.
- **The same statuses as your own driver.** When the courier picks the order
  up it is **Out for delivery**, and when they drop it off it is **Delivered**,
  with the same emails your buyer gets for your own driver. If DoorDash
  cancels the courier or brings the order back, the delivery is marked
  **Delivery failed** with DoorDash's reason, and you can send it out again.

## Who pays for the courier {#who-pays}

DoorDash charges each courier to **your own DoorDash Drive account**, at
DoorDash's price for that delivery. Aglyn doesn't charge, collect or mark up
the courier's fee. Your buyers still pay the delivery fee of your
[delivery zone](./pickup-and-local-delivery.md) at checkout, as they do now.

## Connect DoorDash Drive {#connect-doordash-drive}

1. Sign up for a DoorDash developer account at
   [developer.doordash.com](https://developer.doordash.com/portal), and
   create an access key. A **test** key reaches DoorDash's sandbox, where no
   Dasher is sent; a **live** key, available once DoorDash has approved your
   account for production, sends real couriers.
2. In Aglyn, open your store's **Settings** and find the **Couriers** card.
3. Enter your key's **Developer ID**, **Key ID** and **Signing secret** — your
   live key, your test key, or both — and choose **Connect DoorDash**.
   Aglyn checks each key with DoorDash before saving it, and keeps the signing
   secret encrypted.
4. Under **At the store**, enter the phone number couriers call when the
   location your deliveries leave from has none, and a note every courier
   gets ("Ask at the counter for the order number").

Orders paid in test mode use your test key, and other orders your live key,
so a test order never sends a real courier.

### Get delivery updates as they happen {#webhook}

The **Couriers** card shows a **webhook address** and, once, a **webhook
token**. In the DoorDash developer portal, add a webhook with that address,
set its **Authorization type** to **Basic**, and paste the token. DoorDash
then tells Aglyn each step of every delivery as it happens.

Without the webhook, Aglyn checks every open delivery with DoorDash every 15
minutes, and when you open the order. Lost the token? Choose **New webhook
token** and paste the new one in DoorDash.

## Send a courier {#send-a-courier}

1. On the **Orders** page, in the **Pickup & delivery** card, choose **Send a
   courier** on a local delivery's row — or open the order and find its
   **Courier** section.
2. Choose **Get a DoorDash quote**. Aglyn shows DoorDash's price and arrival
   estimate. The price is good for five minutes.
3. Choose **Send courier**.

A courier needs a full street address for the location your deliveries leave
from (**Products → Settings → Inventory locations**) and the buyer's street address and
phone number on the order. The order must be paid and not yet out for
delivery or delivered.

A delivery has one courier at a time: a second **Send courier**, or a retry
after a lost connection, never books a second Dasher. If DoorDash doesn't
answer, Aglyn checks with DoorDash within a few minutes and updates the order
either way — don't book again.

### Cancel a courier {#cancel}

Choose **Cancel courier** on the order. The delivery stays in your own
queue, where you can deliver it yourself or send another courier. DoorDash may still charge your account if the Dasher was already on
the way; see DoorDash's cancellation terms.

**Canceling or fully refunding an order cancels its courier** on Aglyn's next
check, within 15 minutes.

## What your buyer sees {#what-your-buyer-sees}

While a courier is on the way, your buyer's order status page shows
**DoorDash**, where the courier is, the arrival estimate and a **Track your
courier** link to DoorDash's live map. The **Out for delivery** and
**Delivered** emails are the ones your own driver's steps send.

## Why not Uber Direct? {#uber-direct}

Uber Direct's terms have a merchant promise not to share its Uber Direct
keys with anyone else, so you can't connect your own Uber Direct account to
Aglyn. Aglyn offers DoorDash Drive only.
