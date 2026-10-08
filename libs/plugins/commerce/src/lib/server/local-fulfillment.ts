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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { normalizePhone } from '@aglyn/aglyn/foundation/definitions/contact.types'
import { pluginSmsMessaging } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { pluginShippingRateQuoter } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import { consumeRateLimit, firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import * as CommerceModel from '../model'
import { readCartId } from './cart-cookie'

/**
 * Buy online, pick up in store, and local delivery at checkout (AGL-3624).
 *
 * The buyer chooses at the CART, before payment — the only place the store
 * still controls what is offered: a Stripe Checkout Session prices shipping
 * from the options it is created with and asks nothing back. So the cart
 * declares one of three ways, and this module turns the declaration into the
 * session it needs, or refuses it in words the cart can show:
 *
 *   - `pickup` at one location: no shipping charged, no address collected,
 *     the stock reserved at that location, and the order routed there.
 *   - `local_delivery`: the store's OWN driver (not a marketplace courier —
 *     that is the delivery-apps plugin, which never reads this). The postal
 *     code — or, for a distance zone, the address — picks a zone, the zone
 *     prices the fee and enforces its minimum, and the buyer books a window.
 *     The session carries the fee as its one shipping option and collects an
 *     address only in the store's country.
 *   - `shipping`: everything as it was.
 *
 * A DECLARATION IS A REQUEST, NEVER A PRICE. The cart sends a location id, a
 * postal code and a window; the fee, the minimum and whether the window is
 * still open are all decided here from the store's own settings, on every
 * attempt.
 *
 * DISTANCE ZONES need both ends on a map, and the repository has no geocoder
 * of its own: the destination is placed by the shipping plugin's address
 * check (core's `core.shipping-rate-quoter` seam) when its provider returns a
 * position. Where none does, a distance zone matches nothing and the buyer is
 * told the store does not deliver there; postal-code zones need nothing.
 */

/** What the cart declares. */
export interface LocalFulfillmentRequest {
  method: CommerceModel.OrderFulfillmentMethod
  locationId?: string
  postalCode?: string
  windowStartMs?: number
  /** The street address, asked only when the store has distance zones. */
  address?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string }
  /**
   * The mobile number the buyer gave AT THE CART for texts about this pickup
   * or delivery (AGL-3624), in E.164. The only phone an online order's texts
   * go to: asked for that purpose, never taken from an address.
   */
  textPhone?: string
}

/** Reads the cart's declaration; `null` when it made none (a shipped order). */
export function readLocalFulfillmentRequest(value: unknown): LocalFulfillmentRequest | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const method = raw['method']
  if (method !== 'pickup' && method !== 'local_delivery') return null
  const text = (input: unknown, max: number) => String(input ?? '').trim().slice(0, max)
  const request: LocalFulfillmentRequest = { method }
  const phone = normalizePhone(text(raw['textPhone'], 32))
  if (phone) request.textPhone = phone
  if (method === 'pickup') {
    request.locationId = text(raw['locationId'], 120)
    return request
  }
  const postalCode = text(raw['postalCode'], 16)
  if (postalCode) request.postalCode = postalCode
  const start = Math.round(Number(raw['windowStartMs']))
  if (Number.isFinite(start) && start > 0) request.windowStartMs = start
  const address = raw['address']
  if (address && typeof address === 'object') {
    const parts = address as Record<string, unknown>
    request.address = {
      line1: text(parts['line1'], 120),
      line2: text(parts['line2'], 120),
      city: text(parts['city'], 80),
      state: text(parts['state'], 40),
      postalCode: text(parts['postalCode'], 16) || postalCode,
    }
  }
  return request
}

/** The store's pickup locations and delivery settings, read once per attempt. */
export interface LocalFulfillmentStore {
  pickupLocations: CommerceModel.PickupLocationOption[]
  delivery: CommerceModel.LocalDeliverySettings
  timeZone: string
}

