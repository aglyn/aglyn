---
sidebar_position: 4.8
title: Rewards, referrals and store credit
description: Give customers points on every order, online and at the register, let them spend points and store credit at checkout or the till, and reward members whose friends buy.
---

# Rewards, referrals and store credit

**Rewards** is your store's own loyalty program. Customers earn points on every order —
online and at the register — and spend them like store credit. Members can share a
referral code that takes money off a friend's first order and earns the member store
credit. You can also give any customer store credit by hand, beside your
[gift cards](overview.md).

Rewards comes with every plan that includes selling, at no extra cost. It is off until
you turn it on, so nothing changes for your customers until you do.

## Set up your program

1. Go to **Products → Promotions** and find the **Rewards** card.
2. Turn on **Customers earn and spend rewards**.
3. Set the rates:
   - **Points per dollar spent** — how many points each whole dollar of goods earns.
   - **Points for $1 off** — what points are worth when a customer spends them. With
     the defaults, 5 points per dollar and 100 points for $1 off, a customer gets back
     5% of what they spend. The card shows the rate as you change it.
   - **Points needed to redeem** — a customer spends points once they hold at least
     this many.
   - **Welcome points** — given with a customer's first order. Leave it at 0 for none.
4. Select **Save** in the card's header.

The card also shows how many members you have, the points they hold and what those
points are worth, and the store credit they hold. Points and store credit are money
your store owes, so keep an eye on these figures.

Only a site admin can change the program; anyone on the site can read it.

## How customers earn

A customer joins the first time they place an order with an email address while
rewards are on. Each order earns points on the **goods they paid for**: the items,
less any discount and less any rewards they spent. Shipping, tax and tips never earn
points, and points spent on an order never earn more points.

Points are added once per order, shortly after it is paid, whether the order came from
your online store or your register. A register sale earns points when you attach a
customer with an email address to it.

## Spending rewards online

Every member has a **rewards code**, such as `RW-7K3P-Q9XZ-2M4D`, sent in each rewards
email. When rewards are on, your cart shows a **Rewards code** field. A customer enters
their code and checkout takes their store credit first, then their points, up to what
is left to pay on the goods after other discounts and gift cards.

The balance is held while the customer pays, so the same points cannot be spent twice
at once. If they leave without paying, the hold is let go.

A rewards code is like a gift card code: anyone who has it can spend the balance.
Customers should keep it private.

## At the register

When rewards are on, the register's tender buttons include **Rewards**. Select it, then
either:

- type the customer's email (or the start of it) or their rewards code and select
  **Find**, then pick their account to take what it can pay; or
- type a code the customer reads out and select **Apply code**.

Rewards can pay part of a sale and another tender the rest. **Void sale** gives back
any rewards it took.

## Referrals

Turn on **Members can refer friends** in the Rewards card, then set:

- **Friend's first-order credit** — taken off a friend's first order when they use a
  member's referral code.
- **Friend's minimum order** — the smallest order the credit applies to. 0 for any.
- **Member's reward** — store credit the member earns once the friend's order is paid.

Each member has a **referral code**, such as `RF-7K3P9X`, shown in their rewards emails.
A friend enters it in the **Rewards code** field in the cart, with their own email. The
credit is for a friend's first order only: it is refused for an email that has already
ordered or already used a referral, and a member cannot use their own code. At the
register, attach the friend's email to the sale before applying the code.

## Members and store credit

The **Rewards members** card under **Products → Promotions** lists every member, newest
first. Sort by most points, or type the start of an email to find someone. Select a
member to see their points, store credit, rewards and referral codes, and their last
fifty changes.

- **Adjust** adds or takes away points or store credit for a member, with a note kept
  in their history.
- **Give store credit** in the card's header does the same for any email, and makes
  them a member if they are not one yet. Turn on **Email the customer when credit is
  added** to send them their new balance and rewards code.

Adjusting balances needs an editor or admin on the site.

## On an order

An order's dialog shows a **Rewards** section when rewards touched it: the points it
earned and for whom, the rewards it spent, and anything a refund changed.

## Refunds and cancellations

- **Points earned** come back off the member in proportion to the money refunded, and
  all of them when an order is fully refunded or canceled. A member who already spent
  those points can end up with a negative balance, which new orders fill back in.
- **Rewards spent online** are given back in the same proportion.
- **Rewards spent at the register** go back to the member when you refund that payment
  in a register return, and when you void the sale.
- A friend's referral credit is a discount, so nothing is given back for it.

## Emails

Rewards sends members three emails, on by default:

- **Rewards points earned** — the points an order earned, their balance and their codes.
- **Store credit given** — when you give them store credit.
- **Referral reward** — when a friend's first order earns them store credit.

Design them like your other store emails, in your site's theme. To stop all three, turn
off **Email members what they earn and are given** in the Rewards card.

## Switching it off for a site

Turn off **Customers earn and spend rewards** to stop new points and hide the rewards
field and tender. Members keep their points and store credit, and refunds still take
back points from orders placed while it was on.
