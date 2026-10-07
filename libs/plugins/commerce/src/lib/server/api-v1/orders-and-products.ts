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

import { checkEntitlement, isHostPluginEnabled } from '@aglyn/aglyn/server'
import {
  ApiErrors,
  apiJson,
  listResponse,
} from '@aglyn/tenant-data-admin'
import {
  type ApiV1Context,
  paginate,
  readJsonBody,
  requireScope,
  serialize,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { BUNDLE_ID } from '../../constants/bundle-common'
import { type OrderFulfilmentTarget, recordOrderShipment } from '../fulfill-order'
import { orderViewFromData } from './order-view'

/**
 * A site's orders and products on the customer REST API,
 * `/v1/sites/{siteId}/orders/…` and `/v1/sites/{siteId}/products/…`
 * (AGL-1928, AGL-2461, AGL-3080). Registered from this plugin's console
 * server declarations; the console's `/v1` router owns the pipeline in
 * front — the key, the plan's API access, the request quota, the rate limit —
 * and refuses a site the key's organization does not own before it hands a
 * request here.
 */

/**
 * Commerce resources need the `commerce` entitlement as well as the scope
 * (AGL-1928). `apiAccess` alone is the wrong gate here: it says the org may
 * call the API at all, not that it may still use the store. AGL-1873 closed
 * exactly this class on the write side — two money doors that asked the
 * plugin switch (`org.enabledPlugins`) instead of the plan, so a lapsed org
 * kept selling — and the same reasoning applies to a read. `enabledPlugins`
 * is the customer's own on/off switch and survives a downgrade; the plan does
 * not, and the published rule is that paid features stop at the door when the
 * plan no longer includes them.
 *
 * Answered as `plan_required` rather than `not_found`, deliberately. Hiding a
 * store that plainly exists behind a 404 sends an integrator hunting a wrong
 * site id; the honest answer names the plan.
 */
function requireCommerce(ctx: ApiV1Context): Response | null {
  return checkEntitlement(ctx.org, 'commerce')
    ? null
    : ApiErrors.planRequired({
        message: 'Commerce is not included in this organization’s plan',
        code: 'commerce',
        headers: ctx.headers,
      })
}

function hostRef(ctx: ApiV1Context, hostId: string) {
  return ctx.firestore.collection('hosts').doc(hostId)
}

/**
 * Orders carry a legacy Commerce Starter shape (AGL-90) alongside the modern
 * one: `amountCents`/`feeCents` at the top level rather than a `totals` map.
 * The console lifts them through `CommerceModel.liftLegacyOrder` and reads
 * `lifted.totals?.totalCents ?? order.amountCents`. The API cannot publish two
 * shapes for one object, so the legacy fields are folded into `totals` here
 * and a client only ever sees the modern one. `channel` defaults to `online`
 * for the same reason the console's list does — an absent channel is a
 * pre-channel order, not an unknown one.
 */
function orderView(doc: FirebaseFirestore.DocumentSnapshot) {
  return orderViewFromData(doc.id, doc.data() ?? {})
}

export async function handleOrders(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , orderId] = segments
  // `orders:write` is checked BEFORE `orders:read`, matching `handleSites`
  // and `handleScopedMedia` (AGL-900): a fulfilment key that only records
  // shipments must not be told it lacks a read scope it was never meant to
  // hold.
  if (request.method === 'PATCH' && orderId) {
    const deniedWrite = requireScope(ctx, 'orders:write')
    if (deniedWrite) return deniedWrite
    const unentitledWrite = requireCommerce(ctx)
    if (unentitledWrite) return unentitledWrite
    return updateOrder(request, ctx, hostId, orderId)
  }
  const denied = requireScope(ctx, 'orders:read')
  if (denied) return denied
  const unentitled = requireCommerce(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: orderId ? 'GET, PATCH' : 'GET' },
    })
  }
  const collection = hostRef(ctx, hostId).collection('orders')

  if (orderId) {
    const snap = await collection.doc(orderId).get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such order', headers: ctx.headers })
    }
    return apiJson(orderView(snap), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const status = url.searchParams.get('status')
  if (status) query = query.where('status', '==', status)
  const channel = url.searchParams.get('channel')
  // `online` is the DEFAULT, not a stored value on older orders, so filtering
  // for it in Firestore would silently drop every pre-channel order. Those are
  // exactly the oldest orders an accounting backfill is reaching for, so this
  // one value is filtered after the read instead. The page can therefore come
  // back shorter than `limit` while `has_more` is still true — which the
  // published pagination contract already tells clients to expect (check
  // `has_more`, never a page's length).
  if (channel && channel !== 'online') query = query.where('channel', '==', channel)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs
    .map(orderView)
    .filter((order) => (channel === 'online' ? order.channel === 'online' : true))
  return listResponse(data, nextCursor, ctx.headers)
}