/** Reads what checkout and the cart need. Never throws: a failed read offers nothing. */
export async function readLocalFulfillmentStore(input: {
  hostRef: any
  /** `settings/store` as already read, to save a read. */
  storeSettings?: Record<string, unknown> | null
  org?: { timeZone?: string } | null
  host?: { timeZone?: string } | null
}): Promise<LocalFulfillmentStore> {
  const { hostRef } = input
  const [locationsSnapshot, settings, host] = await Promise.all([
    hostRef
      .collection('locations')
      .limit(CommerceModel.PICKUP_LOCATIONS_MAX)
      .get()
      .catch(() => null),
    input.storeSettings !== undefined
      ? Promise.resolve(input.storeSettings)
      : hostRef
          .collection('settings')
          .doc('store')
          .get()
          .then((snapshot: any) => (snapshot?.data?.() ?? null) as Record<string, unknown> | null)
          .catch(() => null),
    input.host !== undefined
      ? Promise.resolve(input.host)
      : hostRef
          .get()
          .then((snapshot: any) => (snapshot?.data?.() ?? null) as { timeZone?: string } | null)
          .catch(() => null),
  ])
  const locations = (locationsSnapshot?.docs ?? []).map((snapshot: any) => ({
    ...(snapshot.data() as CommerceModel.InventoryLocation),
    id: String(snapshot.id),
  }))
  return {
    pickupLocations: CommerceModel.pickupLocationOptions(locations),
    delivery: CommerceModel.normalizeLocalDeliverySettings(settings?.['localDelivery']),
    timeZone: resolveSiteTimeZone(input.org ?? null, host ?? null),
  }
}

/** How long checkout waits for an address to be placed on a map. */
export const LOCAL_DELIVERY_GEOCODE_TIMEOUT_MS = 3_000

/**
 * Places an address on the map through the shipping plugin's address check,
 * or answers `null`: no plugin, not available on this site, no position in
 * the answer, or slower than the timeout. Never throws.
 */
export async function placeDeliveryAddress(
  hostId: string,
  address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country: string },
): Promise<CommerceModel.LocalDeliveryCoordinates | null> {
  if (!address.line1 || !address.postalCode) return null
  const quoter = pluginShippingRateQuoter()
  if (!quoter?.validateAddress) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const placed = await Promise.race([
      (async () => {
        if (!(await quoter.available(hostId))) return null
        const check = await quoter.validateAddress?.(hostId, {
          line1: address.line1,
          ...(address.line2 ? { line2: address.line2 } : {}),
          ...(address.city ? { city: address.city } : {}),
          ...(address.state ? { state: address.state } : {}),
          postalCode: address.postalCode,
          country: address.country,
        } as never)
        return check?.verdict === 'invalid' ? null : (check?.coordinates ?? null)
      })().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOCAL_DELIVERY_GEOCODE_TIMEOUT_MS)
      }),
    ])
    return placed ?? null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The shipping option id a local delivery fee is declared under. */
export const LOCAL_DELIVERY_RATE_ID = 'local-delivery'

export type LocalFulfillmentPlan =
  | { kind: 'shipping' }
  | {
      kind: 'refusal'
      status: 400 | 409
      error: string
      /** What the cart should re-ask: the options changed under the buyer. */
      changed?: 'pickup' | 'delivery'
    }
  | {
      kind: 'pickup'
      location: CommerceModel.PickupLocationOption
      metadata: Record<string, string>
    }
  | {
      kind: 'local_delivery'
      zone: CommerceModel.LocalDeliveryZone
      window: CommerceModel.LocalDeliveryWindow
      feeCents: number
      country: string
      locationId?: string
      option: CommerceModel.ResolvedShippingRate
      metadata: Record<string, string>
    }

const money = (cents: number) => CommerceModel.formatOrderMoney(cents, 'USD')

/**
 * Turns the cart's declaration into what the session needs, or a refusal.
 * Taken BEFORE any reservation or Stripe call, so a refusal costs nothing
 * and the buyer's same button works once they choose again.
 */
