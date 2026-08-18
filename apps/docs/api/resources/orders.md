---
sidebar_position: 4
title: Orders
description: Read your store's orders over the API — line items, totals, refunds and disputes — to sync into accounting or fulfillment.
---

# Orders

Read the orders a site's store has taken, so you can push them into accounting,
fulfillment, or a warehouse system. Orders are **read-only** over the API — creating
or refunding one moves money, and that stays in the console and the storefront.

Orders belong to a **site**, not to the organization, because each site runs its own
store with its own numbering. A multi-site organization reads each store separately.

:::info Requires commerce on your plan
These endpoints need both the `orders:read` scope **and** a plan that includes
commerce. If your plan doesn't, they answer `403 plan_required` with `code:
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
| `403` | `insufficient_scope` | Key lacks `orders:read` (`code` is the scope). |
| `403` | `plan_required` | The organization's plan no longer includes commerce (`code: "commerce"`). Paid features stop at the door when the plan drops — see [downgrading](/workspace-and-billing/billing-and-plans/downgrading-and-canceling). |
| `404` | `not_found` | Unknown or unowned site (`"No such site"`), or unknown order (`"No such order"`). |
| `405` | `method_not_allowed` | Anything other than `GET`. |

A site your organization doesn't own answers `404`, never `403` — the API never
reveals whether an id exists somewhere else. So a `404` means "not yours or not real".

## Related

- [Products](products.md) — the catalog these orders sold from.
- [Contacts](contacts.md) — joined to orders by `customerEmail`.
- [Commerce](/commerce-and-bookings/commerce/overview) — the store itself.
- [Conventions](../conventions.md) — pagination, ordering, errors.
