/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  type ApiV1ResourceDescription,
  booleanField as bool,
  integerField as int,
  nullableField as nullable,
  objectKindField as OBJECT_FIELD,
  openObjectField as objectOf,
  postalAddressField as ADDRESS,
  queryParam as q,
  RECORD_STAMPS as STAMPS,
  stringField as str,
  stringListField as strList,
  SITE_ID_PATH_PARAM,
} from '@aglyn/tenant-data-admin/server/api-v1-description'
import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import {
  COMMERCE_MAX_OPTION_VALUES,
  COMMERCE_MAX_OPTIONS,
  COMMERCE_MAX_VARIANTS,
  COMMERCE_SLUG_MAX_LENGTH,
} from '../../model/commerce'
import { PRODUCT_NAME_MAX_LENGTH } from '../../model/product-write'

/*
 * A site's products and orders as the customer API's OpenAPI document
 * describes them. Transcribed unchanged from the builder's own list when the
 * resources moved here (AGL-3080).
 */

const PRODUCT_ID_PATH_PARAM = { name: 'productId', description: 'Required. The product’s id — the `id` of a product from `listProducts`.' }
const VARIANT_ID_PATH_PARAM = { name: 'variantId', description: 'Required. The variant’s id — the `id` of one of the product’s `variants`, from `getProduct`.' }

const SEO_TITLE_MAX = SCREEN_SEO_TEXT_GUIDANCE.title
const SEO_DESCRIPTION_MAX = SCREEN_SEO_TEXT_GUIDANCE.description

/** One variant's writable fields, shared by the variant write and each entry of a product write's `variants`. */
const VARIANT_WRITE_FIELDS = {
  priceUsd: nullable({ type: 'number', minimum: 0, description: 'Price in US dollars. `null` leaves the variant unpriced: the store shows “Price coming soon” and does not sell it. A product created without a price is unpriced.' }),
  compareAtPriceUsd: nullable({ type: 'number', minimum: 0, description: 'The strike-through price, in US dollars; it must be higher than `priceUsd`. `null` removes it.' }),
  sku: nullable(str('Stock-keeping code, unique within the product. `null` or an empty string removes it.')),
  barcode: nullable(str('Barcode, such as a UPC or EAN. `null` or an empty string removes it.')),
  weightGrams: nullable({ type: 'number', minimum: 0, description: 'Shipping weight in grams. `null` removes it.' }),
  inventory: nullable({ type: 'integer', minimum: 0, description: 'Stock on hand. `0` is sold out; `null` means stock is not tracked and the variant never sells out. A digital or service subscription takes only `null`.' }),
}

/**
 * A site's products, as the customer API's OpenAPI document describes them —
 * what the console's builder turns into paths, tags and schemas, and the MCP
 * tools derive from. The writes (AGL-4235) are the console editor's: the
 * members `handleProducts` accepts are exactly `writable` and the
 * `ProductVariantWrite` schema, and `api-v1-openapi.spec.ts` holds the
 * document to every endpoint the documentation promises.
 */