export async function planLocalFulfillment(input: {
  hostId: string
  request: LocalFulfillmentRequest | null
  /** The goods, pre-discount — what a minimum and a free-over threshold read. */
  itemsCents: number
  hasPhysicalLine: boolean
  store: LocalFulfillmentStore
  nowMs?: number
}): Promise<LocalFulfillmentPlan> {
  const { request, store } = input
  // A cart of downloads is not collected or driven anywhere.
  if (!request || request.method === 'shipping' || !input.hasPhysicalLine) return { kind: 'shipping' }
  const nowMs = input.nowMs ?? Date.now()

  if (request.method === 'pickup') {
    const location = store.pickupLocations.find((entry) => entry.id === request.locationId)
    if (!location) {
      return {
        kind: 'refusal',
        status: 409,
        error: 'That pickup location is no longer available. Choose another.',
        changed: 'pickup',
      }
    }
    return {
      kind: 'pickup',
      location,
      metadata: {
        fulfillment: 'pickup',
        pickupLocationId: location.id,
        ...(request.textPhone ? { orderTextPhone: request.textPhone } : {}),
      },
    }
  }

  const delivery = store.delivery
  if (!CommerceModel.localDeliveryOffered(delivery)) {
    return {
      kind: 'refusal',
      status: 409,
      error: 'Local delivery is not available right now. Choose shipping or pickup.',
      changed: 'delivery',
    }
  }
  const country = String(delivery.country)
  const postalCode = CommerceModel.normalizePostcode(
    request.postalCode ?? request.address?.postalCode,
    country,
  )
  if (!postalCode) {
    return { kind: 'refusal', status: 400, error: 'Enter your postal code for delivery.' }
  }
  let zone = CommerceModel.matchLocalDeliveryZone(delivery, { country, postalCode })
  if (!zone && CommerceModel.localDeliveryHasRadiusZones(delivery)) {
    if (!request.address?.line1) {
      return { kind: 'refusal', status: 400, error: 'Enter your street address for delivery.' }
    }
    const coordinates = await placeDeliveryAddress(input.hostId, {
      ...request.address,
      postalCode,
      country,
    })
    zone = CommerceModel.matchLocalDeliveryZone(delivery, { country, postalCode, coordinates })
  }
  if (!zone) {
    return {
      kind: 'refusal',
      status: 409,
      error: `We don’t deliver to ${postalCode}. Choose shipping or pickup instead.`,
    }
  }
  const shortfall = CommerceModel.localDeliveryMinimumShortfall(zone, input.itemsCents)
  if (shortfall > 0) {
    return {
      kind: 'refusal',
      status: 409,
      error:
        `Delivery to ${postalCode} needs an order of at least ${money(zone.minimumCents ?? 0)}. ` +
        `Add ${money(shortfall)} more, or choose shipping or pickup.`,
    }
  }
  const window = CommerceModel.findLocalDeliveryWindow(delivery, request.windowStartMs, {
    nowMs,
    timeZone: store.timeZone,
  })
  if (!window) {
    return {
      kind: 'refusal',
      status: 409,
      error: 'That delivery time is no longer available. Choose another.',
      changed: 'delivery',
    }
  }
  const feeCents = CommerceModel.localDeliveryFeeCents(zone, input.itemsCents)
  const label = CommerceModel.formatLocalDeliveryWindow(window, store.timeZone)
  return {
    kind: 'local_delivery',
    zone,
    window,
    feeCents,
    country,
    ...(delivery.locationId ? { locationId: delivery.locationId } : {}),
    option: {
      rateId: LOCAL_DELIVERY_RATE_ID,
      name: `Local delivery — ${label}`.slice(0, 100),
      amountCents: feeCents,
    },
    metadata: {
      fulfillment: 'local_delivery',
      deliveryZoneId: zone.id,
      deliveryWindowStartMs: String(window.startMs),
      deliveryWindowEndMs: String(window.endMs),
      deliveryPostalCode: postalCode,
      deliveryFeeCents: String(feeCents),
      ...(delivery.locationId ? { deliveryLocationId: delivery.locationId } : {}),
      ...(request.textPhone ? { orderTextPhone: request.textPhone } : {}),
    },
  }
}

/** Sets a plan's metadata on a session's form body. */
export function appendLocalFulfillmentMetadata(params: URLSearchParams, metadata: Record<string, string>): void {
  for (const [key, value] of Object.entries(metadata)) {
    params.set(`metadata[${key}]`, String(value).slice(0, 480))
  }
}

/** The location a plan takes its stock from, if any. */
export function localFulfillmentLocationId(plan: LocalFulfillmentPlan): string | undefined {
  if (plan.kind === 'pickup') return plan.location.id
  if (plan.kind === 'local_delivery') return plan.locationId
  return undefined
}

