---
sidebar_position: 4.06
title: Ship with your own Easyship, Sendcloud or ShipperHQ
description: Connect your own Easyship or Sendcloud account to get rates and buy labels there, billed to you by that service, or ShipperHQ to price checkout shipping with your own rules. Rolling out.
---

# Ship with your own Easyship, Sendcloud or ShipperHQ

:::note Rolling out
Connecting your own shipping account appears in your console only once it is
available on the platform you use. Until then, there is no **Your shipping
accounts** card, and your shipping works exactly as your
[zones and rates](./shipping.md#zones-and-rates) say.
:::

Connect your own Easyship or Sendcloud account and Aglyn gets rates and buys
labels on it instead of on the platform's carrier accounts, and that service
bills you for each label. Connect ShipperHQ to price checkout shipping with
your own ShipperHQ rules.

Everything else works as described in [Shipping labels and live carrier
rates](./shipping-labels-and-live-rates.md): you buy labels from the order, in a
batch or from a return, and tracking updates your orders and emails your
customers. This page covers what is different.

## Before you start {#before-you-start}

- **Your own account at the service.** Aglyn has no account with Easyship,
  Sendcloud or ShipperHQ for you. You sign up with them, and they bill you.
- **Stripe is not needed for labels.** Labels on your own Easyship or Sendcloud
  account are billed to you by that service, so Aglyn charges nothing for them.
- **Who can do it.** An **admin** of the site sees the **Your shipping
  accounts** card. To connect or disconnect an account, the admin also needs
  the workspace's **Manage billing** permission, because it changes how every
  site in the workspace ships and who bills it.

The connection is workspace-wide: every site in the workspace ships through
the same accounts.

## Connect an account {#connect-an-account}

1. Open your site's **Products** hub and choose **Shipping & delivery**. Find
   the **Your shipping accounts** card.
2. Select **Connect an account** in the card's header.
3. Under **Service**, pick **Easyship**, **Sendcloud** or **ShipperHQ**, and
   fill in the fields for it (below).
4. Select **Check and connect**. Aglyn checks the credentials with the service
   before it saves them, and keeps them encrypted. They are never shown again,
   to you or anyone else.

The account then appears on the card with its name at the service, and:

- **Labels and rates** for Easyship or Sendcloud, or **Checkout rates** for
  ShipperHQ;
- **Test** when the account is a sandbox or test one;
- **Tracking not set up** when Easyship is connected without a **Webhook
  secret key** (see [Tracking webhooks](#tracking-webhooks)).

A workspace ships through one label platform at a time: while Easyship is
connected, Sendcloud isn't offered, and the other way round. ShipperHQ can sit
beside either.

### Easyship {#easyship}

- **API access token**: in Easyship, **Connect → API Integration**. A sandbox
  token (it starts with `sand_`) buys test labels, and the account is marked
  **Test**.
- **Webhook secret key**: optional. The secret key of the Easyship webhook that
  sends tracking to Aglyn (it starts with `webh_`). See
  [Tracking webhooks](#tracking-webhooks).
- **Item category**: optional. The Easyship item category your products ship
  as, used when a product has no **HS tariff code**.

Easyship buys from the couriers you have on your Easyship account.

### Sendcloud {#sendcloud}

- **Public key** and **Secret key**: in Sendcloud, **Settings → Integrations →
  Sendcloud API**. The secret key also signs the tracking updates Sendcloud
  sends to Aglyn.

Sendcloud buys from the carriers and contracts you switched on in your
Sendcloud panel. Sendcloud has no sandbox, so every Sendcloud label is real.

### ShipperHQ {#shipperhq}

- **API key**: in ShipperHQ, **Websites →** your website.
- **Authentication code**: from the same page in ShipperHQ.
- **Scope**: **Live**, **Test**, **Development** or **Integration**. Any scope
  but **Live** marks the account **Test**.
- **Weight unit in ShipperHQ**: **Pounds** or **Kilograms**, as your ShipperHQ
  rules use.

ShipperHQ prices checkout only. It doesn't buy labels: those still come from
your Easyship or Sendcloud account, or from the platform's carrier accounts.

To use it at checkout, add a rate with the **Type** **Carrier rates** to a zone
on the **Shipping** card under **Products → Shipping & delivery**, as described
in [Carrier rates at checkout](./shipping-labels-and-live-rates.md#carrier-rates-at-checkout).
Shoppers are then offered the methods and prices your ShipperHQ rules give for
their address. The rate has no services to pick, because your ShipperHQ rules
decide what is offered. Its **Markup (%)** and **Handling fee ($)** are still
added, and its fallback rate is still offered when ShipperHQ doesn't answer.
ShipperHQ doesn't need a ship-from address in Aglyn, because the origins come
from your ShipperHQ rules.

Aglyn sends ShipperHQ parcels, not products: rules on weight, price,
destination and carrier apply, but rules on a product's shipping group don't.

## Tracking webhooks {#tracking-webhooks}

Easyship and Sendcloud send tracking updates to Aglyn by webhook. Once an
account is connected, its row shows a **Webhook address** to copy.

- **Sendcloud**: in Sendcloud, open your API integration, turn on webhook
  feedback and paste the address. Updates are signed with your secret key, so
  there is nothing else to enter.
- **Easyship**: in Easyship, add a webhook for tracking status changes with the
  address. Easyship gives the webhook a secret key. Because the key can only be
  entered when you connect, select **Disconnect**, then connect Easyship again
  with the same **API access token** and the **Webhook secret key**. The
  **Tracking not set up** chip goes away.

When updates arrive, they move your orders exactly as on the platform's
accounts: the order's timeline, the label's tracking status, and the
**Delivered** status and email once every parcel has arrived.

## What changes when you ship on your own account {#what-changes}

While Easyship or Sendcloud is connected:

- **Shipping labels** card: its subheading names your service, and **Paying
  for labels** says labels are bought on your own account, which bills you for
  each one.
- **Carrier accounts** card: hidden. Your couriers and carriers are chosen in
  your account at the service.
- **Services offered at checkout**: there is no list to narrow, so checkout
  offers every service your account quotes.
- **Address checks**: not made. Paid orders show no address warnings, and
  **Check address** gives no answer.
- **Shipments you record by hand** aren't followed. Only labels bought through
  your account get tracking updates.
- **Labels from Sendcloud**, and Easyship labels Easyship gives as a file
  rather than a link, are opened through Aglyn with your account each time
  you print them.
- **Void** cancels the shipment at the service. Easyship answers at once;
  Sendcloud may show **Refund pending** first. Any refund comes from the
  service, not from Aglyn.

## Disconnect {#disconnect}

Select **Disconnect** on the account's row and confirm.

- **Easyship or Sendcloud**: labels already bought stay on their orders, but
  you can only void them in your account at the service. New labels and rates
  use the platform's carrier accounts when the platform has them; otherwise no
  new labels can be bought until another account is connected.
- **ShipperHQ**: checkout goes back to the carriers' own rates.

Disconnecting deletes the credentials from Aglyn.

## Troubleshooting {#troubleshooting}

| The console says | What to do |
| --- | --- |
| Enter the *field*. | Fill in every required field for the service. |
| Pick a *field* from the list. | Choose the **Scope** or **Weight unit in ShipperHQ** from the list. |
| The service did not accept those credentials. | Copy the keys again from the service. The service's own words may show instead. |
| ShipperHQ did not accept that API key and authentication code. | Copy both again from **Websites →** your website in ShipperHQ, and check the **Scope**. |
| ShipperHQ could not be reached. | Try again in a few minutes. |
| This workspace ships through *service*. Disconnect it first. | One label platform at a time: disconnect the other one first. |
| That service is not offered on this deployment. | The service isn't available to connect yet. |
| Only a workspace member who manages billing can change this | Ask a member with **Manage billing** to connect or disconnect. |
| Not permitted | You need to be an **admin** of the site. |
| **Tracking not set up** on the Easyship row | Add the **Webhook address** in Easyship, then reconnect with the **Webhook secret key** (see [Tracking webhooks](#tracking-webhooks)). |
| Sendcloud parcels never change status | Check that webhook feedback is on in your Sendcloud API integration and that it has the **Webhook address** from the card. |
| This label was bought through another shipping account. Void it there. | The label was bought on an account that is no longer the one you ship through. Void it in that account. |
| This label’s shipping account is no longer connected. | The label's file is served through the account you disconnected. Open the label in your account at the service. |

## Related

- [Shipping labels and live carrier rates](./shipping-labels-and-live-rates.md)
- [Shipping](./shipping.md): zones, rates and where each location ships from
- [Use ShippingEasy with Aglyn](./use-shippingeasy.md)
