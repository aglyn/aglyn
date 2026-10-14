---
sidebar_position: 4.7
title: Tracking and protection (AfterShip, Route and Narvar)
description: Connect your own AfterShip, Route or Narvar account so parcels are followed, buyers land on your branded tracking page, and shipped orders can carry Route package protection. Rolling out.
unlisted: true
---

# Tracking and protection: AfterShip, Route and Narvar

:::caution Rolling out
Tracking and protection are **not yet available** on aglyn.com-hosted
workspaces. Until they are, no AfterShip, Route or Narvar card appears in your
store's settings, and your orders are tracked the way they are today.
:::

If you already use **AfterShip**, **Route** or **Narvar**, connect that account
to your store and Aglyn tells it about your orders:

- **AfterShip** follows every parcel you ship, and buyers can be sent to your
  AfterShip tracking page.
- **Route** offers package protection in the cart for orders that ship. The
  buyer pays Route's price, and Aglyn adds nothing to it.
- **Narvar** receives each order and its parcels, and buyers are sent to your
  Narvar tracking page.

Each service uses your own account; Aglyn does not sell one. They come with
every plan that includes selling, at no extra cost.

## Connect a service

1. Open the store's settings and find the card for the service:
   **AfterShip**, **Route** or **Narvar**. Only the services your deployment
   offers are shown.
2. Paste the credentials from your account:
   - **AfterShip:** an API key and the webhook secret. Optionally, your
     tracking page address, such as `https://yourstore.aftership.com`.
   - **Route:** the secret token.
   - **Narvar:** the account id, the auth token, and your retailer name (the
     word before `.narvar.com` in your tracking page address).
3. Turn on the card's switch and select **Save** in the card's header.

Credentials are stored on the server and are never shown again; a card shows
only whether one is stored. Paste a new one to replace it, or select
**Disconnect** to remove the credentials and switch the service off. Only an
**admin** of the site can change these settings.

### AfterShip's webhook

For tracking updates to reach your orders, copy the **Webhook address** shown
on the AfterShip card and add it in AfterShip under **Notifications →
Webhooks**.

## Package protection at checkout

With Route connected and switched on, the cart offers package protection for
the items that ship, at the price Route quotes. Choose **Tick the protection
box in the cart by default** to start it ticked.

When the order is paid, its Route policy is opened. When the order ships,
Route is told which parcel the covered goods left in. A whole refund or a
cancellation ends the policy.

## Branded tracking pages

When a parcel ships, the buyer's tracking link goes to your **Narvar** page
when Narvar is on and knows the carrier, otherwise to your **AfterShip** page
when you set one.

## On the order

Open an order to see its **Tracking and protection** section: the protection
status and what the buyer paid for it, each parcel a service is following, and
when the order was last sent to Narvar. When a service refuses an order (for
example because a token was revoked), the reason is shown here so you can fix
the connection.

## Switching it off for a site

Switching **Tracking and protection** off for a site stops protection and
tracking for its new orders. Protection already bought stays in force.
