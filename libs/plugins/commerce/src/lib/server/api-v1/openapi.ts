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
} from '@aglyn/tenant-data-admin/server/api-v1-description'

/**
 * A site's products and orders as the customer API's OpenAPI document
 * describes them — what the console's builder turns into paths, tags and
 * schemas, and the MCP tools derive from. Transcribed unchanged from the
 * builder's own list when the resources moved here (AGL-3080);
 * `api-v1-openapi.spec.ts` holds the document to every endpoint the
 * documentation promises.
 */
export const PRODUCTS_API_V1_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Products',
  description: 'A site’s catalog. Read-only over the API.',
  schemaName: 'Product',
  required: ['id', 'object', 'name'],
  fields: {
    id: str('Product id.'),
    object: OBJECT_FIELD('product'),
    name: str('Product name.'),
    slug: str('URL slug.'),
    description: nullable(str('Description.')),
    type: str('Product type.'),
    status: str('Publication status.'),
    tags: strList('Free-form tags.'),
    categoryIds: strList('Categories this product belongs to.'),
    mediaUrls: strList('Image URLs.'),
    options: { type: 'array', description: 'Option definitions, e.g. size.', items: { type: 'object', additionalProperties: true } },
    variants: { type: 'array', description: 'Purchasable variants.', items: { type: 'object', additionalProperties: true } },
    inventory: nullable(int('Stock on hand, when tracked.')),
    subscription: nullable(objectOf('Subscription terms, when the product is one.')),
    ...STAMPS,
  },
  ops: [
    { path: '/v1/sites/{siteId}/products', method: 'get', operationId: 'listProducts', summary: 'List products', list: true, returns: 'Product', description: 'Rows deleted since they were written are dropped after the read, so pages can come back short.', pathParams: [{ name: 'siteId', description: 'Site id.' }] },
    { path: '/v1/sites/{siteId}/products/{productId}', method: 'get', operationId: 'getProduct', summary: 'Retrieve a product', returns: 'Product', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'productId', description: 'Product id.' }] },
  ],
}

export const ORDERS_API_V1_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Orders',
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
    totals: objectOf('Money totals, in the smallest unit of `currency`.'),
    refundedCents: int('Amount refunded so far.'),
    disputed: bool('Whether a chargeback is open.'),
    shippingAddress: ADDRESS(),
    couponCode: nullable(str('Coupon applied.')),
    fulfillments: { type: 'array', description: 'Shipments and deliveries.', items: { type: 'object', additionalProperties: true } },
    created: STAMPS.created,
  },
  ops: [
    { path: '/v1/sites/{siteId}/orders', method: 'get', operationId: 'listOrders', summary: 'List orders', list: true, returns: 'Order', filters: [q('channel', '`online` is a default rather than a stored value, so filtering on it drops older orders after the read.'), q('status', 'Order status.')], pathParams: [{ name: 'siteId', description: 'Site id.' }] },
    { path: '/v1/sites/{siteId}/orders/{orderId}', method: 'get', operationId: 'getOrder', summary: 'Retrieve an order', returns: 'Order', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'orderId', description: 'Order id.' }] },
    { path: '/v1/sites/{siteId}/orders/{orderId}', method: 'patch', operationId: 'updateOrder', summary: 'Move an order’s status', accepts: 'OrderWrite', returns: 'Order', description: 'An illegal transition is `409 conflict` (`code: "order_transition"`), and the message names the status it is in.', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'orderId', description: 'Order id.' }] },
  ],
}
