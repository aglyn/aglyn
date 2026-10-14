---
sidebar_position: 4.4
title: Dropship suppliers
description: Send each paid order to the supplier that ships it, by email or a signed webhook, and let the supplier record the tracking number without an Aglyn account.
---

# Dropship suppliers

When a supplier ships some of your products for you, Aglyn can send each paid
order for those products straight to them. The supplier gets the items, the
shipping address and a link to record the tracking number, and the order is
marked shipped when they use it. Suppliers need no Aglyn account.

Dropship suppliers are part of the **Pro** plan and above. On a lower plan the
**Dropship suppliers** card offers an upgrade instead, and no order is sent.

## Add a supplier {#add-a-supplier}

The **Dropship suppliers** card, in the store's settings, lists the partners
that ship orders for you: select **Add supplier**, enter its name and how it
hears about orders, and select **Save**.

1. Open your site's **Products** page and choose **Settings**.
2. On the **Dropship suppliers** card, select **Add supplier**.
3. Enter the supplier's **Name**.
4. Choose how it hears about orders. Fill in one or both:
   - **Notification email**: gets each order's details and a tracking link.
   - **Webhook URL**: an address on the supplier's own system that receives
     each order as JSON. See [Webhook orders](#webhook-orders).
5. Select **Save**.

Each supplier's row shows its email and webhook address, or **No delivery
method set**. **Edit** changes a supplier. **Remove** deletes it after you
confirm: its products stop being sent, and orders already sent are not
affected.

## Assign products to a supplier {#assign-products}

A supplier is told only about the products you assign to it.

1. On the **Catalog**, open a product the supplier ships.
2. Choose the supplier under **Supplier**. **None (self-fulfilled)** keeps the
   product with you. The field appears once you have added a supplier.
3. Save the product.

Repeat for each of the supplier's products. A product has one supplier at a
time.

## What happens when an order is paid {#when-an-order-is-paid}

As soon as an order is paid, each supplier with products on it is sent that
order, once. This happens for cart orders and for a product's **Buy** button.

- A supplier is told about **its own items only**. An order with products from
  two suppliers, and some you ship yourself, sends each supplier just its
  lines; the rest wait for you on the Orders page.
- The order's timeline shows a **Sent to supplier** entry for each supplier
  that was told.
- If the order has no shipping address, because nothing on it needed shipping
  at checkout, the email says so and asks the supplier to contact you for it.

### The supplier email {#supplier-email}

The email is sent in your store's name, with the subject **New order to
fulfill for** your store. It gives the order number, what to ship and how many
(with each item's option and SKU on a cart order), who it ships to and their
address, and a link to record the shipment.

## Record the shipment {#record-the-shipment}

The link in the email, also sent in each webhook order as `updateUrl`, opens a
**Record this shipment** page:

1. The supplier enters the **Carrier** and **Tracking number**.
2. They select **Mark as shipped**.

The supplier's lines are then marked shipped with that tracking, the customer
is sent their shipping email, and you get a notification. When other lines on the
order are still to ship, the order shows as partly fulfilled, and the
notification says how many lines are left. Each supplier's link covers only
its own lines, and a supplier who already recorded its lines is told so.

## Webhook orders {#webhook-orders}

For a supplier with a **Webhook URL**, Aglyn sends a `POST` with a JSON body
for each order:

| Field | What it holds |
| -- | -- |
| `hostId`, `orderId` | Which store and order this is. |
| `lines` | Cart orders: each of this supplier's items, with `productId`, `productName`, `variantLabel`, `sku` and `quantity`. |
| `productId`, `productName`, `quantity` | **Buy** button orders: the one product bought. |
| `customerEmail`, `shippingName` | Who the order is for. |
| `shippingAddress` | `line1`, `line2`, `city`, `state`, `postalCode` and `country`, or `null` when none was collected. |
| `updateUrl` | The link to record the shipment. |

To record the shipment from the supplier's system, `POST` to `updateUrl` with a
JSON body holding `carrier` and `trackingNumber`.

### Signed webhooks {#signed-webhooks}

Enter a **Webhook secret** on the supplier, a value you share with it, and each
order carries an `x-aglyn-signature` header: the hex HMAC-SHA256 of the raw
body, keyed with that secret. The supplier checks the header to know the order
came from your store. Without a secret, orders are sent unsigned.

### When the supplier's system is down {#webhook-retries}

An order that the supplier's address does not accept with a `2xx` answer is
tried again after about 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours.
After six failed tries the order's timeline says it was never sent, and you get
a notification to send it yourself or ship it by hand. Fixing the **Webhook
URL** on the supplier also fixes orders still waiting to be retried.

## Troubleshooting {#troubleshooting}

| What happens | What to do |
| -- | -- |
| The card offers an upgrade | Dropship suppliers need the Pro plan or above. |
| There is no **Supplier** field in the product editor | Add a supplier first. The field appears once one exists. |
| A supplier didn't hear about an order | Check the product was assigned to the supplier before the order was paid, and that the supplier has an email or webhook address. Orders paid earlier are not sent again. |
| The timeline says an order was never sent | The supplier's webhook address failed six times. Check the address, then send the order to the supplier yourself. |
| The supplier says the link reports **Invalid token** | The link was changed or belongs to another order. Ask them to use the link from that order's email. |

## Related

- [Commerce](overview.md)
- [Product catalog](catalog.md)
- [Orders and returns](orders-and-returns.md)
