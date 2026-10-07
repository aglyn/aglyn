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

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import * as Aglyn from '@aglyn/aglyn/server'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { needsReseal, openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import {
  consumeRateLimit,
  firebaseAdmin,
  getHostDisabledPlugins,
  getHostDocAdmin,
  getOrgForHost,
  getServerReleaseFlagValues,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { recordOrderShipment } from './fulfill-order'
import { readCommerceSecretKeyring } from './order-webhooks'

// lockdown-423: handled — the route asks `lockdownRefusal` itself, for the org and site its credentials name, before any read.

/*
 * SHIPSTATION'S CUSTOM STORE ENDPOINT (AGL-3613):
 * `/api/commerce/shipstation/{hostId}`, GET `?action=export` and POST
 * `?action=shipnotify` — the feed and the notice are pure data in
 * `model/shipstation.ts`.
 *
 * ## A machine's route, with every gate of its own
 *
 * ShipStation calls from its own servers with HTTP Basic credentials and
 * names no member, so the route is registered as a MACHINE's
 * (`machine: true`): the dispatcher skips its per-site enablement, release
 * and write-limit gates, and this route answers each of them itself, for
 * the site its URL names, AFTER the credentials are proven — an unproven
 * caller learns nothing about the site, not even whether commerce is on.
 *
 * - HTTPS only, outside development: the credentials ride every request.
 * - A per-site, per-address budget (`SHIPSTATION_RATE_LIMIT`); ShipStation
 *   polls from a handful of addresses shared by every store it serves, which
 *   is why the dispatcher's address-only bucket was the wrong one.
 * - Credentials minted per site by the console card. The password is sealed
 *   with the shared secret box under commerce's keyring
 *   (`readCommerceSecretKeyring`), bound to its site by the seal's context,
 *   so a site's admin can show it again and a copied document opens for no
 *   other site. A request's pair is compared as fixed-length digests in
 *   constant time.
 * - The site's commerce must be on, entitled by the plan and released for
 *   the org; a security or manual lockdown refuses.
 *
 * ## Which orders, and why a query
 *
 * The feed answers every order MODIFIED in ShipStation's window, whatever
 * its status — a cancel must reach ShipStation or a merchant ships it. Every
 * order writer stamps `updatedAtMs`, every creator stamps `requiresShipping`
 * (`withOrderListFields`), and the feed is ONE indexed query on the pair:
 * `(requiresShipping ==, updatedAtMs range)`. Pages follow a stored cursor,
 * so page 5 does not re-read pages 1 to 4; a page asked out of order falls
 * back to an offset.
 *
 * ## The notice is a shipment, recorded once
 *
 * A ShipNotice becomes a fulfillment through `recordOrderShipment` — the
 * console's own transaction, which also emails the buyer — for the items it
 * names, bounded by what is left to ship. Its tracking number is the
 * parcel's identity: the same number on the same order is answered
 * `already` and writes nothing, however often ShipStation retries or
 * whether the merchant typed it in first.
 */

/** Where each site's credentials are kept: server-only, every client denied. */
export const SHIPSTATION_CONNECTIONS = 'commerceShipStationConnections'

/** Requests per minute, per site and per calling address. */
export const SHIPSTATION_RATE_LIMIT = 120

/** The largest ShipNotice body read. A notice is a few kilobytes. */
export const SHIPNOTICE_MAX_BYTES = 256 * 1024

/** A connection as stored. */
export interface ShipStationConnection {
  hostId: string
  username: string
  /** The password, sealed with the secret box; never stored in the clear. */
  sealedPassword: string
  /** The id of the key that sealed it, for rotation. */
  passwordKeyId: string
  createdAtMs: number
  createdBy: string
  rotatedAtMs?: number
  lastExportAtMs?: number
  lastShipNoticeAtMs?: number
  /** Where the last export page ended, so the next page starts after it. */
  exportCursor?: { key: string; page: number; after: [number, string] }
}

/** SHA-256 hex of a secret. */
export function digestSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** A fresh username and password for a site. */
export function mintShipStationCredentials(): { username: string; password: string } {
  return {
    username: `aglyn-${randomBytes(6).toString('hex')}`,
    password: randomBytes(24).toString('base64url'),
  }
}

/** What binds a sealed password to its site: a copy opens for no other. */
export const shipStationSealContext = (hostId: string): string => `${SHIPSTATION_CONNECTIONS}/${hostId}#password`

/** The password sealed for a site, with the id of the key that sealed it. */
export function sealShipStationPassword(
  hostId: string,
  password: string,
  keyring: SecretBoxKeyring,
): Pick<ShipStationConnection, 'sealedPassword' | 'passwordKeyId'> {
  return {
    sealedPassword: sealSecret(password, keyring.current, { context: shipStationSealContext(hostId) }),
    passwordKeyId: keyring.current.id,
  }
}

/**
 * A site's password in the clear, and whether it should be sealed again under
 * the keyring's current key. `null` when it cannot be opened: no keyring, a
 * key the ring no longer holds, or a document copied from another site.
 */
export function openShipStationPassword(
  connection: Pick<ShipStationConnection, 'hostId' | 'sealedPassword'> | null,
  keyring: SecretBoxKeyring | null,
): { password: string; reseal: boolean } | null {
  if (!connection?.sealedPassword || !keyring) return null
  try {
    const opened = openSecret(connection.sealedPassword, keyring, { context: shipStationSealContext(connection.hostId) })
    return { password: opened.plaintext, reseal: needsReseal(opened, keyring) }
  } catch {
    return null
  }
}

/** The username and password of a Basic `Authorization` header, or `null`. */
export function readBasicAuth(header: string | null | undefined): { username: string; password: string } | null {
  const value = String(header ?? '')
  const match = /^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(value)
  if (!match) return null
  let decoded: string
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8')
  } catch {
    return null
  }
  const colon = decoded.indexOf(':')
  if (colon < 0) return null
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

/**
 * Whether the presented credentials are the stored ones. Both halves are
 * compared, always, as fixed-length digests, so neither a wrong username nor
 * a wrong password answers faster than the other. A password that could not
 * be opened (`null`) matches nothing.
 */
export function credentialsMatch(
  stored: { username: string; password: string | null } | null,
  presented: { username: string; password: string } | null,
): boolean {
  const expectedUser = Buffer.from(digestSecret(stored?.username ?? '\u0000'), 'hex')
  const expectedPass = Buffer.from(digestSecret(stored?.password ?? '\u0000'), 'hex')
  const user = Buffer.from(digestSecret(presented?.username ?? ''), 'hex')
  const pass = Buffer.from(digestSecret(presented?.password ?? ''), 'hex')
  const userOk = timingSafeEqual(user, expectedUser)
  const passOk = timingSafeEqual(pass, expectedPass)
  return Boolean(stored && stored.password !== null && presented && userOk && passOk)
}

/** A plain-text answer — ShipStation shows the body of a refusal to the merchant. */
function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } })
}

