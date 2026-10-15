---
sidebar_position: 6
title: Connect Attentive
description: Send a site's contacts, their email marketing consent and its orders to your own Attentive account, for Attentive's journeys. Rolling out.
---

# Connect Attentive

:::note Rolling out
Attentive appears in your console only once it is available on the platform
you use. Until then, the **Email platforms** card has no **Attentive** row, and
the other [email platforms](./email-platforms.md) work as usual.
:::

Connect your **Attentive** account to a site, and Aglyn sends the site's
contacts and their email marketing consent to it, along with orders and started
checkouts that Attentive journeys can start from.

Attentive works like the other [email platforms](./email-platforms.md),
with three differences: you connect by signing in to Attentive rather than with
an API key, it goes one way only, and there is no list or tag to choose.

## Before you start {#before-you-start}

- **Role:** you need to be an **admin** of the site to connect, change or
  disconnect Attentive. Editors can see the card and the sync log.
- **Verified email:** verify your email address first.
- **An Attentive login** that can install apps on your Attentive account.

## Connect Attentive {#connect}

1. Open the site, then **Setup → Integrations**. The **Email platforms** card
   lists each platform on a row of its own.
2. On the **Attentive** row, select **Connect**, then **Connect with
   Attentive**.
3. Attentive opens. Sign in and approve the install. Aglyn asks Attentive only
   to write subscriptions, events and e-commerce events.
4. Attentive sends you back to the site's **Integrations** page. The
   **Attentive** row shows **Syncing** and your Attentive company name.

The first sync starts within 15 minutes. **Sync now** runs it straight away.

Finish on Attentive's page within 10 minutes. If you cancel there, or take
longer, the row shows **Connect again**: select it, then **Connect with
Attentive**.

## What is sent {#what-is-sent}

- **Contacts and consent go out.** Everyone the site may send marketing to is
  subscribed to **email** marketing in Attentive, with their email address and,
  when it is in international format (like `+15551234567`), their phone number.
  Someone the site must not market to (they unsubscribed, declined, bounced,
  complained or were erased) is unsubscribed from email marketing in Attentive.
  The first sync sends everyone; after that, only the people whose record
  changed.
- **Orders go out.** For each person the site may market to:

  | In Aglyn | In Attentive |
  | -- | -- |
  | A paid order | A **purchase** event, with each product, its price and quantity. |
  | A started checkout | A custom event named **Started Checkout**, with the link back to the checkout when there is one. |
  | A fulfillment | A custom event named **Order Fulfilled**, with the tracking link when there is one. |
  | A refund | A custom event named **Order Refunded**. |
  | A cancellation | A custom event named **Order Canceled**. |

  The custom events carry the order's number, value and currency. An event more
  than a week old is not sent.

Names, tags, lifetime value and order counts are not sent to Attentive.

## Who is sent {#who-is-sent}

Each person is sent with the answer the site's own campaigns would give them:
subscribed when the site may send them marketing, unsubscribed when they
unsubscribed, declined, bounced, complained or were erased. Someone with no
consent on record that the site may use is **not sent at all**: Aglyn does not
copy an address it has no standing to market to.

### Unsubscribes in Attentive stay in Attentive {#unsubscribes-stay-in-attentive}

Attentive does not report unsubscribes back, so Aglyn cannot tell that someone
left there:

- Someone who unsubscribes in Attentive is not unsubscribed from the site's own
  campaigns, and the row's count of **subscription changes read back** stays at
  zero.
- When that person's record changes on the site later, for example with a new
  order, Aglyn sends Attentive a subscription for them again.

To stop both, add them to the site's unsubscribe list as well.

## Settings {#settings}

Once Attentive is connected, its row shows:

- **Sync contacts and unsubscribes:** turn off to stop sending contacts and
  consent while keeping the connection.
- **Send orders and started checkouts:** turn off to stop sending events.
- **Pause:** stops the sync until you select **Resume**. Orders that happen
  while it is paused are not sent later.

The row also shows when it last synced and how many contacts and events it has
sent.

## The sync log {#sync-log}

Select **Sync log** on the **Attentive** row to open it. It lists what each run
sent and every error, newest first. Each entry is marked **Synced**, **Error**
or **Event not sent**.

The row's status tells you where the connection stands:

- **Syncing:** working normally; it runs about every 15 minutes.
- **Paused:** you paused it. Select **Resume**.
- **Stopped:** Attentive failed many times in a row (it was retried with
  growing waits). Fix the cause shown, then select **Sync now**.
- **Connect again:** Attentive refused the connection (the app was removed or
  its access changed). Select **Connect again**, then **Connect with
  Attentive**. Your settings are kept.

When Attentive asks Aglyn to slow down, the sync waits as long as it was told
and carries on. Nothing is lost.

## Troubleshooting {#troubleshooting}

| You see | What it means, and what to do |
| -- | -- |
| No **Attentive** row on the **Email platforms** card | Attentive isn't available on your workspace yet. See the note at the top of this page. |
| **Email platform connections come with the plans that include the CRM** | Your workspace's plan doesn't include email platform connections. |
| **Not permitted** | Only a site admin can connect or change Attentive. |
| **Verify your email address first** | Verify your email address, then try again. |
| **Attentive cannot be connected that way here** | Attentive isn't available to connect right now. |
| **This deployment has no console address to come back to** | The connection can't be finished from this console. Contact support. |
| **This link is not valid. Start connecting again from the console.** | The link back from Attentive was already used or was not one Aglyn started. Start again from the card. |
| **Attentive refused the connection: …** | The status changes to **Connect again**. Connect again. |
| **The stored credential could not be opened. Connect again.** | Connect again. |
| **Attentive asked us to slow down** | Nothing to do; the sync waits and carries on. |
| **Attentive could not be reached** or **Attentive had a problem (…)** | Retried on its own, waiting longer each time. |
| **Attentive did not take the … event for order …: …** | Attentive refused one event, after repeated tries. The rest still go. |
| **Connect again first** | The connection needs **Connect again** before you can pause, resume or sync it. |
| **Resume the connection first** | The connection is paused. Select **Resume**, then **Sync now**. |
| **Your plan no longer includes marketing platforms, so this connection is not syncing.** | The sync picks up again once your workspace's plan includes email platform connections. |

## Disconnect {#disconnect}

Select **Disconnect** on the **Attentive** row and confirm. Aglyn deletes the
stored connection, the sync log and any orders not yet sent, and sends nothing
more to Attentive. Contacts already in Attentive stay there.