export const PRODUCTS_API_V1_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Products',
  docsPage: 'products',
  description: 'A site’s catalog: its products, their options and variants, prices and stock.',
  schemaName: 'Product',
  required: ['id', 'object', 'name'],
  fields: {
    id: str('Product id.'),
    object: OBJECT_FIELD('product'),
    name: str('Product name.'),
    slug: str('URL slug.'),
    description: nullable(str('Description.')),
    type: str('Product type: `physical`, `digital` or `service`.'),
    status: str('Publication status: `draft`, `active` or `archived`. Only an active product is shown in the store.'),
    tags: strList('Free-form tags.'),
    categoryIds: strList('Categories this product belongs to.'),
    mediaUrls: strList('Image URLs. The first is the product’s main image.'),
    options: { type: 'array', description: 'Option definitions, e.g. size.', items: { type: 'object', additionalProperties: true } },
    variants: { type: 'array', description: 'Purchasable variants.', items: { type: 'object', additionalProperties: true } },
    inventory: nullable(int('Stock on hand, when tracked.')),
    seo: objectOf('The product page’s search listing: `title` and `description`, each `null` where the page uses the product’s own name and description.'),
    subscription: nullable(objectOf('Subscription terms, when the product is one.')),
    ...STAMPS,
  },
  writable: ['name', 'description', 'status', 'type', 'slug', 'tags', 'categoryIds', 'mediaUrls', 'options', 'variants', 'seo'],
  writeOnly: {
    name: str(`Product name, at most ${PRODUCT_NAME_MAX_LENGTH} characters.`),
    description: nullable(str('Description. `null` clears it.')),
    status: { type: 'string', enum: ['draft', 'active', 'archived'], description: 'Publication status. A new product is a `draft`, not shown in the store, unless this says `active`. `archived` takes it out of the store.' },
    type: { type: 'string', enum: ['physical', 'service'], description: 'Product type. Defaults to `physical`. A digital product delivers files uploaded in the console, so it is created there.' },
    slug: str(`URL slug: lowercase letters, numbers and dashes, at most ${COMMERCE_SLUG_MAX_LENGTH} characters. Made from the name when a new product has none. A slug another product of the site uses is refused.`),
    tags: strList('Free-form tags. Replaces the product’s tags.'),
    categoryIds: strList('Ids of the site’s product categories. Replaces the product’s categories.'),
    mediaUrls: strList('Image URLs, the first the main image. Replaces the product’s images.'),
    options: {
      type: 'array',
      description: `Up to ${COMMERCE_MAX_OPTIONS} options, such as size and color. Replaces the product’s options, and its variants become every combination of their values: a combination the product already sells keeps its variant, price and stock, and a new one starts at the first variant’s price and stock. A product holds at most ${COMMERCE_MAX_VARIANTS} variants.`,
      items: {
        type: 'object',
        required: ['name', 'values'],
        additionalProperties: false,
        properties: {
          name: str('The option’s name, such as `Size`. Unique within the product.'),
          values: strList(`The option’s values, such as \`S\`, \`M\`, \`L\`; at most ${COMMERCE_MAX_OPTION_VALUES}.`),
        },
      },
    },
    variants: {
      type: 'array',
      description: 'Changes to the product’s variants, applied after `options`. Each entry names one variant by its `id`, or by its `options`, and sets the fields it carries. Variants are not added or removed here; they follow the options.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: str('The variant’s id, from the product’s `variants`.'),
          options: objectOf('The variant’s option values by option name, such as `{ "Size": "M" }`; names the variant when `id` is not sent.'),
          ...VARIANT_WRITE_FIELDS,
        },
      },
    },
    seo: {
      type: 'object',
      additionalProperties: false,
      description: 'The product page’s search listing. A member left out stays as it is.',
      properties: {
        title: nullable(str(`The page title search engines show, at most ${SEO_TITLE_MAX} characters. \`null\` uses the product’s name.`)),
        description: nullable(str(`The summary search engines show, at most ${SEO_DESCRIPTION_MAX} characters. \`null\` uses the product’s description.`)),
      },
    },
  },
  writeNote: 'A create needs a `name`. A `PATCH` changes only the members it carries.',
  components: {
    ProductVariantWrite: {
      type: 'object',
      description: 'Writable fields of one product variant. A member left out stays as it is. Any other member is a `400` that names it, never silently ignored.',
      properties: VARIANT_WRITE_FIELDS,
      additionalProperties: false,
    },
  },
  ops: [
    { path: '/v1/sites/{siteId}/products', method: 'get', operationId: 'listProducts', summary: 'List a site’s products', list: true, returns: 'Product', description: 'Lists the products in one site’s store, with prices, stock and variants. Needs `siteId` from List sites.', pathParams: [SITE_ID_PATH_PARAM] },
    { path: '/v1/sites/{siteId}/products/{productId}', method: 'get', operationId: 'getProduct', summary: 'Get a product', description: 'Returns one product with its variants. Needs `siteId` from List sites and `productId` from List a site’s products.', returns: 'Product', pathParams: [SITE_ID_PATH_PARAM, PRODUCT_ID_PATH_PARAM] },
    // openWorld: an active product is on sale in the site’s public store.
    { path: '/v1/sites/{siteId}/products', method: 'post', operationId: 'createProduct', summary: 'Create a product', accepts: 'ProductWrite', returns: 'Product', creates: true, bodyRequires: ['name'], description: 'Adds a product to one site’s store. It is a draft, not shown in the store, unless `status` is `active`. Needs `siteId` from List sites and a `name`. Options make its variants; prices and stock are set on them. Returns the new product.', pathParams: [SITE_ID_PATH_PARAM], openWorld: true },
    // openWorld: a change to a product on sale changes what the public store shows.
    { path: '/v1/sites/{siteId}/products/{productId}', method: 'patch', operationId: 'updateProduct', summary: 'Update a product', accepts: 'ProductWrite', returns: 'Product', description: 'Changes a product’s details, options, variants, prices or stock; fields not sent stay as they are. A product on sale shows the change in the store at once. Needs `siteId` from List sites and `productId` from List a site’s products. Returns the product.', pathParams: [SITE_ID_PATH_PARAM, PRODUCT_ID_PATH_PARAM], openWorld: true },
    // openWorld: a deleted product leaves the public store.
    { path: '/v1/sites/{siteId}/products/{productId}', method: 'delete', operationId: 'deleteProduct', summary: 'Delete a product', returns: 'Deleted', description: 'Deletes a product: it leaves the store at once and can no longer be bought. Needs `siteId` from List sites and `productId` from List a site’s products.', pathParams: [SITE_ID_PATH_PARAM, PRODUCT_ID_PATH_PARAM], openWorld: true },
    // openWorld: a variant’s price and stock are what the public store sells it at.
    { path: '/v1/sites/{siteId}/products/{productId}/variants/{variantId}', method: 'patch', operationId: 'updateProductVariant', summary: 'Update a product variant', accepts: 'ProductVariantWrite', returns: 'Product', description: 'Changes one variant’s price, compare-at price, SKU, barcode, weight or stock; fields not sent stay as they are. A product on sale shows the change in the store at once. Needs `siteId` from List sites, `productId` from List a site’s products and `variantId` from the product’s variants. Returns the product.', pathParams: [SITE_ID_PATH_PARAM, PRODUCT_ID_PATH_PARAM, VARIANT_ID_PATH_PARAM], openWorld: true },
  ],
}

