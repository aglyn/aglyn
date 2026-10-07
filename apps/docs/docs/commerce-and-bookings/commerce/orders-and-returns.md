---
sidebar_position: 3
title: Fulfillment, returns and webhooks
description: Ship an order in parts with tracking links, run returns from request to refund, print invoices, and send order events to your own systems.
---

# Fulfillment, returns and webhooks

What happens to an order after it is paid: shipping it, in one parcel or several;
taking items back; printing its paperwork; and telling your other systems about it.
Everything here is in the order's dialog on the **Orders** tab of the **Products**
hub, and under **Returns** and **Settings** beside it.

## Ship an order in parts {#fulfillment}

**Fulfill…** in the order's dialog opens the **Fulfill items** panel. Each line starts
at the units still to ship; lower a quantity to send part of a line now and the rest
later. Digital and service lines have nothing to ship and never hold an order open.

- **Carrier** and **Tracking number** make the tracking link for USPS, UPS, FedEx, DHL,
  Canada Post, Royal Mail and Australia Post. For any other carrier, choose **Other**,
  type its name, and paste the **Tracking link** yourself.
- **Notify customer** emails the buyer the shipment with its tracking link. Leave it
  off to record a shipment quietly.
- The order reads **Partially fulfilled** until every unit that ships is out, then
  **Fulfilled**.

Each shipment is listed in the dialog. **Edit tracking** corrects a carrier or a
number; **Cancel shipment** puts its units back to be shipped again. Ticking orders
in the list and choosing **Mark as fulfilled** ships every remaining unit of each.

## Invoices and packing slips {#invoices}

**Invoice** in the order's dialog opens the order as a bill, ready to print: your
business name, the date, who it is billed and shipped to, each line with its unit
price, the subtotal, discount, shipping, tax and total, and anything refunded. Your
store's receipt footer and terms address print at the foot. To keep a PDF, choose
**Save as PDF** in the print dialog.

**Packing slip** prints what goes in the box — the shipping address and each line's
quantity, name, option and SKU — with no prices.

## Returns {#returns}

A return is its own record beside the order: what is coming back and why, what you
decided, the return label, what went back in stock, and the refund. Every return is
listed under **Returns** in the Products hub, newest first; the **Status** filter shows
one state at a time.

### How a buyer asks {#buyer-requests}

A buyer asks for a return themselves, from either of two places:

- the **Request a return** link beside an order in their account on your store, when
  they are signed in;
- the **Request a return** button on the order's status page — the **View your
  order** link in every order email — which needs no account. The button shows only
  while the return window is open and something on the order can still come back.

Both open the return page at `/order-return` in your site's header and footer. The
page is unlisted, so search engines leave it out; to design your own, make a page at
`/order-return` and place the **Return request** block on it. The buyer chooses how many of each item to send back and a reason for each — **Arrived
damaged**, **Wrong item**, **Not as described**, **Size or fit**, **No longer needed**
or **Other** — and can add a note. Only items that have shipped can be returned, and
never more than were bought or are already coming back. You and the site's managers
are told by email and in the console's notifications.

Under **Settings** → **Returns**:

- **Accept return requests online** — turn it off to take returns only by contact.
  You can still start a return for a buyer from the order.
- **Return window in days** — counted from the last shipment, or from the order date
  for an order with nothing to ship. `0` to 365.
- **Returnable product types** — physical products only, by default.

### Run a return {#run-a-return}

Open a return from the list, or from the **Returns** section of its order's dialog,
where **Start return** opens one for the buyer. A return you start is approved at once.

| Status | What you can do |
| --- | --- |
| **Requested** | **Approve** or **Decline**, each with an optional **Note to the customer** and **Notify customer**. The buyer is emailed your answer. |
| **Approved** | **Mark received…** when the parcel arrives, or **Refund…** without waiting for it. |
| **Received** | **Refund…**. |
| **Refunded**, **Declined** | **Close return** when you are done with it. |