/**
 * Statuses this endpoint will move an order TO, and the two it names as
 * refused. Kept as data so the 400 can list them and the docs can be checked
 * against the same source the handler branches on.
 */
const ORDER_WRITE_TARGETS: OrderFulfilmentTarget[] = ['fulfilled', 'delivered']

/** The keys a PATCH may carry (AGL-3611 added the last three). */
const ORDER_WRITABLE_KEYS = ['status', 'carrier', 'trackingNumber', 'trackingUrl', 'lineItems', 'notify']

/**
 * Transitions that exist in the commerce model and are DELIBERATELY not
 * reachable here — refused by name with a 400 that says why, never silently
 * ignored. `cancelled` releases held stock under its own transaction and
 * `refunded` moves money under another; admitting either here would hand a
 * caller a door around exactly the specifics those two routes exist to
 * enforce, and an API key is the credential least able to answer the
 * questions they ask.
 */
const ORDER_WRITE_REFUSED: Record<string, string> = {
  cancelled:
    'Canceling an order releases held stock, so it is not part of this endpoint. Cancel it in the console.',
  refunded:
    'Refunding an order moves money, so it is not part of this endpoint. Refund it in the console.',
}

/**
 * `PATCH /v1/sites/{siteId}/orders/{orderId}` — record a shipment (AGL-2461).
 *
 * ## The write is the console's, shared
 *
 * The transition rule, the transaction that re-asks it under the write, the
 * fulfillment append and the timeline entry are `recordOrderShipment`'s,
 * the one implementation the console's `commerce/fulfill-order` route calls
 * too. A second copy of `ORDER_TRANSITIONS` here would be the bug rather
 * than the fix: two tables drift, and drift here means the API writing an
 * order status the console forbids — `paid → delivered` skipping
 * fulfilment, or a write onto a `refunded` order. That is the class
 * AGL-1818/AGL-1819 exist to close, and it is money-adjacent.
 *
 * ## What THIS function is responsible for: all of the authorization
 *
 * `recordOrderShipment` is pre-authorized by contract — it takes `hostId`
 * on trust — so every gate is here, and all four are load-bearing:
 *
 * 1. `orders:write` on the key (checked by the caller, above).
 * 2. The `commerce` PLAN entitlement (checked by the caller, above) — the
 *    plan, never the plugin switch, which is the AGL-1873 distinction.
 * 3. **Org owns the site** — the console's `handleSites` refuses an unowned
 *    `hostId` with a 404 before it hands any site resource to its plugin,
 *    which is what keeps this from being a cross-tenant write primitive
 *    addressable by anyone who can guess a host id. Deliberately NOT
 *    re-checked here: a second copy would be a gate no test can redden
 *    (removing either one alone leaves the other answering), and an unproven
 *    guard on a cross-tenant write is worse than the one guard a test
 *    actually holds. `api-v1-order-fulfilment.spec.ts`'s "CANNOT move
 *    another org's order" case is that test, and it fails when
 *    `handleSites`' `orgOwnsHost` is removed.
 * 4. **This plugin is switched on for this site.** The resource is
 *    registered for every organization the console serves, so its being here
 *    says nothing about one org's configuration; without this an org that
 *    switched commerce off for a site would still accept writes into it,
 *    which is the per-site enablement rule (AGL-1014) the plugin API
 *    dispatcher applies to every other commerce door.
 *
 * ## No `Idempotency-Key`
 *
 * None is needed and none is accepted: the write returns without writing when
 * the order is already in the target status, so a retry lands the same state
 * AND returns the same `200` with the same order body — the contract
 * `updateRecord`, `updateContact` and `updateFormSubmission` are held to.
 */
