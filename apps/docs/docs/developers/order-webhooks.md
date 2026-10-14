---
sidebar_position: 5
title: Order webhooks
description: What an order webhook posts to your endpoint, the headers that come with it, how to check its signature, and how retries work.
---

# Order webhooks for developers

A store's managers add an endpoint under **Notifications** → **Order webhooks** in the
Products hub, choose its events, and copy its **signing secret** — see
[Order webhooks](../commerce-and-bookings/commerce/orders-and-returns.md#order-webhooks)
for that side and the list of events. This page is for whoever builds the endpoint.

## What your endpoint receives

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

## Check the signature

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

## Answer quickly, and retries

Answer with any `2xx` status within 8 seconds. Anything else — another status, a
redirect, a timeout — is a failed attempt, and the event is sent again after 30
seconds, 2 minutes, 10 minutes, 30 minutes, 1 hour, 6 hours and 12 hours: eight
attempts over about a day. If the last one fails, the site's managers are told.
An event can arrive more than once, and events about one order can arrive out of
order, so use `Aglyn-Event-Id` to skip repeats and the order's `status` rather than
the arrival order.

## Related

- [Order webhooks](../commerce-and-bookings/commerce/orders-and-returns.md#order-webhooks) — adding an endpoint and the events
