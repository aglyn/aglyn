---
sidebar_position: 4.75
title: Review platforms (Trustpilot and Yotpo)
description: Invite customers to review your store on Trustpilot after their order ships or arrives, by copying an order email to your Trustpilot invitation address, or with your own Trustpilot or Yotpo Reviews keys.
---

# Review platforms: Trustpilot and Yotpo

Your store has its own product reviews built in, and they stay the reviews your
product pages show. If you also collect reviews on **Trustpilot** or **Yotpo
Reviews**, connect that account and Aglyn asks it to invite each customer once
their order is on its way or has arrived.

Each service uses your own account; Aglyn does not sell one. They come with every
plan that includes selling, at no extra cost.

## Who is invited {#who-is-invited}

A review invitation is marketing email: you are asking, the customer's order does
not require it. So an order's customer is invited only when:

- they agreed to marketing email from your store (for example, by ticking the
  marketing box at checkout) and have not unsubscribed. An email that bounced or was
  reported as spam counts as unsubscribed, as it does for your campaigns;
- the order was paid with real money: test-mode orders are never sent;
- the order was not canceled or fully refunded by the time the invitation is due;
- the order has an email address.

Each order is invited **once** per service, however many packages it ships in and
however many emails it sends.

## Trustpilot {#trustpilot}

Go to **Commerce → Settings** and find the **Trustpilot** card. Under **How
Trustpilot hears about orders**, choose one way, and under **When to invite**,
choose:

- **When the order ships, goes out for delivery or is picked up**, or
- **When the order is delivered or picked up.**

Trustpilot's own delay setting still applies after that.

### By your invitation address {#trustpilot-invitation-address}

Trustpilot gives every business an Automatic Feedback Service address that ends in
`@invite.trustpilot.com`. No key is needed:

1. Copy that address from your Trustpilot Business account.
2. On the **Trustpilot** card, choose **Copy an order email to my Trustpilot
   invitation address** and paste it in **Trustpilot invitation address**. Only an
   address on `invite.trustpilot.com` is accepted.
3. Select **Save** in the card's header.

The customer's **Order shipped**, **Order out for delivery**, **Order picked up**
or **Order delivered** email (whichever comes first at the moment you chose) is
then blind-copied to Trustpilot, with the customer's name, email and order number
in a part of the email only Trustpilot reads. The customer does not see the copy.
If you turn that email off under [Order notifications](./order-notifications.md),
no copy is sent.

### By your Trustpilot API key {#trustpilot-api}

:::caution Rolling out
The API option is **not yet available** on aglyn.com-hosted workspaces. Until it
is, the card offers the invitation address only.
:::

If your Trustpilot plan includes API access, you can send invitations through it
instead:

1. In Trustpilot Business, under **Integrations → Developers → APIs**, create or
   copy an API key and secret.
2. On the **Trustpilot** card, choose **Trustpilot API, with my API key**, and paste
   the **API key**, **API secret** and your **Business unit ID**. Add your
   **Business user ID**, a **Language** such as `en-US`, and an **Invitation
   template ID** if you use them.
3. Select **Save**. Aglyn checks the key with Trustpilot before keeping it, and never
   shows it again; **Disconnect API** removes it.

Invitations sent this way ask for a review of your store, not of each product.

## Yotpo Reviews {#yotpo-reviews}

:::caution Rolling out
Yotpo Reviews is **not yet available** on aglyn.com-hosted workspaces. Until it is,
no Yotpo Reviews card appears.
:::

1. In your Yotpo Reviews settings, copy the **app key** and **secret key**. These
   are not the keys of Yotpo Loyalty & Referrals, which connects under
   [Rewards](./connect-smile-io-or-yotpo.md).
2. On the **Yotpo Reviews** card under **Commerce → Settings**, paste both, turn on
   **Send shipped orders to Yotpo for review requests**, and select **Save**.

When an order first ships or is picked up, Aglyn sends it to Yotpo with its items,
marked fulfilled, and Yotpo sends the customer its review request after the delay
set in your Yotpo account.

## On the order {#on-the-order}

An order's details show a **Review invitations** section once a service was asked
about it: **Invited**, with how and when, or **Not invited**, with the reason, such
as a customer who has not agreed to marketing email.

## Switching it off for a site {#switching-it-off-for-a-site}

Choose **Off** on the Trustpilot card or turn off the Yotpo switch, or turn off
**Review platforms** for the site in its plugin settings. New orders are not sent;
reviews already collected stay in your Trustpilot and Yotpo accounts.

## Related

- [Order notifications](./order-notifications.md)
- [Tracking and protection](./tracking-and-protection.md)