async function updateOrder(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  orderId: string,
): Promise<Response> {
  const body = await readJsonBody(request)
  const unknown = Object.keys(body).filter((key) => !ORDER_WRITABLE_KEYS.includes(key))
  if (unknown.length > 0) {
    // Named, not dropped — the `updateFormSubmission` / `updateContact` rule.
    // A silently ignored `trackingUrl` here reads as "we recorded your
    // shipment as you described it" when half of it went nowhere, and the
    // caller is a warehouse system that will never look again.
    return ApiErrors.badRequest({
      message:
        'Only `status`, `carrier`, `trackingNumber`, `trackingUrl`, `lineItems` and `notify` can be set on an order',
      code: 'validation_failed',
      fields: Object.fromEntries(
        unknown.map((key) => [key, 'Not writable on an order']),
      ),
      headers: ctx.headers,
    })
  }

  const status = String(body.status ?? '')
  const refusal = ORDER_WRITE_REFUSED[status]
  if (refusal) {
    return ApiErrors.badRequest({
      message: refusal,
      code: 'validation_failed',
      fields: { status: refusal },
      headers: ctx.headers,
    })
  }
  if (!(ORDER_WRITE_TARGETS as string[]).includes(status)) {
    return ApiErrors.badRequest({
      message: 'Order failed validation',
      code: 'validation_failed',
      fields: {
        status: `Must be one of: ${ORDER_WRITE_TARGETS.join(', ')}`,
      },
      headers: ctx.headers,
    })
  }
  // Bounded exactly as the console route bounds them, so one field cannot be
  // used to stuff an order document through a door the console keeps narrow.
  const carrier = String(body.carrier ?? '').slice(0, 40)
  const trackingNumber = String(body.trackingNumber ?? '').slice(0, 60)
  // Partial shipments (AGL-3611): `lineItems: [{ lineItemId, quantity }]`.
  // Absent keeps the old meaning, everything still to ship.
  let lineItems: Array<{ lineItemId: number; quantity: number }> | undefined
  if (body.lineItems !== undefined) {
    if (status !== 'fulfilled' || !Array.isArray(body.lineItems) || body.lineItems.length === 0) {
      return ApiErrors.badRequest({
        message: 'Order failed validation',
        code: 'validation_failed',
        fields: {
          lineItems:
            status !== 'fulfilled'
              ? 'Only a `fulfilled` update names line items'
              : 'Must be a non-empty array of { lineItemId, quantity }',
        },
        headers: ctx.headers,
      })
    }
    lineItems = (body.lineItems as unknown[]).slice(0, 500).map((entry) => ({
      lineItemId: Number((entry as Record<string, unknown>)?.lineItemId),
      quantity: Number((entry as Record<string, unknown>)?.quantity),
    }))
  }
  const idempotencyKey = request.headers.get('idempotency-key') ?? undefined

  // Gate 4: this plugin, on for this site.
  const hostSnap = await hostRef(ctx, hostId).get()
  if (!isHostPluginEnabled(ctx.org, hostSnap.data(), BUNDLE_ID)) {
    return ApiErrors.notFound({
      message: 'No such site',
      headers: ctx.headers,
    })
  }

  const outcome = await recordOrderShipment({
    hostId,
    orderId,
    to: status as OrderFulfilmentTarget,
    carrier,
    trackingNumber,
    ...(lineItems ? { lineItems } : {}),
    ...(typeof body.trackingUrl === 'string' ? { trackingUrl: body.trackingUrl } : {}),
    ...(body.notify === false ? { notify: false } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  })
  if (outcome.outcome === 'invalid_lines') {
    return outcome.problem.problem === 'over_fulfilled'
      ? ApiErrors.conflict({
          message: outcome.message,
          code: 'over_fulfilled',
          headers: ctx.headers,
        })
      : ApiErrors.badRequest({
          message: 'Order failed validation',
          code: 'validation_failed',
          fields: { lineItems: outcome.message },
          headers: ctx.headers,
        })
  }
  if (outcome.outcome === 'no_such_order') {
    return ApiErrors.notFound({
      message: 'No such order',
      headers: ctx.headers,
    })
  }
  if (outcome.outcome === 'blocked') {
    // A NEW 409 code (`order_transition`), because an integrator has to be
    // able to tell "the order moved on without me" apart from every other
    // conflict this API can raise — it is the one a fulfilment poller will
    // actually hit, and the one it must not retry forever.
    return ApiErrors.conflict({
      message: `Orders in "${outcome.from}" cannot be marked ${status}`,
      code: 'order_transition',
      headers: ctx.headers,
    })
  }
  // The order object, on both `recorded` and `already` — a retry lands the
  // same state and reads the same 200. Re-read after the write so the body
  // shows the shipment that was just recorded rather than the one before it.
  return apiJson(orderView(await hostRef(ctx, hostId).collection('orders').doc(orderId).get()), {
    headers: ctx.headers,
  })
}

/**
 * Price and stock live on VARIANTS, never on the product — a product-level
 * `inventory` exists only as a denormalized sum the console rewrites on every
 * decrement, and a product-level `priceUsd` is the legacy single-variant
 * shape. Publishing either as the product's price would be wrong the moment a
 * product has two variants, so the variant array is the contract and the
 * product carries only the roll-up, clearly named.
 *
 * `inventory: null` on a variant means UNTRACKED and `0` means SOLD OUT.
 * Collapsing them (the `?? 0` an integrator writes on the first day) turns
 * every untracked product into an out-of-stock one, so the distinction is
 * carried through verbatim rather than defaulted.
 */
function variantView(variant: Record<string, unknown>) {
  const inventory = variant.inventory
  return {
    id: variant.id ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    options: variant.options ?? {},
    priceUsd: typeof variant.priceUsd === 'number' ? variant.priceUsd : null,
    compareAtPriceUsd:
      typeof variant.compareAtPriceUsd === 'number'
        ? variant.compareAtPriceUsd
        : null,
    weightGrams:
      typeof variant.weightGrams === 'number' ? variant.weightGrams : null,
    inventory: typeof inventory === 'number' ? inventory : null,
    inventoryTracked: typeof inventory === 'number',
  }
}

function productView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  const variants = Array.isArray(data.variants)
    ? (data.variants as Array<Record<string, unknown>>)
    : []
  const tracked = variants.filter((v) => typeof v.inventory === 'number')
  return {
    id: doc.id,
    object: 'product',
    name: data.name ?? null,
    slug: data.slug ?? null,
    description: data.description ?? null,
    type: data.type ?? null,
    status: data.status ?? null,
    tags: data.tags ?? [],
    categoryIds: data.categoryIds ?? [],
    mediaUrls: data.mediaUrls ?? [],
    options: data.options ?? [],
    variants: variants.map(variantView),
    // The sum across TRACKED variants only, and `null` when none of them is
    // tracked — so an untracked catalogue reads as "we don't count this"
    // rather than as a store with nothing left to sell.
    inventory: tracked.length
      ? tracked.reduce((sum, v) => sum + Number(v.inventory ?? 0), 0)
      : null,
    subscription: serialize(data.subscription) ?? null,
    created: data.createdAtMs ? new Date(Number(data.createdAtMs)).toISOString() : null,
    updated: data.updatedAtMs ? new Date(Number(data.updatedAtMs)).toISOString() : null,
  }
}

export async function handleProducts(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , productId] = segments
  const denied = requireScope(ctx, 'products:read')
  if (denied) return denied
  const unentitled = requireCommerce(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: ctx.headers })
  }
  const collection = hostRef(ctx, hostId).collection('products')

  if (productId) {
    const snap = await collection.doc(productId).get()
    // A soft-deleted product is gone as far as a customer is concerned. The
    // console filters `deletedAt` client-side; the API must not hand back a
    // product the merchant deleted just because the document survives.
    if (!snap.exists || snap.get('deletedAt')) {
      return ApiErrors.notFound({ message: 'No such product', headers: ctx.headers })
    }
    return apiJson(productView(snap), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const status = url.searchParams.get('status')
  if (status) query = query.where('status', '==', status)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs.filter((doc) => !doc.get('deletedAt')).map(productView)
  return listResponse(data, nextCursor, ctx.headers)
}

