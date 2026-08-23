---
sidebar_position: 5
title: Orders
description: Read your store's orders over the API — line items, totals, refunds and disputes — and record shipments back, to sync accounting and drive fulfillment.
---

# Orders

Read the orders a site's store has taken, so you can push them into accounting,
fulfillment, or a warehouse system — and **record the shipment** when your warehouse,
3PL or label printer sends the parcel.

That one write is the only one. Creating, cancelling or refunding an order moves money
or stock, and those stay in the console and the storefront.

Orders belong to a **site**, not to the organization, because each site runs its own
store with its own numbering. A multi-site organization reads each store separately.

:::info Requires commerce on your plan
These endpoints need the `orders:read` scope (or `orders:write` to record a
shipment) **and** a plan that includes commerce. If your plan doesn't, they answer `403 plan_required` with `code:
"commerce"` — see [Errors](#errors).
:::

## The order object

```json
{
  "id": "8Kd0zX2mQ1",
  "object": "order",
  "number": 1042,
  "status": "paid",
  "channel": "online",
  "currency": "usd",
  "customerEmail": "shopper@example.com",
  "customerName": "Avery Chen",
  "lineItems": [
    {
      "productId": "p_sourdough",
      "variantId": "v_large",
      "name": "Sourdough",
      "variantLabel": "Large",
      "sku": "SD-L",
      "productType": "physical",
      "quantity": 2,
      "unitAmountCents": 900
    }
  ],
  "totals": {
    "itemsCents": 1800,
    "shippingCents": 500,
    "taxCents": 190,
    "discountCents": 200,
    "totalCents": 2290,
    "feeCents": 45
  },
  "refundedCents": 0,
  "disputed": false,
  "shippingAddress": {
    "name": "Avery Chen",
    "line1": "500 Main St",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701",
    "country": "US"
  },
  "couponCode": null,
  "fulfillments": [
    {
      "id": "f_8c21",
      "lineItemIds": [0, 1],
      "carrier": "USPS",
      "trackingNumber": "9400111899223197428490",
      "trackingUrl": null,
      "at": "2026-08-15T14:20:00.000Z"
    }
  ],
  "created": "2026-08-14T18:02:11.400Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Order id — use it in the paths below. Not the same as `number`. |
| `object` | string | Always `"order"`. |
| `number` | integer \| null | The **human** order number, sequential per site — what appears on the receipt and what a customer will quote at you. |
| `status` | string | See [statuses](#statuses). |
| `channel` | string | Where the sale came from — see [channels](#channels). |
| `currency` | string | Always `"usd"` today. Present so a client doesn't have to hard-code it. |
| `customerEmail` | string \| null | The join key to a [contact](contacts.md) — orders carry no contact id. |
| `customerName` | string \| null | Absent on POS and draft orders. |
| `lineItems` | array | See [line items](#line-items). |
| `totals` | object | See [totals](#totals). All integer **cents**. |
| `refundedCents` | integer | Money already returned, **for any reason**. A lost chargeback lands here too, so a non-zero value doesn't by itself mean the merchant chose to refund — check `disputed`. |
| `disputed` | boolean | Whether a card dispute has ever been recorded against this order. |
| `shippingAddress` | object \| null | Present on orders that collected one. Digital and POS orders usually have none. |
| `couponCode` | string \| null | The discount code the shopper used, if any. |
| `fulfillments` | array | Shipments recorded against this order — see [fulfillments](#fulfillments). Always present; `[]` on an order nothing has shipped for. |
| `created` | string \| null | ISO 8601. For a **subscription renewal** this is the period start Stripe billed for, not the moment the row was written — which is what makes a revenue report line up with the invoice. |

### Statuses {#statuses}

| `status` | Means |
| --- | --- |
| `pending` | Created, payment not settled. A POS card sale or an unpaid draft sits here. |
| `paid` | Paid, nothing shipped yet. |
| `partially_fulfilled` | Some line items have shipped. |
| `fulfilled` | Everything has shipped. |
| `delivered` | Confirmed delivered. |
| `cancelled` | Cancelled; stock returned. |
| `refunded` | Refunded — check `refundedCents` for how much, and `disputed` for why. |

`refunded` and `cancelled` are terminal. Everything else can still move.

### Fulfillments {#fulfillments}

`status` tells you an order shipped. `fulfillments` tells you **what shipped, when,
and under whose tracking number** — which is the part a 3PL or accounting reconcile
needs, and the part a split shipment makes essential: two shipments against one order
are two entries here and one unchanged `status`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string \| null | Shipment id, unique within the order. |
| `lineItemIds` | array | **Indexes into `lineItems`**, not product or variant ids. `[0, 1]` means the first two line items on this order. |
| `carrier` | string \| null | As recorded by whoever shipped it. Free text, not a fixed list. |
| `trackingNumber` | string \| null | Free text too — validate it against the carrier yourself. |
| `trackingUrl` | string \| null | Set only when the shipper recorded one. Usually `null`; build your own from the carrier and number. |
| `at` | string \| null | ISO 8601, like every other time on this object. `null` if the stored timestamp is unusable. |

To add one, [record a shipment](#record-a-shipment).

#### What isn't here {#not-here}

`orders:write` records shipments — that is, it moves an order **forward** to
`fulfilled` or `delivered` and attaches a carrier and tracking number. It cannot do
anything else to an order.

| Action | Over the API? | Why |
| --- | --- | --- |
| Mark fulfilled / delivered | **Yes**, `orders:write` | A forward status change and a timeline entry. No stock moves, no money moves. |
| Cancel an order | No — console | Cancelling **returns held stock**, under its own transaction. |
| Refund an order | No — console | A refund **moves money**, under its own transaction. |
| Create an order | No — storefront, POS or a console draft | An order is created by a payment, not by a status. |

Asking for `status: "cancelled"` or `"refunded"` here answers `400`, naming which of
the two it is rather than silently doing nothing.

### Channels {#channels}

| `channel` | Means |
| --- | --- |
| `online` | The storefront — a cart checkout or a buy-now button. |
| `pos` | Rung up on a [point-of-sale register](/commerce-and-bookings/commerce/pos-and-reservations). |
| `draft` | A draft order you built in the console and sent as a payment link. |
| `subscription` | A recurring renewal. One order per billing cycle. |

:::caution `online` is a default, not a stored value
Orders taken before Aglyn had multiple sales channels carry no `channel` field at
all. The API reports them as `online`, and `?channel=online` **does** return them —
but it filters after reading rather than in the query, so a page can come back with
fewer rows than `limit` while `has_more` is still `true`. That's normal here; follow
[the pagination rule](../conventions.md#pagination) and trust `has_more`, never a
page's length.
:::

### Line items {#line-items}

```json
{
  "productId": "p_sourdough",
  "variantId": "v_large",
  "name": "Sourdough",
  "variantLabel": "Large",
  "sku": "SD-L",
  "productType": "physical",
  "quantity": 2,
  "unitAmountCents": 900
}
```

Line items are a **snapshot taken at purchase**. `name`, `sku` and
`unitAmountCents` are what the shopper actually saw and paid — renaming or repricing
the [product](products.md) afterwards never rewrites a past order, which is what makes
an order safe to book as revenue. `productId` still points at the live product, so a
sold item can be looked up; it may since have been deleted.

`variantId` is omitted when the product has only its default variant.

### Totals {#totals}

All values are **integer cents**, never floats.

| Field | Notes |
| --- | --- |
| `itemsCents` | Sum of line items before shipping, tax and discount. |
| `shippingCents` | Shipping charged. |
| `taxCents` | Tax charged. |
| `discountCents` | Discount applied — a **positive** number that is subtracted. |
| `totalCents` | What the shopper paid: `itemsCents + shippingCents + taxCents − discountCents`. |
| `feeCents` | Aglyn's [platform fee](/workspace-and-billing/billing-and-plans/overview#platform-fees). |

:::warning `feeCents` is not part of the total
`feeCents` is Aglyn's cut of a total the shopper paid **in full**. It is not added to
`totalCents` and not subtracted from it. If you're computing what landed in your bank
account, that's roughly `totalCents − feeCents − refundedCents` minus Stripe's own
processing fee; if you're computing what you **sold**, it's `totalCents`. Netting the
fee out of revenue is the common mistake and it understates every order.
:::

Very old orders (from the first version of Aglyn commerce) stored only a flat total
and fee rather than a breakdown. The API fills their `totals` from those fields, so
you always receive the same shape — but their `itemsCents`, `taxCents` and
`shippingCents` are `0` and the money is all in `totalCents`. If you need the split,
it isn't recoverable; those orders predate its being recorded.

## Endpoints

### List orders

`GET /v1/sites/{siteId}/orders` — scope `orders:read`.
[Paginated](../conventions.md#pagination), ordered by order **id**, not by date or by
`number`.

| Param | Notes |
| --- | --- |
| `status` | Filter to one [status](#statuses), exact match. |
| `channel` | Filter to one [channel](#channels), exact match. See the caution above about `online`. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/orders?status=paid" \
  -H "Authorization: Bearer aglyn_sk_…"
```

```json
{
  "object": "list",
  "data": [ /* order objects */ ],
  "next_cursor": "b3JkXzE",
  "has_more": true
}
```

### Retrieve an order

`GET /v1/sites/{siteId}/orders/{orderId}` — scope `orders:read`.

The path takes the order **`id`**, not the human `number` on the receipt. There is no
lookup by `number`; if you need one, page the list once and build the map yourself.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/orders/8Kd0zX2mQ1" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Record a shipment {#record-a-shipment}

`PATCH /v1/sites/{siteId}/orders/{orderId}` — scope `orders:write`.

This is the fulfilment write: it moves the order forward and appends a
[fulfillment](#fulfillments) carrying the carrier and tracking number. It returns the
**full order object**, so you can see the shipment you just recorded without a second
request.

| Field | Type | Notes |
| --- | --- | --- |
| `status` | string | **Required.** `"fulfilled"` or `"delivered"`. Nothing else — see [what isn't here](#not-here). |
| `carrier` | string | Optional. Free text, e.g. `"UPS"`. Trimmed to 40 characters. |
| `trackingNumber` | string | Optional. Free text. Trimmed to 60 characters. |

Any other field in the body is **refused by name**, never ignored — so a typo like
`tracking_number` comes back as a `400` telling you which key it didn't recognise
rather than a `200` that quietly dropped half your shipment.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/sites/host_demo/orders/8Kd0zX2mQ1" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"status":"fulfilled","carrier":"UPS","trackingNumber":"1Z999AA10123456784"}'
```

```json
{
  "id": "8Kd0zX2mQ1",
  "object": "order",
  "status": "fulfilled",
  "fulfillments": [
    {
      "id": "f_8c21",
      "lineItemIds": [0, 1],
      "carrier": "UPS",
      "trackingNumber": "1Z999AA10123456784",
      "trackingUrl": null,
      "at": "2026-08-22T09:14:02.000Z"
    }
  ]
}
```

:::tip Retrying is safe, and needs no `Idempotency-Key`
Send the same `PATCH` twice — a lost response, a re-run cron — and the second call
finds the order already `fulfilled`, **writes nothing**, and returns the same `200`
with the same order. It cannot record the parcel twice. This is why the endpoint
neither needs nor accepts an [`Idempotency-Key`](../conventions.md#idempotency).
:::

#### Which moves are allowed

The API and the console obey **one** status machine — the same code decides both, so
the API can never make a move the console would refuse.

| From | `fulfilled` | `delivered` |
| --- | --- | --- |
| `pending` | No — nothing is paid for yet | No |
| `paid` | **Yes** | No — it has to ship first |
| `partially_fulfilled` | **Yes** | No |
| `fulfilled` | Already there → `200`, no write | **Yes** |
| `delivered` | No | Already there → `200`, no write |
| `cancelled` | No | No |
| `refunded` | No | No |

A move this table refuses answers `409 conflict` with `code: "order_transition"`, and
the message names the status that refused it. That is the answer to give up on, not to
retry: it means the order moved on without you — usually refunded or cancelled in the
console while your queue was still holding it.

```json
{
  "error": {
    "type": "conflict",
    "message": "Orders in \"refunded\" cannot be marked fulfilled",
    "code": "order_transition"
  }
}
```

## Recipes

### Sync new orders into another system

There is no `created` filter and no sort by date — see
[ordering](../conventions.md#ordering). The reliable pattern is to page everything
once, remember the ids, and then re-page and skip what you've seen:

```js
async function fetchAllOrders(siteId, key) {
  const orders = []
  let cursor = null
  do {
    const url = new URL(`https://app.aglyn.com/api/v1/sites/${siteId}/orders`)
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)
    const page = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    }).then((r) => r.json())
    orders.push(...page.data)
    cursor = page.next_cursor
  } while (cursor)
  return orders
}

const seen = await loadSeenIds()          // your store
const all = await fetchAllOrders('host_demo', process.env.AGLYN_API_KEY)
for (const order of all) {
  if (seen.has(order.id)) continue
  await pushToAccounting(order)
  seen.add(order.id)
}
```

Ids are stable forever, so a set of ids is a complete and idempotent watermark. Don't
use `number` for this — it's per site, so two sites both have an order `1`.

### Ship a batch from a warehouse queue

The pattern that makes a fulfilment worker safe: no bookkeeping of what you already
sent, because the API answers the retry identically.

```js
async function recordShipment(siteId, orderId, carrier, trackingNumber, key) {
  const response = await fetch(
    `https://app.aglyn.com/api/v1/sites/${siteId}/orders/${orderId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'fulfilled', carrier, trackingNumber }),
    },
  )
  const body = await response.json()
  if (response.ok) return body            // the order, shipment included

  // 409 order_transition: the order moved on (refunded, cancelled) without us.
  // Never retry this one — it will refuse forever. Surface it to a human.
  if (body?.error?.code === 'order_transition') {
    throw new Error(`Order ${orderId} can no longer ship: ${body.error.message}`)
  }
  throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
}
```

A timeout or a `500` is safe to retry as-is — the write is a single transaction, so
either it landed or nothing did, and a repeat of a landed write is the no-op `200`
above.

### Reconcile a day's takings

```js
const paid = all.filter(
  (o) => o.created?.startsWith('2026-08-14') && o.status !== 'cancelled',
)
const gross = paid.reduce((sum, o) => sum + (o.totals.totalCents ?? 0), 0)
const refunded = paid.reduce((sum, o) => sum + o.refundedCents, 0)
const platformFees = paid.reduce((sum, o) => sum + o.totals.feeCents, 0)

console.log({ gross, refunded, net: gross - refunded, platformFees })
```

`platformFees` is reported separately on purpose — it is a cost, not a reduction in
what you sold.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | `code: "validation_failed"`. An unknown body field, a missing or unrecognised `status`, or `status: "cancelled"` / `"refunded"` — which are console actions, and the message says so. |
| `403` | `insufficient_scope` | Key lacks `orders:read` on a read, or `orders:write` on a `PATCH` (`code` is the scope). |
| `403` | `plan_required` | The organization's plan no longer includes commerce (`code: "commerce"`). Paid features stop at the door when the plan drops — see [downgrading](/workspace-and-billing/billing-and-plans/downgrading-and-canceling). |
| `404` | `not_found` | Unknown or unowned site (`"No such site"`), or unknown order (`"No such order"`). |
| `404` | `not_found` | Also answered when this deployment ships no commerce plugin at all — self-hosted installs can leave it out. |
| `405` | `method_not_allowed` | Anything other than `GET`, or `PATCH` on one order. The `Allow` header lists what is. |
| `409` | `conflict` | `code: "order_transition"` — the status machine refused the move; see [which moves are allowed](#which-moves-are-allowed). |

A site your organization doesn't own answers `404`, never `403` — the API never
reveals whether an id exists somewhere else. So a `404` means "not yours or not real".

## Related

- [Products](products.md) — the catalog these orders sold from.
- [Contacts](contacts.md) — joined to orders by `customerEmail`.
- [Commerce](/commerce-and-bookings/commerce/overview) — the store itself.
- [Conventions](../conventions.md) — pagination, ordering, errors.
