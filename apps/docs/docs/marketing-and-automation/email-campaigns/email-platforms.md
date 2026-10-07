---
sidebar_position: 5
title: Email platforms (Mailchimp, Klaviyo, Omnisend)
description: Keep your contacts and their unsubscribes in step with your own Mailchimp, Klaviyo or Omnisend account, both ways, and send your orders to Klaviyo and Omnisend for their abandoned-cart and post-purchase flows. Rolling out.
unlisted: true
---

# Email platforms: Mailchimp, Klaviyo and Omnisend

:::caution Rolling out
Email platform connections are **not yet available** on aglyn.com-hosted
workspaces. Until they are, no **Email platforms** card appears on your
site's setup page.
:::

If you already send newsletters or automated flows from **Mailchimp**,
**Klaviyo** or **Omnisend**, connect your account to a site and Aglyn keeps it
in step with the site's contacts:

- **Contacts go out.** Everyone the site holds that it may send marketing to is
  added or updated in your account, with their name, phone number, tags,
  lifetime value and order count. The first sync copies everyone; after that,
  only the people who changed.
- **Unsubscribes go both ways.** Someone who unsubscribes from your site's
  emails is unsubscribed in your account. Someone who unsubscribes in
  Mailchimp, Klaviyo or Omnisend is unsubscribed from the site's own campaigns
  too, and your contact's record says where they left.
- **Orders go to Klaviyo and Omnisend.** Started checkouts, paid orders (with
  each product), fulfillments with tracking, refunds and cancellations, for the
  abandoned-cart and post-purchase flows those platforms build on.

Email platform connections come with every plan that includes the CRM, at no
extra cost.

## Connect a platform {#connect}

1. Open the site, then **Setup**. Scroll to **Email platforms**.
2. On the platform's card, select **Connect**.
3. Paste your API key, then **Check and connect**. Aglyn checks the key with
   the platform before it saves it, and stores it encrypted; it is never shown
   again.
   - **Mailchimp:** in Mailchimp, **Profile → Extras → API keys → Create a
     key**. It ends in your data center, like `-us21`.
   - **Klaviyo:** in Klaviyo, **Settings → API keys → Create private API key**,
     with full access to Profiles, Lists, Subscriptions and Events.
   - **Omnisend:** in Omnisend, **Store settings → API keys → Create API key**,
     with access to Contacts and Events.
4. For Mailchimp and Klaviyo, choose the **audience** or **list** contacts go
   into. If your account has only one, it is chosen for you.

The first sync starts within 15 minutes. **Sync now** runs it straight away.

Only a site admin can connect, change or disconnect a platform; editors can see
the card and its log.

## Who is sent, and as what {#who-is-sent}

Each person is sent with the answer the site's own campaigns would give them:

| On the site | In your platform |
| --- | --- |
| Gave consent to marketing (or is covered by your workspace's consent policy), and has not unsubscribed, bounced or complained | Subscribed — but only when they are **new** to your platform. Someone who unsubscribed there is never subscribed again by Aglyn. |
| Unsubscribed, declined, bounced, complained or was erased | Unsubscribed |
| No consent on record that the site may use | **Not sent at all.** Aglyn does not copy an address it has no standing to market to. |

Order events are sent only for people the site may market to, and an event
more than a week old is not sent.

## When someone unsubscribes in your platform {#unsubscribes-from-the-platform}

Every sync reads back who unsubscribed in your account since the last one,
before it sends anything, and adds them to the site's unsubscribe list. The
site's campaigns, sequences and automated emails stop for them, and their
contact record shows **Unsubscribed in Mailchimp** (or Klaviyo, or Omnisend).

If they later **resubscribe in that same platform**, the next sync lifts that
unsubscribe again. Nothing else is lifted that way: an unsubscribe the person
made on your site, a bounce, a complaint or an unsubscribe another platform
reported stays in place.

Omnisend reports unsubscribes but not resubscribes, so a return in Omnisend
does not lift the site's unsubscribe.

## Settings {#settings}

- **Audience / List** — where contacts go. Choosing a different one copies
  everyone into it on the next sync.
- **Tag** — every contact this site sends carries it, so you can build a
  segment of them. `Aglyn` unless you change it.
- **Sync contacts and unsubscribes** — turn off to stop contacts and consent
  syncing while keeping the connection.
- **Send orders and started checkouts** — Klaviyo and Omnisend only.
- **Pause** — stops the sync until you **Resume**. Orders that happen while it
  is paused are not sent later.

## The sync log, and when something goes wrong {#sync-log}

Each connected platform has a **sync log** under its card: what each run sent
and read back, and every error, newest first.

- **Syncing** — working normally; it runs about every 15 minutes.
- **Stopped** — the platform failed many times in a row (it was retried with
  growing waits). Fix the cause shown, then **Sync now**.
- **Connect again** — the platform refused the key (it was deleted, or its
  access changed). Create a new key and connect again; your settings are kept.

When the platform asks Aglyn to slow down, the sync waits as long as it was
told and carries on — nothing is lost. A person the platform will not take
(for example an address it has permanently deleted) is skipped and named in
the log, and the rest go on.

## Disconnect {#disconnect}

**Disconnect** deletes the stored key, the log and any orders not yet sent.
Nothing more is sent to the platform. Contacts already in your account stay
there, and unsubscribes already read back stay on the site's list.

## One-off imports {#one-off-imports}

To bring a list in once, without connecting — for example an old Mailchimp
audience export — use **Import** on the site's contacts or suppressions instead.
