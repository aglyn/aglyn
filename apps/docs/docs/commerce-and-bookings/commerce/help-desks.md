---
sidebar_position: 4.78
title: "Help desks (Gorgias, Re:amaze, Kustomer, Gladly and Richpanel)"
description: "Show your support team each buyer's recent orders beside their tickets in your own Gorgias, Re:amaze, Kustomer, Gladly or Richpanel account, and send contact form messages there as new tickets. Rolling out."
---

# Help desks: Gorgias, Re:amaze, Kustomer, Gladly and Richpanel

:::note Rolling out
Help desks appear in your console only once they are available on the platform
you use. Until then, the site's **Integrations** page has no **Help desks**
card, and contact form messages arrive in your [Inbox](../../content-and-data/forms/overview.md)
as usual.
:::

Connect the help desk your support team already works in, and Aglyn keeps it
up to date with your store. Each customer who has ordered from the site is added
to the help desk with their recent orders, so an agent answering a ticket sees
what that person bought, when, for how much and where the order stands, with a
link to the order in your console.

If you choose, messages sent through the site's forms can also open as new
tickets in the help desk, from the person who sent them.

Each help desk uses your own account, connected with your own API credentials;
Aglyn does not sell one and never asks for your password.

## Before you start {#before-you-start}

- **Role:** you need to be an **admin** of the site to connect, change or
  disconnect a help desk. Editors can see the card and the sync log.
- **Verified email:** verify your email address first.
- **A plan that includes your store.** Help desks carry your buyers and their
  orders, so they come with the plans that include selling.
- **Your help desk's API credentials**, listed for each help desk below.

## Connect a help desk {#connect}

1. Open the site, then **Setup → Integrations**. The **Help desks** card lists
   each help desk on a row of its own.
2. On your help desk's row, select **Connect**.
3. Fill in the fields it asks for (see below), then select **Check and
   connect**. Aglyn checks the details with the help desk before keeping them,
   stores the key encrypted and never shows it again.
4. The row shows **Syncing**. The first sync starts within 15 minutes.

### What each help desk asks for {#credentials}

| Help desk | What to enter |
| --- | --- |
| **Gorgias** | Your **Gorgias domain** (`acme` for `acme.gorgias.com`), and the **username** and **API key** Gorgias lists in its REST API settings. |
| **Re:amaze** | Your **Re:amaze brand** (`acme` for `acme.reamaze.io`), the **email you sign in with**, and your **API token** from **Settings → Developer → API Token** in Re:amaze. |
| **Kustomer** | An **API key** from **Settings → Security → API Keys** in Kustomer, with roles to read and write customers, custom objects and messages, and to read Klasses. Creating a key needs an administrator in Kustomer. |
| **Gladly** | Your **Gladly organization** (`acme` for `acme.gladly.com`), and the **email** and **API token** of a Gladly user with the **API User** permission. |
| **Richpanel** | Your **API key** from **Settings → Integrations → API Keys**, your store's **app client ID** from **Settings → Connected Apps**, and the **support email address** your Richpanel email channel receives mail at. |

You can type the domain, brand or organization as the whole address; Aglyn
keeps only the first part.

## What your agents see {#what-agents-see}

Aglyn sends each person who has **ordered** from the site, by their email
address, with their name and, when it is in international format, their phone
number. People who have never ordered, such as newsletter subscribers or leads,
are not sent.

On the first sync, Aglyn sends the site's paid orders from the **90 days**
before you connected. After that, each order is sent when it is paid, and again
when it is fulfilled, delivered, refunded or canceled, so its status stays
current. Test-mode orders are never sent.

Each order carries its number, date, status, total, refunded amount, items and
a link that opens it in your console.

| Help desk | Where orders appear |
| --- | --- |
| **Gorgias** | On the customer as **customer data**: their latest order and their 10 most recent orders. Show it in the ticket sidebar the way you show any customer data in Gorgias. |
| **Re:amaze** | On the contact as **customer data attributes**: **Last order**, **Last order items**, **Last order link** and **Recent orders**. |
| **Kustomer** | Each order as a **custom object** on the customer's timeline, updated as the order changes. Choose which custom object in **Orders object** (see [Settings](#settings)). |
| **Gladly** | Each order as an activity on the customer's timeline, with a **View order** link. A new activity is added when the order's status changes. |
| **Richpanel** | Each order in the customer's **order history**, updated as the order changes. |

## Send contact form messages as tickets {#contact-form-tickets}

This is **off** until you turn it on. On the connected help desk's row, turn on
**Send contact form messages to** your help desk. From then on, each message
someone submits through any of the site's forms opens a new ticket from its
sender:

| Help desk | What a message becomes |
| --- | --- |
| **Gorgias** | A new ticket from the customer. |
| **Re:amaze** | A new conversation in the **Channel** you choose. |
| **Kustomer** | A new conversation from the customer, as an inbound email message. |
| **Gladly** | A task for the customer in the **Inbox** you choose, due a day after the message arrives. |
| **Richpanel** | A new email ticket from the customer to your support email address. |

The ticket's subject is the message's **subject** answer, or the form's name and
the sender's name. Its text is the message, then the form's other answers, then
the form's name and the page it was sent from.

A few things to know:

- **The sender must give an email address.** A message with no email address
  has nobody to reply to, so it is not sent.
- **Only new messages are sent.** Messages submitted before you turned this on
  stay in your Inbox only.
- **Your Inbox still gets every message.** Sending to a help desk is in
  addition to the Inbox, not instead of it.

## Settings {#settings}

Each connected help desk's row has:

- **Channel** (Re:amaze), **Inbox** (Gladly) or **Orders object** (Kustomer):
  where contact form messages or orders go. The menu lists what your help desk
  has; if it is empty, add one in your help desk, then connect again. Until you
  choose, the row says what it is waiting for.
- **Send buyers and their orders**, on by default.
- **Send contact form messages to** your help desk, off by default.
- **Pause** and **Resume**, which stop and restart everything for this help
  desk. While paused, nothing new is queued for it.

## The sync log {#sync-log}

Aglyn syncs every 15 minutes. **Sync now** runs it at once; anything left over
continues in the background. **Sync log** lists recent runs, what each sent,
and anything the help desk refused, newest first.

When something goes wrong, the row says so:

- **Connect again**: the help desk no longer accepts the details you entered.
  Select **Connect again** and enter them fresh.
- **Stopped**: the sync failed many times in a row. Fix what the message
  describes, then select **Sync now**.
- An order or message the help desk refuses is tried again for a while, then
  listed in the sync log as **Not sent**, and the rest carry on.

## Disconnect {#disconnect}

Select **Disconnect** on the help desk's row and confirm. Nothing more is sent
to it, and the stored key, the sync log and any orders or messages not yet sent
are deleted. Customers, orders and tickets already in your help desk stay there.

To stop it for one site without disconnecting, turn off **Help desks** for that
site in its plugin settings.

## Related

- [Orders and returns](./orders-and-returns.md)
- [Forms](../../content-and-data/forms/overview.md)
- [Email platforms](../../marketing-and-automation/email-campaigns/email-platforms.md)