export const ORDERS_API_V1_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Orders',
  docsPage: 'orders',
  description: 'A site’s orders. Status moves are constrained.',
  schemaName: 'Order',
  required: ['id', 'object', 'number', 'status'],
  writable: ['status', 'carrier', 'trackingNumber', 'trackingUrl', 'lineItems', 'notify'],
  writeOnly: {
    status: { type: 'string', enum: ['fulfilled', 'delivered'], description: 'The status to move the order to.' },
    carrier: str('Free text, e.g. `UPS`. Trimmed to 40 characters. USPS, UPS, FedEx, DHL, Canada Post, Royal Mail and Australia Post get a tracking link.'),
    trackingNumber: str('Free text. Trimmed to 60 characters.'),
    trackingUrl: str('An https tracking link, for a carrier the link is not derived for.'),
    lineItems: {
      type: 'array',
      description:
        'With `status: fulfilled`, the units this shipment covers: `[{ lineItemId, quantity }]`, where `lineItemId` is the line’s index. Omitted, the shipment covers everything still to ship. More than is left is `409 conflict` (`code: "over_fulfilled"`). Send an `Idempotency-Key` header so a retried partial shipment is recorded once.',
      items: { type: 'object', additionalProperties: true },
    },
    notify: bool('Whether the buyer is told about this shipment. Defaults to true.'),
  },
  writeRequired: ['status'],
  fields: {
    id: str('Order id.'),
    object: OBJECT_FIELD('order'),
    number: int('Human-facing order number.'),
    status: str('Order status.'),
    channel: str('`online` by default. Older orders carry no stored value, so `?channel=online` drops them after the read.'),
    currency: str('ISO 4217 code.'),
    customerEmail: nullable(str('Customer email.')),
    customerName: nullable(str('Customer name.')),
    lineItems: { type: 'array', description: 'What was bought.', items: { type: 'object', additionalProperties: true } },
    totals: objectOf('Money totals, in the smallest unit of `currency`. `extrasCents` is the optional lines the buyer added at checkout, inside `totalCents` and outside `itemsCents`.'),
    extras: { type: 'array', description: 'Optional lines the buyer added at checkout, such as package protection: `[{ id, pluginId, key, label, amountCents, quoteRef }]`. Empty when there were none.', items: { type: 'object', additionalProperties: true } },
    credits: { type: 'array', description: 'Store credit another plugin kept that paid part of the sale, such as rewards: `[{ providerId, pluginId, reference, label, last4, amountCents, appliedAs }]`. `appliedAs` is `discount` for a checkout redemption and `tender` for a register payment. Empty when there were none.', items: { type: 'object', additionalProperties: true } },
    refundedCents: int('Amount refunded so far.'),
    livemode: bool('Whether real money moved: `false` for an order paid in Stripe test mode, such as a store rehearsal.'),
    disputed: bool('Whether a chargeback is open.'),
    taxMode: nullable(str('The tax regime: `stripe-automatic` (Stripe Tax, collected and remitted by the platform as marketplace facilitator), `manual` (your own rate) or `none`. `null` on an order from before it was recorded.')),
    taxEngine: nullable(objectOf('The tax service you connected, when one was asked for this sale’s tax: `provider` (`avalara` or `taxjar`), `providerLabel`, `status` (`quoted` when its tax was charged, `fallback` when it did not answer and your own rate was charged), `reason` (`timeout` or `error` on a fallback) and `sandbox`. `null` when no service was asked.')),
    shippingAddress: ADDRESS(),
    couponCode: nullable(str('Coupon applied.')),
    fulfillments: { type: 'array', description: 'Shipments and deliveries.', items: { type: 'object', additionalProperties: true } },
    created: STAMPS.created,
  },
  ops: [
    { path: '/v1/sites/{siteId}/orders', method: 'get', operationId: 'listOrders', summary: 'List a site’s orders', description: 'Lists the orders placed in one site’s store, with status, items, totals and shipments. Needs `siteId` from List sites. Filter by status or channel.', list: true, returns: 'Order', filters: [q('channel', 'Orders from one sales channel, such as `online`.'), q('status', 'Order status.')], pathParams: [SITE_ID_PATH_PARAM] },
    { path: '/v1/sites/{siteId}/orders/{orderId}', method: 'get', operationId: 'getOrder', summary: 'Get an order', description: 'Returns one order with its items, totals and shipments. Needs `siteId` from List sites and `orderId` from List a site’s orders.', returns: 'Order', pathParams: [SITE_ID_PATH_PARAM, { name: 'orderId', description: 'Order id.' }] },
    // openWorld: it emails the buyer about the shipment unless `notify` is false.
    { path: '/v1/sites/{siteId}/orders/{orderId}', method: 'patch', operationId: 'updateOrder', summary: 'Mark an order shipped or delivered', accepts: 'OrderWrite', returns: 'Order', description: 'Records a shipment: sets `status` to `fulfilled` (shipped) or `delivered`, with optional carrier, tracking number and the items shipped. The buyer is emailed about it unless `notify` is false. An order cannot be cancelled or refunded here; that is done in the console. Needs `siteId` and `orderId`. Returns the order.', pathParams: [SITE_ID_PATH_PARAM, { name: 'orderId', description: 'Order id.' }], openWorld: true },
  ],
}
