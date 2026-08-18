---
sidebar_position: 5
title: Products
description: Read your store's catalog over the API — variants, prices and stock levels — to feed a PIM, a marketplace listing, or a stock dashboard.
---

# Products

Read the catalog a site's store sells from: products, their variants, prices, and
stock levels. Products are **read-only** over the API today; editing a product or
adjusting stock changes what shoppers can buy, and that stays in the console.

Like [orders](orders.md), products belong to a **site** — each site has its own
catalog.

:::info Requires commerce on your plan
These endpoints need both the `products:read` scope **and** a plan that includes
commerce. If your plan doesn't, they answer `403 plan_required` with `code:
"commerce"`.
:::

## The product object

```json
{
  "id": "p_sourdough",
  "object": "product",
  "name": "Sourdough",
  "slug": "sourdough",
  "description": "Naturally leavened, 24-hour ferment.",
  "type": "physical",
  "status": "active",
  "tags": ["bread", "bestseller"],
  "categoryIds": ["cat_bakery"],
  "mediaUrls": ["https://…/sourdough.jpg"],
  "options": [{ "name": "Size", "values": ["Small", "Large"] }],
  "variants": [
    {
      "id": "v_small",
      "sku": "SD-S",
      "barcode": null,
      "options": { "Size": "Small" },
      "priceUsd": 6,
      "compareAtPriceUsd": null,
      "weightGrams": 400,
      "inventory": 12,
      "inventoryTracked": true
    },
    {
      "id": "v_large",
      "sku": "SD-L",
      "barcode": null,
      "options": { "Size": "Large" },
      "priceUsd": 9,
      "compareAtPriceUsd": 11,
      "weightGrams": 800,
      "inventory": 0,
      "inventoryTracked": true
    }
  ],
  "inventory": 12,
  "subscription": null,
  "created": "2026-03-02T11:00:00.000Z",
  "updated": "2026-08-10T09:14:00.000Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Product id — use it in the paths below, and it's what an order's line item points at. |
| `object` | string | Always `"product"`. |
| `name` | string \| null | Display name. |
| `slug` | string \| null | URL segment on the storefront. |
| `description` | string \| null | Long description. |
| `type` | string \| null | `physical`, `digital`, or `service`. |
| `status` | string \| null | `draft`, `active`, or `archived` — see [statuses](#statuses). |
| `tags`, `categoryIds` | array | Merchandising. |
| `mediaUrls` | array | Image URLs, first is the primary. |
| `options` | array | The axes variants vary along, e.g. Size and Color. |
| `variants` | array | **Where price and stock live** — see [variants](#variants). Never empty. |
| `inventory` | integer \| null | Roll-up across **tracked** variants only. `null` when nothing is tracked. |
| `subscription` | object \| null | Present when the product is sold as a recurring subscription: `{ "interval": "month" \| "year", "trialDays": 14 }`. |
| `created`, `updated` | string \| null | ISO 8601. |

### Statuses {#statuses}

| `status` | Means |
| --- | --- |
| `draft` | Not on the storefront. Being worked on. |
| `active` | On sale. |
| `archived` | Retired, kept for history. Not on the storefront. |

Products the merchant has **deleted** are never returned at all — not in the list, and
a retrieve answers `404`. Deletion is soft in our storage, but the API treats a
deleted product as gone, because that's what the merchant meant.

## Variants {#variants}

**Price and stock live on the variant, never on the product.** A product with one
option value still has exactly one variant — there is no such thing as a product-level
price — so a client that reads `product.priceUsd` will find nothing. Always read
`product.variants`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string \| null | Variant id. `"default"` on single-variant products. |
| `sku`, `barcode` | string \| null | Yours to set; Aglyn doesn't require or enforce uniqueness. |
| `options` | object | Which option values this variant is, e.g. `{ "Size": "Large" }`. `{}` on a single-variant product. |
| `priceUsd` | number \| null | Price in **dollars**, as a decimal number — unlike orders, which are in integer cents. |
| `compareAtPriceUsd` | number \| null | The struck-through "was" price, when one is set. |
| `weightGrams` | number \| null | For shipping rates. |
| `inventory` | integer \| null | Units left, **or `null`** — read the warning below. |
| `inventoryTracked` | boolean | `true` when this variant counts stock at all. |

:::danger `inventory: null` is not zero
`null` means **stock isn't tracked** for this variant — a consulting hour, a digital
download, a made-to-order item. It is unlimited, not sold out.

`0` means **tracked and sold out**.

Writing `variant.inventory ?? 0` — the reflex — turns every untracked product into an
out-of-stock one, and any "hide what's unavailable" rule downstream then hides your
entire services catalog. Branch on `inventoryTracked` instead:

```js
const available = !v.inventoryTracked || v.inventory > 0
```

The product-level `inventory` roll-up follows the same rule: it sums only tracked
variants, and is `null` when none of them is tracked.
:::

Prices are in **dollars** here and in **cents** on [orders](orders.md). That's not an
inconsistency to route around — a catalog price is a decimal a merchant typed, and an
order total is money that changed hands, which must never be a float. Convert
explicitly at the boundary (`Math.round(priceUsd * 100)`) rather than assuming.

## Endpoints

### List products

`GET /v1/sites/{siteId}/products` — scope `products:read`.
[Paginated](../conventions.md#pagination), ordered by product id.

| Param | Notes |
| --- | --- |
| `status` | Filter to `draft`, `active`, or `archived`. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/products?status=active" \
  -H "Authorization: Bearer aglyn_sk_…"
```

Deleted products are filtered out **after** the page is read, so a page can be shorter
than `limit` while `has_more` is still `true`. Check `has_more`, not the length.

### Retrieve a product

`GET /v1/sites/{siteId}/products/{productId}` — scope `products:read`.

```bash
curl "https://app.aglyn.com/api/v1/sites/host_demo/products/p_sourdough" \
  -H "Authorization: Bearer aglyn_sk_…"
```

## Recipes

### A low-stock report

```js
const LOW = 5
const lowStock = []
for (const product of await fetchAllProducts('host_demo', key)) {
  if (product.status !== 'active') continue
  for (const v of product.variants) {
    if (!v.inventoryTracked) continue        // untracked ≠ out of stock
    if (v.inventory <= LOW) {
      lowStock.push({
        product: product.name,
        variant: Object.values(v.options).join(' / ') || 'Default',
        sku: v.sku,
        left: v.inventory,
      })
    }
  }
}
```

### A product feed for a marketplace

```js
const feed = products
  .filter((p) => p.status === 'active')
  .flatMap((p) =>
    p.variants.map((v) => ({
      id: `${p.id}:${v.id}`,
      title: [p.name, Object.values(v.options).join(' / ')]
        .filter(Boolean)
        .join(' — '),
      description: p.description ?? '',
      image: p.mediaUrls[0] ?? null,
      price: v.priceUsd,
      sku: v.sku ?? undefined,
      availability:
        !v.inventoryTracked || v.inventory > 0 ? 'in stock' : 'out of stock',
    })),
  )
```

One feed row per **variant**, not per product — a marketplace buys a variant.

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `403` | `insufficient_scope` | Key lacks `products:read`. |
| `403` | `plan_required` | Plan no longer includes commerce (`code: "commerce"`). |
| `404` | `not_found` | Unknown or unowned site; unknown or deleted product. |
| `405` | `method_not_allowed` | Anything other than `GET`. |

## Related

- [Orders](orders.md) — sales of these products.
- [Media](media.md) — the files behind `mediaUrls`.
- [Catalog](/commerce-and-bookings/commerce/catalog) — managing products in the console.
- [Conventions](../conventions.md) — pagination, ordering, errors.
