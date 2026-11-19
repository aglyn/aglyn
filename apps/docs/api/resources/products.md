---
sidebar_position: 6
title: Products
description: Read and write your store's catalog over the API — products, their options and variants, prices and stock — to sync a PIM, feed a marketplace, or keep stock in step with a warehouse.
---

# Products

The catalog a site's store sells from: products, their options and variants, prices,
and stock levels. You can list and read them, add a product, change one, change a
single variant's price or stock, and delete a product.

Every write is the console's own product editor save, so a product saved over the API
meets the same checks and refreshes the store the same way. What a person can't do in
the editor, the API can't do either: variants follow the product's
[options](#variants-follow-the-options), and a digital product, which delivers files,
is made in the console.

Like [orders](orders.md), products belong to a **site** — each site has its own
catalog.

:::info Requires commerce on your plan
These endpoints need their scope — `products:read` to read, `products:write` to
write — **and** a plan that includes commerce. If your plan doesn't, they answer
`403 plan_required` with `code: "commerce"`. A write also needs commerce switched on
for the site.
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
  "seo": { "title": "Sourdough loaf, baked daily", "description": null },
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
| `options` | array | The axes variants vary along, e.g. Size and Color: `[{ "name", "values" }]`. |
| `variants` | array | **Where price and stock live** — see [variants](#variants). Never empty. |
| `seo` | object | The product page's search listing: `title` and `description`, each `null` where the page uses the product's own name and description. |
| `inventory` | integer \| null | Roll-up across **tracked** variants only. `null` when nothing is tracked. |
| `subscription` | object \| null | Present when the product is sold as a recurring subscription: `{ "interval": "month" \| "year", "trialDays": 14 }`. |
| `created`, `updated` | string \| null | ISO 8601. |

### Statuses {#statuses}

| `status` | Means |
| --- | --- |
| `draft` | Not on the storefront. Being worked on. A new product starts here. |
| `active` | On sale. |
| `archived` | Retired, kept for history. Not on the storefront. |

Products the merchant has **deleted** are never returned at all — not in the list, and
a retrieve answers `404`. Deletion is soft in our storage, but the API treats a
deleted product as gone, because that's what the merchant meant.

## Variants {#variants}

**Price and stock live on the variant, never on the product.** A product with no
options still has exactly one variant — there is no such thing as a product-level
price — so a client that reads `product.priceUsd` will find nothing. Always read
`product.variants`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string \| null | Variant id. `"default"` on single-variant products. |
| `sku`, `barcode` | string \| null | Yours to set. A SKU must be unique within its product. |
| `options` | object | Which option values this variant is, e.g. `{ "Size": "Large" }`. `{}` on a single-variant product. |
| `priceUsd` | number \| null | Price in **dollars**, as a decimal number — unlike orders, which are in integer cents. `null` is **unpriced**: the store shows "Price coming soon" and does not sell it. |
| `compareAtPriceUsd` | number \| null | The struck-through "was" price, when one is set. Must be higher than `priceUsd`. |
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
variants, and is `null` when none of them is tracked. The same two values are what you
**write**: send `inventory: null` to stop tracking a variant's stock, and `0` to mark
it sold out.
:::

Prices are in **dollars** here and in **cents** on [orders](orders.md). That's not an
inconsistency to route around — a catalog price is a decimal a merchant typed, and an
order total is money that changed hands, which must never be a float. Convert
explicitly at the boundary (`Math.round(priceUsd * 100)`) rather than assuming.

### Variants follow the options {#variants-follow-the-options}

A product's variants are always **every combination of its option values**, as in the
console's editor. Two options of two values each make four variants; no options make
one. So:

- **Changing `options` rebuilds the grid.** A combination the product already sells
  keeps its variant — its id, price, SKU and stock. A new combination starts at the
  first variant's price and stock. A combination that no longer exists is gone.
  Renaming an option (same number of options, a new `name`) keeps every variant's
  selections.
- **A single variant cannot be added or removed on its own.** Add or remove an option
  value instead.
- **`variants` on a product write changes existing rows.** Each entry names one
  variant, by its `id` or by its `options` (`{ "Size": "Large" }`), and sets the fields
  it carries. It is applied after `options`, so one request can add a value and price
  the new variants.
- [Update a variant](#update-a-variant) changes one row by its id.

Limits: at most **3** options, **25** values per option, and **100** variants in all.
More combinations than that is a `400` that names the count, and nothing is saved.

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

### Create a product

`POST /v1/sites/{siteId}/products` — scope `products:write`. Accepts an
[`Idempotency-Key`](../conventions.md#idempotency).

```bash
curl -X POST "https://app.aglyn.com/api/v1/sites/host_demo/products" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5d0c7e2a-…" \
  -d '{
    "name": "Rye loaf",
    "description": "Dark rye with caraway.",
    "tags": ["bread"],
    "options": [{ "name": "Size", "values": ["Small", "Large"] }],
    "variants": [
      { "options": { "Size": "Small" }, "priceUsd": 7, "inventory": 10 },
      { "options": { "Size": "Large" }, "priceUsd": 10, "inventory": 4 }
    ]
  }'
```

Returns **`201`** with the new product:

```json
{
  "id": "k9q2m4x7ra",
  "object": "product",
  "name": "Rye loaf",
  "slug": "rye-loaf",
  "description": "Dark rye with caraway.",
  "type": "physical",
  "status": "draft",
  "tags": ["bread"],
  "categoryIds": [],
  "mediaUrls": [],
  "options": [{ "name": "Size", "values": ["Small", "Large"] }],
  "variants": [
    {
      "id": "v3h8c1",
      "sku": null,
      "barcode": null,
      "options": { "Size": "Small" },
      "priceUsd": 7,
      "compareAtPriceUsd": null,
      "weightGrams": null,
      "inventory": 10,
      "inventoryTracked": true
    },
    {
      "id": "v7p2d9",
      "sku": null,
      "barcode": null,
      "options": { "Size": "Large" },
      "priceUsd": 10,
      "compareAtPriceUsd": null,
      "weightGrams": null,
      "inventory": 4,
      "inventoryTracked": true
    }
  ],
  "seo": { "title": null, "description": null },
  "inventory": 14,
  "subscription": null,
  "created": "2026-11-19T15:02:11.000Z",
  "updated": "2026-11-19T15:02:11.000Z"
}
```

Only `name` is required. What a new product starts as, when the body doesn't say:

- **A draft.** It is not in the store until `status` is `active` — send it on the
  create, or [update](#update-a-product) the product when it's ready.
- **Physical.** `type` may be `physical` or `service`. A `digital` product delivers
  files uploaded in the console, so it is created there; `type: "digital"` is a `400`.
- **Unpriced.** A variant with no `priceUsd` is saved with no price, and the store
  shows "Price coming soon" until it has one. No placeholder price is filled in.
- **A slug made from the name.** When another product already holds it, `-2`, `-3`
  and so on is added. A `slug` you send that another product holds — a deleted one included,
  because its address still answers on the storefront — is a
  `409 conflict` (`code: "slug_taken"`).

A retry with the same `Idempotency-Key` replays the original product with **`200`**
instead of creating a second one.

#### What a product write may carry {#product-write}

Create and update take the same members. Anything else is a `400` that names it —
a member is never silently ignored.

| Member | Notes |
| --- | --- |
| `name` | Required on a create, and not blank. At most 120 characters. |
| `description` | `null` clears it. |
| `status` | `draft`, `active` or `archived`. |
| `type` | `physical` or `service`. |
| `slug` | Lowercase letters, numbers and dashes, at most 80 characters. |
| `tags` | Replaces the product's tags. |
| `categoryIds` | Ids of the site's product categories. Replaces the product's categories. An id the site doesn't have is a `400`. |
| `mediaUrls` | Image URLs (`http` or `https`), the first the main image. Replaces the product's images. Upload a file with [media](media.md) first to get a URL. |
| `options` | `[{ "name", "values" }]` — see [variants follow the options](#variants-follow-the-options). Replaces the product's options. |
| `variants` | Changes to existing variants, each naming one by `id` or `options`, with any of the [variant fields](#variant-write). |
| `seo` | `{ "title", "description" }` — the product page's search listing. Title at most 60 characters, description at most 155. A member left out stays as it is; `null` or an empty string removes it, and the page falls back to the product's name and description. |

### Update a product

`PATCH /v1/sites/{siteId}/products/{productId}` — scope `products:write`.

Only the members you send change; everything else stays as stored. Returns the product.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/sites/host_demo/products/k9q2m4x7ra" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "active",
    "options": [{ "name": "Size", "values": ["Small", "Large", "Family"] }],
    "variants": [{ "options": { "Size": "Family" }, "priceUsd": 14, "inventory": 2 }]
  }'
```

That puts the product on sale, adds a third size — the Small and Large variants keep
their prices and stock — and prices the new Family variant.

Kept as stored, and not writable over the API: a subscription product's terms, its
add-ons, and the stock currently held for shoppers' carts. A digital or service
subscription doesn't count stock, so its variants take only `inventory: null`.

An empty body changes nothing and answers the product.

### Update a variant

`PATCH /v1/sites/{siteId}/products/{productId}/variants/{variantId}` — scope
`products:write`.

One row of the variant grid. Returns the whole product.

```bash
curl -X PATCH "https://app.aglyn.com/api/v1/sites/host_demo/products/p_sourdough/variants/v_large" \
  -H "Authorization: Bearer aglyn_sk_…" \
  -H "Content-Type: application/json" \
  -d '{ "inventory": 24, "compareAtPriceUsd": null }'
```

#### Variant fields {#variant-write}

A member left out stays as it is. Anything else is a `400` that names it.

| Member | Notes |
| --- | --- |
| `priceUsd` | Dollars, zero or more. `null` leaves the variant unpriced. |
| `compareAtPriceUsd` | Dollars, higher than `priceUsd`. `null` removes it. |
| `sku` | Unique within the product. `null` or `""` removes it. |
| `barcode` | Such as a UPC or EAN. `null` or `""` removes it. |
| `weightGrams` | Zero or more. `null` removes it. |
| `inventory` | A whole number, zero or more — `0` is sold out — or `null`, not tracked. |

### Delete a product

`DELETE /v1/sites/{siteId}/products/{productId}` — scope `products:write`.

The console's own delete: the product leaves the store and can no longer be bought.

```bash
curl -X DELETE "https://app.aglyn.com/api/v1/sites/host_demo/products/k9q2m4x7ra" \
  -H "Authorization: Bearer aglyn_sk_…"
```

```json
{ "id": "k9q2m4x7ra", "object": "product", "deleted": true }
```

Safe to repeat: deleting a product that is already deleted answers the same receipt. A
product that never existed is a `404`.

## Changes are live when saved {#live-when-saved}

A product has no draft copy: a write is saved at once, and the store refreshes right
away. A product that is `active` changes for shoppers the moment the write answers,
so an integration doesn't need to [publish](sites.md#publish) after it.

Because there is nothing to review afterwards, an app acting for a person should show
the change and get their approval before it sends the write.

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

### Stock counts from a warehouse

```js
for (const { productId, variantId, onHand } of warehouseCounts) {
  await fetch(
    `https://app.aglyn.com/api/v1/sites/host_demo/products/${productId}/variants/${variantId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory: onHand }), // 0 is sold out; never send null for "none left"
    },
  )
}
```

### A product feed for a marketplace

```js
const feed = products
  .filter((p) => p.status === 'active')
  .flatMap((p) =>
    p.variants
      .filter((v) => v.priceUsd !== null)            // unpriced variants aren't for sale
      .map((v) => ({
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
| `400` | `bad_request` | `code: "validation_failed"` — a member that isn't writable, a value out of shape or over its limit, a `categoryIds` entry the site doesn't have, `type: "digital"`, a `variants` entry that names no variant of the product (or one another entry already names), stock on a product that doesn't count it, or more variants than a product holds. `fields` names each key, nested ones as `variants[0].priceUsd`; a check the whole product fails is named in the message. |
| `403` | `insufficient_scope` | Key lacks `products:read`, or `products:write` on a write. |
| `403` | `plan_required` | `code: "commerce"` — the plan no longer includes commerce. `code: "product_quota"` — a create past the plan's product allowance; the message names it. |
| `403` | `forbidden` | `code: "site_permission_required"` — a [connected app](../conventions.md#site-access) whose person can't edit the site's content. |
| `404` | `not_found` | Unknown or unowned site, or commerce switched off for the site on a write; unknown or deleted product; unknown variant. |
| `405` | `method_not_allowed` | `Allow`: `GET, POST` on the list, `GET, PATCH, DELETE` on one product, `PATCH` on one variant. |
| `409` | `conflict` | `code: "slug_taken"` — another product of the site uses that slug. `code: "idempotency_in_progress"`. |
| `423` | — | The site is [locked](../conventions.md#site-access). |

## Related

- [Orders](orders.md) — sales of these products.
- [Media](media.md) — upload the files behind `mediaUrls`.
- [Catalog](/commerce-and-bookings/commerce/catalog) — managing products in the console.
- [Conventions](../conventions.md) — pagination, ordering, errors, idempotency.