**Mark received…** asks how many of each line to put back in stock — all of them, by
default — and, when your store has more than one location, where. Each unit restocked
is written to [Stock movements](overview.md#stock-movements) beside the sale.

**Refund…** suggests what the items are worth — each line's paid price, after the
order's discount, for the units coming back — and you can change it, for example to
add the shipping. The money goes back to the original payment through the order's own
refund, so the refund rules are the same: it needs an admin of the whole workspace,
and it cannot refund more than is left on the order. Asking twice refunds once. The
buyer is emailed the amount, and the order's restock question is answered by what the
return already put back.

The four return emails — **Return requested**, **Return approved**, **Return
declined** and **Return refunded** — are designed like your other store emails.


## Order webhooks {#order-webhooks}

An order webhook posts each order event to an address you choose, as it happens: a
warehouse system, an ERP, a spreadsheet script. Add them under **Settings** →
**Order webhooks** in the Products hub. Managing webhooks needs the **admin** role
*and* organization-wide membership, the same as refunds.

**Add endpoint** asks for:

- **Endpoint URL** — an `https://` address on a public server. Redirects are not
  followed, so give the final address.
- **Events** — any of the events below.

When you add an endpoint, its **signing secret** is shown once. Copy it into your
endpoint's settings; **Roll secret** makes a new one if it is lost. A store can keep
10 endpoints. **Pause** stops deliveries to one without deleting it, and **Send test
event** posts a `webhook.test` event now.

| Event | When |
| --- | --- |
| `order.paid` | An order was paid: online, buy-now, a payment link, a POS sale or a subscription renewal. |
| `order.fulfilled` | A shipment was recorded, once per shipment. |
| `order.delivered` | The order was marked delivered. |
| `order.refunded` | Money went back to the buyer, once per refund, including a refund made in the Stripe Dashboard. |
| `order.cancelled` | The order was canceled. |
| `return.requested` | A buyer asked for a return, or you opened one. |
| `return.approved` | You approved a return, or opened one yourself. |
| `return.declined` | You declined a return request. |
| `return.received` | The returned items arrived. |
| `return.refunded` | A return was refunded. |

### What your endpoint receives

A `POST` with a JSON body:

```json
{
  "id": "evt_…",
  "type": "order.fulfilled",
  "createdAt": "2026-10-07T15:04:05.000Z",
  "siteId": "…",
  "data": {
    "order": { "id": "…", "object": "order", "number": 1042, "status": "partially_fulfilled", "…": "…" },
    "fulfillment": { "id": "…", "lines": [{ "lineItemId": 0, "quantity": 1 }], "carrier": "UPS", "trackingNumber": "1Z…", "trackingUrl": "https://…" }
  }
}
```

`data.order` is the order in the same shape the API returns for
`GET /v1/sites/{siteId}/orders/{orderId}`. Money is in whole cents. Three headers come
with it:

| Header | What it holds |
| --- | --- |
| `Aglyn-Event` | The event, e.g. `order.paid`. |
| `Aglyn-Event-Id` | The event's id. It is the same on every retry, so store it and ignore an id you have already handled. |
| `Aglyn-Signature` | `t=<timestamp>,v1=<signature>`. |

### Check the signature

The signature is the HMAC-SHA256, in hex, of the timestamp, a period, and the raw
request body, keyed with your signing secret. Check it against the raw body before
parsing it, and refuse a timestamp more than five minutes old:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')))
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex')
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300
  return fresh && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ''))
}
```

### Answer quickly, and retries

Answer with any `2xx` status within 8 seconds. Anything else — another status, a
redirect, a timeout — is a failed attempt, and the event is sent again after 30
seconds, 2 minutes, 10 minutes, 30 minutes, 1 hour, 6 hours and 12 hours: eight
attempts over about a day. If the last one fails, the site's managers are told.
An event can arrive more than once, and events about one order can arrive out of
order, so use `Aglyn-Event-Id` to skip repeats and the order's `status` rather than
the arrival order.

**Deliveries** on an endpoint lists what was sent in the last 30 days, newest first,
with each attempt's status. Filter it by **Delivered**, **Retrying** or **Failed**, open
a delivery's **Body**, and **Resend** one once your endpoint is fixed.

## Related

- [Commerce overview](overview.md#orders)
- [Commerce end to end](../../guides/commerce-end-to-end.md)
