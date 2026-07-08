---
sidebar_position: 1
title: Commerce
description: Sell products with a product block and checkout, and manage orders, inventory, and coupons.
---

# Commerce

Aglyn's **commerce** features let you sell directly from your site — add products, drop a
product block on a screen, take payment at checkout, and manage what comes after the sale.

```mermaid
sequenceDiagram
  participant V as Visitor
  participant S as Your site
  participant St as Stripe
  V->>S: Add product to cart
  V->>S: Checkout
  S->>St: Collect payment
  St-->>S: Payment confirmed
  S-->>V: Receipt
  S->>S: Create order, adjust inventory
```

:::info Plan availability
**Paid**. Selling requires a paid tier; payments run through Stripe.
:::

## Starter selling

1. Create **products** with pricing.
2. Add the **product block** to a screen in the Besigner.
3. Visitors buy through **checkout**; completed purchases become **orders**.

## Commerce v2

Beyond the basics, commerce v2 adds:

- **Receipts** for completed orders.
- **Inventory** tracking.
- **Coupon codes** for discounts.

## Manage orders

The console **orders** page supports **filters** and **CSV export**, so you can reconcile
sales and pull data into other tools.

## Related

- [Bookings & scheduling](../bookings/overview.md) (for services and appointments)
- [Billing & plans](../billing-and-plans/overview.md)