/** A stock refusal for a plan that reserves at one location (AGL-3624). */
export function localStockRefusalMessage(plan: LocalFulfillmentPlan, productName: string): string {
  const what = productName ? `"${productName}"` : 'An item in your cart'
  if (plan.kind === 'pickup') {
    return `${what} is not in stock at ${plan.location.name}. Choose another location, or have it shipped.`
  }
  return `${what} is not in stock for local delivery. Choose pickup at another location, or have it shipped.`
}

// ---------------------------------------------------------------------------
// The order, as the webhook records it
// ---------------------------------------------------------------------------

/** What a paid session's declaration becomes on its order. */
export interface OrderLocalFulfillment {
  fields: {
    fulfillmentMethod: CommerceModel.OrderFulfillmentMethod
    pickup?: CommerceModel.OrderPickup
    localDelivery?: CommerceModel.OrderLocalDelivery
    locationId?: string
    /** The number the buyer asked to be texted at, at the cart. */
    customerPhone?: string
  } & CommerceModel.OrderLocalFulfillmentListFields
  /** The line the receipt adds, so the buyer knows where and when. */
  summary: string
  /** The address entered at payment is outside the zone the fee was charged for. */
  outsideZone: boolean
}

/**
 * Reads a paid session's `fulfillment` metadata into order fields, or `null`
 * for a shipped order. The location and zone are re-read so the order keeps
 * their names as they were when the buyer paid.
 */
export async function orderLocalFulfillmentFromSession(input: {
  hostId: string
  hostRef: any
  metadata: Record<string, unknown> | null | undefined
  /** The address the buyer entered at payment, when the session collected one. */
  shippingAddress?: { postalCode?: string | null; country?: string | null } | null
  createdAtMs: number
}): Promise<OrderLocalFulfillment | null> {
  const metadata = input.metadata ?? {}
  const method = metadata['fulfillment']
  if (method !== 'pickup' && method !== 'local_delivery') return null
  const textPhone = normalizePhone(String(metadata['orderTextPhone'] ?? ''))
  const phone = textPhone ? { customerPhone: textPhone } : {}
  const org = await getOrgForHost(input.hostId).catch(() => null)
  const store = await readLocalFulfillmentStore({
    hostRef: input.hostRef,
    org: (org?.org ?? null) as { timeZone?: string } | null,
  })

  if (method === 'pickup') {
    const locationId = String(metadata['pickupLocationId'] ?? '')
    let location = store.pickupLocations.find((entry) => entry.id === locationId)
    // A location renamed or switched off after the buyer paid: the order
    // still goes there, under the name the location doc now has.
    if (!location && locationId) {
      const snapshot = await input.hostRef
        .collection('locations')
        .doc(locationId)
        .get()
        .catch(() => null)
      const data = (snapshot?.exists ? snapshot.data() : null) as CommerceModel.InventoryLocation | null
      location = {
        id: locationId,
        name: String(data?.name || 'the store'),
        ...(data
          ? { address: CommerceModel.formatPostalAddressLine(data.postalAddress, data.address) || undefined }
          : {}),
      }
    }
    if (!location) return null
    const pickup: CommerceModel.OrderPickup = {
      locationId: location.id,
      locationName: location.name,
      ...(location.address ? { address: location.address } : {}),
      ...(location.instructions ? { instructions: location.instructions } : {}),
      ...(location.hours ? { hours: location.hours } : {}),
      status: 'preparing',
      updatedAtMs: input.createdAtMs,
    }
    const order = { fulfillmentMethod: 'pickup' as const, pickup, createdAtMs: input.createdAtMs }
    const list = CommerceModel.orderLocalFulfillmentListFields(order) as CommerceModel.OrderLocalFulfillmentListFields
    const ready = CommerceModel.pickupReadyWithinLabel(location.readyWithinMinutes)
    return {
      fields: { fulfillmentMethod: 'pickup', pickup, locationId: location.id, ...phone, ...list },
      summary: [
        `Pickup at ${location.name}${location.address ? `, ${location.address}` : ''}.`,
        `We’ll let you know when it’s ready${ready ? ` (${ready.toLowerCase()})` : ''}.`,
        location.instructions ?? '',
      ]
        .filter(Boolean)
        .join(' '),
      outsideZone: false,
    }
  }

  const zoneId = String(metadata['deliveryZoneId'] ?? '')
  const zone = (store.delivery.zones ?? []).find((entry) => entry.id === zoneId)
  const windowStartMs = Number(metadata['deliveryWindowStartMs']) || 0
  const windowEndMs = Number(metadata['deliveryWindowEndMs']) || windowStartMs
  const declared = String(metadata['deliveryPostalCode'] ?? '')
  const country = store.delivery.country ?? String(input.shippingAddress?.country ?? '')
  const entered = CommerceModel.normalizePostcode(input.shippingAddress?.postalCode, country)
  // The fee was charged for the code the buyer declared. The address they
  // then typed at payment must be in a zone too — a zone of ANY fee, since
  // the store delivers there — or the store is told.
  const outsideZone = Boolean(
    entered &&
      entered !== declared &&
      !CommerceModel.matchLocalDeliveryZone(store.delivery, { country, postalCode: entered }),
  )
  const windowLabel = windowStartMs
    ? CommerceModel.formatLocalDeliveryWindow({ startMs: windowStartMs, endMs: windowEndMs }, store.timeZone)
    : ''
  const locationId = String(metadata['deliveryLocationId'] ?? '') || undefined
  const localDelivery: CommerceModel.OrderLocalDelivery = {
    zoneId,
    zoneName: zone?.name ?? 'Local delivery',
    feeCents: Math.max(0, Math.round(Number(metadata['deliveryFeeCents']) || 0)),
    windowStartMs,
    windowEndMs,
    ...(windowLabel ? { windowLabel } : {}),
    ...(declared ? { postalCode: declared } : {}),
    ...(locationId ? { locationId } : {}),
    status: 'scheduled',
    ...(outsideZone ? { addressOutsideZone: true } : {}),
    updatedAtMs: input.createdAtMs,
  }
  const order = { fulfillmentMethod: 'local_delivery' as const, localDelivery, createdAtMs: input.createdAtMs }
  const list = CommerceModel.orderLocalFulfillmentListFields(order) as CommerceModel.OrderLocalFulfillmentListFields
  return {
    fields: {
      fulfillmentMethod: 'local_delivery',
      localDelivery,
      ...(locationId ? { locationId } : {}),
      ...phone,
      ...list,
    },
    summary: [
      `Local delivery${windowLabel ? `: ${windowLabel}` : ''}.`,
      store.delivery.instructions ?? '',
    ]
      .filter(Boolean)
      .join(' '),
    outsideZone,
  }
}

