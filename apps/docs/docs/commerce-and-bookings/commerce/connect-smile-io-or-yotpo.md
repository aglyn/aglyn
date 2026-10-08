---
sidebar_position: 4.81
title: Connect Smile.io or Yotpo Loyalty
description: Keep your members' points in your own Smile.io or Yotpo Loyalty account, earned and spent on every Aglyn order, online and at the register. Rolling out.
unlisted: true
---

# Connect Smile.io or Yotpo Loyalty

:::caution Rolling out
Connecting a rewards account is **not yet available** on aglyn.com-hosted workspaces.
Until it is, no **Rewards account** card appears under your store's Promotions, and
your store runs the built-in [Rewards](rewards-and-referrals.md) program.
:::

If you already run a loyalty program in **Smile.io** or **Yotpo Loyalty & Referrals**,
connect that account and your members' points stay there. Aglyn's checkout and register
earn and spend those same points:

- **Every paid order** earns points at your store's rate, written to the member's
  account.
- **Customers spend their points** at checkout with their rewards code, and at the
  register when a cashier looks them up by email. The balance is read from your account
  first, so a customer never spends points they no longer have.
- **Refunds and cancellations** take back the points an order earned, and give back the
  points it spent, in proportion to what was refunded.
- **Your own changes** to a member's points in Aglyn are written to your account too.

A store runs one program at a time. While an account is connected, Aglyn's built-in
points, welcome points and referral rewards are off, so nobody is rewarded twice. Store
credit you gave by hand stays spendable.

## Connect your account

1. Open your store, go to **Promotions**, and find the **Rewards account** card.
2. Choose **Smile.io** or **Yotpo Loyalty** and paste your credentials:
   - **Smile.io**: an API key. In Smile Admin, open **Settings → Developer** and create
     a key with the customer read, points transaction read and points transaction write
     scopes. Smile.io offers API keys on its Plus and Enterprise plans.
   - **Yotpo Loyalty**: your **GUID** and **API key**, both on the Settings page of the
     Yotpo Loyalty admin.
3. Select **Connect**. Aglyn checks the credentials with the service before it keeps
   them, and stores the API key encrypted.

If members already hold points in the built-in program, Aglyn asks before it replaces
them: from then on each member's balance is the one in your Smile.io or Yotpo account.

Your store's **Points per dollar spent**, **Points for $1 off** and **Points needed to
redeem** still decide what each order earns and what points are worth at checkout.

## Who earns

- **Yotpo Loyalty** enrolls a customer it does not know yet with their first order.
- **Smile.io** API keys cannot add customers, so a customer who is not in your Smile.io
  program yet is listed as **Not a member there**. Their points are sent once they join
  and you select **Send again**.

Orders paid in Stripe test mode never move real points.

## When something is not sent

Points are sent the moment an order is paid, refunded or changed. Anything your account
could not take, because it was busy, unreachable or refused the credentials, waits on
the **Rewards account** card with its reason. Select **Send again** to retry. Each
movement is sent once: a retry never adds points twice.

If a refund takes back more points than a member has left, because they already spent
them, the balance goes to zero and the rest is noted on the movement.

## Disconnect

Select **Disconnect** on the card. Rewards turns off, and members keep their points in
your Smile.io or Yotpo account. If you turn the built-in program on again later, every
member starts at zero points.