const unauthorized = (): Response =>
  text(401, `The ShipStation username or password is wrong. Copy them again from ${PLATFORM_BRAND_NAME}.`, {
    'www-authenticate': `Basic realm="${PLATFORM_BRAND_NAME.replace(/"/g, '')} ShipStation", charset="UTF-8"`,
  })

/**
 * Whether the request arrived over HTTPS. Behind Vercel the transport is
 * stated by `x-forwarded-proto`; a local or test run (`NODE_ENV` not
 * production) is not held to it.
 */
export function requestIsSecure(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (env['NODE_ENV'] !== 'production') return true
  const forwarded = String(request.headers.get('x-forwarded-proto') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  if (forwarded) return forwarded === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

/** A site id as a document id may hold it. */
const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

function hostIdOf(params: Record<string, string | string[]>): string | null {
  const raw = params['hostId']
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && HOST_ID.test(value) ? value : null
}

/**
 * The gates a dispatcher would have asked, for the site the credentials
 * proved: commerce switched on for it, on the plan, released for the org,
 * and the site not locked down. `null` when every one passes.
 */
async function siteRefusal(request: Request, hostId: string): Promise<Response | null> {
  const [owner, disabledPlugins, host] = await Promise.all([
    getOrgForHost(hostId),
    getHostDisabledPlugins(hostId),
    getHostDocAdmin(hostId),
  ])
  if (!owner?.org || !host) return text(404, `This site no longer exists in ${PLATFORM_BRAND_NAME}.`)
  const org = owner.org as Record<string, unknown>
  if (!Aglyn.resolveHostEnabledPlugins(owner.org as never, { disabledPlugins }).includes('commerce')) {
    return text(403, `Commerce is switched off for this site in ${PLATFORM_BRAND_NAME}.`)
  }
  if (!Aglyn.checkEntitlement(owner.org as never, 'commerce')) {
    return text(403, `This site’s ${PLATFORM_BRAND_NAME} plan does not include selling.`)
  }
  const flags = await getServerReleaseFlagValues()
  const released = Aglyn.isReleaseFlagOnForOrg(
    'release_commerce_v2',
    flags['release_commerce_v2'],
    owner.orgId,
    Aglyn.parseOrgReleaseFlagOverrides(org['releaseFlags']),
    Aglyn.resolveEffectivePlan(owner.org as never),
  )
  if (!released) return text(403, 'Commerce is not available for this site yet.')
  return lockdownRefusal({
    request,
    staff: false,
    uid: null,
    org,
    host: host as Record<string, unknown>,
  })
}

/*==========================================
 * EXPORT
 *=========================================*/

type Snapshot = FirebaseFirestore.QueryDocumentSnapshot

/**
 * What the feed needs of each product a page names: every variant's weight,
 * image and option choices, one `getAll` per page.
 */
export async function shipStationProductsFor(
  hostRef: FirebaseFirestore.DocumentReference,
  orders: ReadonlyArray<Partial<CommerceModel.HostOrder>>,
): Promise<CommerceModel.ShipStationProducts> {
  const ids = [
    ...new Set(
      orders.flatMap((order) => (order.lineItems ?? []).map((line) => line?.productId)).filter((id): id is string => Boolean(id)),
    ),
  ].filter((id) => !id.includes('/'))
  const products: Record<string, Record<string, CommerceModel.ShipStationProductFacts>> = {}
  const collection = hostRef.collection('products')
  for (let at = 0; at < ids.length; at += 100) {
    const docs = await hostRef.firestore.getAll(...ids.slice(at, at + 100).map((id) => collection.doc(id)))
    for (const doc of docs) {
      if (!doc.exists) continue
      const product = CommerceModel.liftLegacyProduct(doc.data() as never)
      const image = (product.mediaUrls ?? [])[0] ?? (doc.get('imageUrl') as string | undefined)
      const variants: Record<string, CommerceModel.ShipStationProductFacts> = {}
      const first = product.variants[0]
      variants[''] = {
        ...(first?.weightGrams ? { grams: first.weightGrams } : {}),
        ...(image ? { imageUrl: image } : {}),
      }
      for (const variant of product.variants) {
        variants[variant.id] = {
          ...(variant.weightGrams ? { grams: variant.weightGrams } : {}),
          ...(variant.imageUrl || image ? { imageUrl: variant.imageUrl || image } : {}),
          ...(variant.options && Object.keys(variant.options).length ? { options: variant.options } : {}),
        }
      }
      products[doc.id] = variants
    }
  }
  return products
}

/** The window ShipStation asked for, or the sentence explaining why it cannot be read. */
export function readExportWindow(
  query: URLSearchParams,
): { startMs: number; endMs: number; page: number } | { problem: string } {
  const startMs = CommerceModel.parseShipStationDate(query.get('start_date'))
  const endMs = CommerceModel.parseShipStationDate(query.get('end_date'))
  if (startMs === null || endMs === null) {
    return { problem: 'start_date and end_date must be dates as MM/dd/yyyy HH:mm, in UTC.' }
  }
  if (endMs < startMs) return { problem: 'end_date is before start_date.' }
  if (endMs - startMs > CommerceModel.SHIPSTATION_MAX_WINDOW_MS) {
    return { problem: 'Ask for at most a year of orders at a time.' }
  }
  const pageText = query.get('page') ?? '1'
  const page = /^\d{1,5}$/.test(pageText) ? Number(pageText) : NaN
  if (!Number.isInteger(page) || page < 1) return { problem: 'page must be a whole number from 1.' }
  // A window's end is a minute, so the whole of its last minute is inside it.
  return { startMs, endMs: endMs + 59_999, page }
}

/** One page of the feed, for a site whose request is already proven. */
export async function shipStationExport(
  hostId: string,
  window: { startMs: number; endMs: number; page: number },
  connection: ShipStationConnection,
  options: { pageSize?: number } = {},
): Promise<{ xml: string; pages: number; orders: number }> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const connectionRef = firestore.collection(SHIPSTATION_CONNECTIONS).doc(hostId)
  const pageSize = options.pageSize ?? CommerceModel.SHIPSTATION_PAGE_SIZE
  const idPath = firebaseAdmin.firestore.FieldPath.documentId()
  const base = hostRef
    .collection('orders')
    .where('requiresShipping', '==', true)
    .where('updatedAtMs', '>=', window.startMs)
    .where('updatedAtMs', '<=', window.endMs)
  const total = Number((await base.count().get()).data().count) || 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const ordered = base.orderBy('updatedAtMs', 'asc').orderBy(idPath, 'asc')
  const key = `${window.startMs}|${window.endMs}`
  const cursor = connection.exportCursor
  const followsCursor = window.page > 1 && cursor?.key === key && cursor.page === window.page - 1
  const query = window.page === 1
    ? ordered
    : followsCursor
      ? ordered.startAfter(...(cursor?.after ?? []))
      : ordered.offset((window.page - 1) * pageSize)
  const snapshot = window.page > pages ? null : await query.limit(pageSize).get()
  const docs: Snapshot[] = snapshot?.docs ?? []
  const sources = docs
    .map((doc) => ({ docId: doc.id, order: (doc.data() ?? {}) as CommerceModel.ShipStationOrderSource['order'] }))
    .filter((entry) => CommerceModel.shipStationCanImport(entry.order))
  const products = await shipStationProductsFor(hostRef, sources.map((entry) => entry.order))
  const xml = CommerceModel.shipStationOrdersXml(
    sources.map((entry) => CommerceModel.shipStationOrderXml(entry, products)),
    pages,
  )
  const last = docs[docs.length - 1]
  await connectionRef
    .set(
      {
        lastExportAtMs: Date.now(),
        ...(last
          ? { exportCursor: { key, page: window.page, after: [Number(last.get('updatedAtMs') ?? 0), last.id] } }
          : {}),
      },
      { merge: true },
    )
    .catch((error: unknown) => console.warn('shipstation: cursor not saved', hostId, error))
  return { xml, pages, orders: sources.length }
}

/*==========================================
 * SHIPNOTIFY
 *=========================================*/

/** The order a notice names, found by its id first and its number second. */
async function findNoticeOrder(
  hostRef: FirebaseFirestore.DocumentReference,
  notice: CommerceModel.ShipNotice,
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  const orders = hostRef.collection('orders')
  const byId = CommerceModel.parseShippingOrderRef(notice.orderId)
  if (byId?.id && !byId.id.includes('/')) {
    const doc = await orders.doc(byId.id).get()
    if (doc.exists) return doc
  }
  const ref = CommerceModel.parseShippingOrderRef(notice.orderNumber)
  if (!ref) return null
  if (ref.number !== undefined) {
    const matches = await orders.where('number', '==', ref.number).limit(2).get()
    // Two orders under one number is a store this route cannot decide for.
    if (matches.size === 1) return matches.docs[0]
    if (matches.size > 1) return null
  }
  if (ref.id && !ref.id.includes('/')) {
    const doc = await orders.doc(ref.id).get()
    if (doc.exists) return doc
  }
  return null
}

/** What a notice came to, for the route to answer ShipStation with. */
export type ShipNoticeOutcome =
  | { status: 200; body: string }
  | { status: 400 | 404 | 409; body: string }

/** Records one ShipNotice as a fulfillment, once. */
export async function recordShipNotice(hostId: string, notice: CommerceModel.ShipNotice, bodyDigest: string): Promise<ShipNoticeOutcome> {
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  const doc = await findNoticeOrder(hostRef, notice)
  const label = notice.orderNumber ?? notice.orderId ?? '?'
  if (!doc) return { status: 404, body: `${PLATFORM_BRAND_NAME} has no order ${label} on this site.` }
  const order = CommerceModel.liftLegacyOrder((doc.data() ?? {}) as never)
  const carrier = CommerceModel.shipStationCarrierName(notice.carrier)
  const trackingNumber = notice.trackingNumber

  if (trackingNumber && CommerceModel.fulfillmentWithTracking(order, trackingNumber)) {
    return { status: 200, body: 'Already recorded.' }
  }
  const named = CommerceModel.shipNoticeLines(order, notice.items)
  let lineItems: Array<{ lineItemId: number; quantity: number }> | undefined
  if (named.lines) {
    if (!named.lines.length) {
      return { status: 400, body: `None of the shipped items is on order ${label}: ${named.unknown.join(', ')}.` }
    }
    // Bounded by what is left: ShipStation's copy of the order may predate a
    // parcel the merchant shipped from Aglyn, and asking for more than
    // remains would refuse the whole notice.
    const remaining = new Map(
      CommerceModel.orderLineFulfillmentStates(order).map((state) => [state.lineItemId, state.remainingQuantity]),
    )
    const merged = new Map<number, number>()
    for (const entry of named.lines) merged.set(entry.lineItemId, (merged.get(entry.lineItemId) ?? 0) + entry.quantity)
    lineItems = [...merged.entries()]
      .map(([lineItemId, quantity]) => ({ lineItemId, quantity: Math.min(quantity, remaining.get(lineItemId) ?? 0) }))
      .filter((entry) => entry.quantity > 0)
    if (!lineItems.length) return { status: 200, body: 'Nothing on this notice is left to ship; nothing recorded.' }
  }

  const outcome = await recordOrderShipment({
    hostId,
    orderId: doc.id,
    to: 'fulfilled',
    carrier,
    trackingNumber,
    ...(lineItems ? { lineItems } : {}),
    // The parcel's identity: its tracking number, or — for a "mark as
    // shipped" with none — the notice itself, so a redelivery is one parcel.
    idempotencyKey: trackingNumber
      ? `shipstation:${CommerceModel.normalizeTrackingNumber(trackingNumber)}`
      : `shipstation-notice:${bodyDigest}`,
    onceByTracking: true,
  })
  switch (outcome.outcome) {
    case 'recorded':
      return { status: 200, body: 'Recorded.' }
    case 'already':
      return { status: 200, body: 'Already recorded.' }
    case 'no_such_order':
      return { status: 404, body: `${PLATFORM_BRAND_NAME} has no order ${label} on this site.` }
    case 'blocked':
      return { status: 409, body: `Order ${label} is ${outcome.from.replace(/_/g, ' ')} in ${PLATFORM_BRAND_NAME} and cannot be shipped.` }
    case 'invalid_lines':
      return { status: 400, body: outcome.message }
  }
}

/*==========================================
 * THE ROUTE
 *=========================================*/

/** `GET|POST /api/commerce/shipstation/{hostId}` — see the block header. */
export async function shipStationRoute(
  request: Request,
  context: { params: Record<string, string | string[]> },
): Promise<Response> {
  const hostId = hostIdOf(context.params)
  if (!hostId) return text(404, 'Not found')
  if (!requestIsSecure(request)) return text(403, `Use the https:// address ${PLATFORM_BRAND_NAME} gave you.`)

  const ip = readClientIp(request.headers) ?? 'unknown'
  const rate = await consumeRateLimit(`shipstation:${hostId}:${ip}`, {
    limit: SHIPSTATION_RATE_LIMIT,
    windowMs: 60_000,
  })
  if (!rate.allowed) {
    return text(429, 'Too many requests; ShipStation will retry.', {
      'retry-after': String(Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000))),
    })
  }

  const firestore = firebaseAdmin.app().firestore()
  const connectionRef = firestore.collection(SHIPSTATION_CONNECTIONS).doc(hostId)
  const stored = await connectionRef.get()
  const connection = stored.exists ? (stored.data() as ShipStationConnection) : null
  const keyring = readCommerceSecretKeyring()
  const opened = openShipStationPassword(connection, keyring)
  if (connection && !opened) console.error('shipstation: the stored password could not be opened', hostId)
  const presented = readBasicAuth(request.headers.get('authorization'))
  if (!credentialsMatch(connection ? { username: connection.username, password: opened?.password ?? null } : null, presented)) {
    return unauthorized()
  }
  const proven = connection as ShipStationConnection
  if (opened?.reseal && keyring) {
    // Sealed under a key the ring has since retired from sealing: seal it
    // again under the current one, so the old key can leave the ring.
    await connectionRef
      .set(sealShipStationPassword(hostId, opened.password, keyring), { merge: true })
      .catch((error: unknown) => console.warn('shipstation: password not resealed', hostId, error))
  }

  const refused = await siteRefusal(request, hostId)
  if (refused) return refused

  const url = new URL(request.url)
  const action = String(url.searchParams.get('action') ?? '').trim().toLowerCase()
  if (action === 'export') {
    if (request.method !== 'GET') return text(405, 'Use GET to export.', { allow: 'GET' })
    const window = readExportWindow(url.searchParams)
    if ('problem' in window) return text(400, window.problem)
    try {
      const page = await shipStationExport(hostId, window, proven)
      return new Response(page.xml, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } })
    } catch (error) {
      console.error('shipstation: export failed', hostId, error)
      return text(500, `${PLATFORM_BRAND_NAME} could not read the orders. ShipStation will retry.`)
    }
  }
  if (action === 'shipnotify') {
    if (request.method !== 'POST') return text(405, 'Use POST to notify a shipment.', { allow: 'POST' })
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > SHIPNOTICE_MAX_BYTES) return text(413, 'The notice is too large.')
    const body = await request.text()
    if (Buffer.byteLength(body, 'utf8') > SHIPNOTICE_MAX_BYTES) return text(413, 'The notice is too large.')
    const query: Record<string, string | undefined> = {}
    for (const name of ['order_number', 'carrier', 'service', 'tracking_number']) {
      query[name] = url.searchParams.get(name) ?? undefined
    }
    const notice = CommerceModel.readShipNotice(body, query)
    if ('problem' in notice) return text(400, notice.problem)
    if (!notice.orderNumber && !notice.orderId) return text(400, 'The notice names no order.')
    try {
      const outcome = await recordShipNotice(hostId, notice, digestSecret(body).slice(0, 32))
      await connectionRef
        .set({ lastShipNoticeAtMs: Date.now() }, { merge: true })
        .catch((error: unknown) => console.warn('shipstation: notice time not saved', hostId, error))
      return text(outcome.status, outcome.body)
    } catch (error) {
      console.error('shipstation: shipnotify failed', hostId, error)
      return text(500, `${PLATFORM_BRAND_NAME} could not record the shipment. ShipStation will retry.`)
    }
  }
  return text(400, 'action must be export or shipnotify.')
}