// ---------------------------------------------------------------------------
// The cart's question: what can this basket be?
// ---------------------------------------------------------------------------

/** Distance zones place an address through a provider: a visitor may ask this often. */
const PLACE_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 }

/**
 * `POST commerce/local-fulfillment-options` (AGL-3624): what the cart offers
 * besides shipping — the pickup locations and, with a postal code, the
 * delivery zone's fee, minimum and the windows open to book.
 *
 * Public, because a shopper asks it; it returns only what a storefront would
 * print anyway (location names, addresses, hours, fees). It reads the
 * visitor's own cart through the cart cookie and offers nothing for a
 * basket with nothing physical in it.
 */
export const localFulfillmentOptionsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  let body: Record<string, any>
  try {
    body =
      req.method === 'POST'
        ? typeof req.body === 'string'
          ? JSON.parse(req.body || '{}')
          : (req.body ?? {})
        : ((req.query ?? {}) as Record<string, any>)
  } catch {
    return res.status(400).json({ error: 'Invalid request' })
  }
  const hostId = String(body.hostId ?? '')
  if (!isDocumentId(hostId)) return res.status(400).json({ error: 'Missing or invalid hostId' })
  const nothing = { pickup: [], delivery: null }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const ownerOrg = await getOrgForHost(hostId).catch(() => null)
    if (!ownerOrg?.org || !Aglyn.checkEntitlement(ownerOrg.org as any, 'commerce')) {
      return res.status(200).json(nothing)
    }
    // The visitor's own basket decides whether there is anything to collect.
    const cartId = readCartId(req.cookies, hostId)
    const cartSnapshot = cartId ? await hostRef.collection('carts').doc(cartId).get().catch(() => null) : null
    const cart = (cartSnapshot?.data?.() as CommerceModel.HostCart | undefined) ?? { lines: [] }
    const productIds = [...new Set((cart.lines ?? []).map((line) => line.productId))].slice(0, 50)
    const products = await Promise.all(
      productIds.map((id) =>
        hostRef
          .collection('products')
          .doc(id)
          .get()
          .catch(() => null),
      ),
    )
    let itemsCents = 0
    let hasPhysicalLine = false
    for (const line of cart.lines ?? []) {
      const snapshot = products[productIds.indexOf(line.productId)]
      if (!snapshot?.exists) continue
      const product = CommerceModel.liftLegacyProduct(snapshot.data() as any)
      const variant = line.variantId
        ? product.variants.find((item) => item.id === line.variantId)
        : product.variants[0]
      itemsCents += Math.round(Number(variant?.priceUsd ?? 0) * 100) * (Number(line.quantity) || 0)
      if ((product.type ?? 'physical') === 'physical') hasPhysicalLine = true
    }
    if (!hasPhysicalLine) return res.status(200).json(nothing)

    const store = await readLocalFulfillmentStore({
      hostRef,
      org: ownerOrg.org as { timeZone?: string },
    })
    const nowMs = Date.now()
    let delivery: Record<string, unknown> | null = null
    if (CommerceModel.localDeliveryOffered(store.delivery)) {
      const settings = store.delivery
      const country = String(settings.country)
      const windows = CommerceModel.upcomingLocalDeliveryWindows(settings, { nowMs, timeZone: store.timeZone }).map(
        (window) => ({
          ...window,
          label: CommerceModel.formatLocalDeliveryWindow(window, store.timeZone),
        }),
      )
      const radius = CommerceModel.localDeliveryHasRadiusZones(settings)
      delivery = {
        country,
        ...(settings.instructions ? { instructions: settings.instructions } : {}),
        needsAddress: radius,
        windows,
      }
      const request = readLocalFulfillmentRequest({
        method: 'local_delivery',
        postalCode: body.postalCode,
        address: body.address,
      })
      const postalCode = CommerceModel.normalizePostcode(request?.postalCode ?? request?.address?.postalCode, country)
      if (postalCode) {
        let zone = CommerceModel.matchLocalDeliveryZone(settings, { country, postalCode })
        if (!zone && radius && request?.address?.line1) {
          const visitor = String(req.socket?.remoteAddress ?? '') || 'no-address'
          const allowed = await consumeRateLimit(`local-delivery:place:${hostId}:${visitor}`, PLACE_LIMIT)
            .then((result) => result.allowed)
            .catch(() => false)
          const coordinates = allowed
            ? await placeDeliveryAddress(hostId, { ...request.address, postalCode, country })
            : null
          zone = CommerceModel.matchLocalDeliveryZone(settings, { country, postalCode, coordinates })
        }
        delivery['quote'] = zone
          ? {
              zoneId: zone.id,
              zoneName: zone.name,
              feeCents: CommerceModel.localDeliveryFeeCents(zone, itemsCents),
              ...(zone.minimumCents ? { minimumCents: zone.minimumCents } : {}),
              ...(zone.freeOverCents ? { freeOverCents: zone.freeOverCents } : {}),
              shortfallCents: CommerceModel.localDeliveryMinimumShortfall(zone, itemsCents),
            }
          : { unavailable: `We don’t deliver to ${postalCode}.` }
      }
    }
    // Whether the cart may offer texts about the pickup or delivery: the
    // platform can send them and the store has not turned them off.
    const toggles = (await hostRef
      .collection('settings')
      .doc('store')
      .get()
      .then((snapshot: any) => snapshot?.get?.('buyerNotifications'))
      .catch(() => null)) as unknown
    const texts = Boolean(
      pluginSmsMessaging()?.isConfigured() && CommerceModel.buyerNotificationEnabled(toggles, 'texts'),
    )
    return res.status(200).json({ pickup: store.pickupLocations, delivery, texts })
  } catch (error) {
    console.error('[local-fulfillment] options failed', hostId, error)
    return res.status(200).json(nothing)
  }
}
