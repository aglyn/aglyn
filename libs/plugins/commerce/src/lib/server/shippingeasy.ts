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

import { createHmac, timingSafeEqual } from 'crypto'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { needsReseal, openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { consumeRateLimit, firebaseAdmin, notifyHostManagers } from '@aglyn/tenant-data-admin'
import { PLUGIN_EVENT_MAX_ATTEMPTS } from '@aglyn/tenant-data-admin/server/plugin-event-outbox'
import type { HostOrder } from '../model/commerce-orders'
import {
  readShippingEasyCallback,
  SHIPPINGEASY_DEFAULT_BASE_URL,
  SHIPPINGEASY_SHIPPED_STATES,
  SHIPPINGEASY_TIMESTAMP_TOLERANCE_MS,
  shippingEasyCanonicalQuery,
  shippingEasyExternalId,
  shippingEasyIntent,
  shippingEasyOrderPayload,
  shippingEasySignaturePlaintext,
} from '../model/shippingeasy'
import { readCommerceSecretKeyring } from './order-webhooks'
import {
  connectorHostIdOf,
  connectorSiteRefusal,
  connectorText as text,
  digestSecret,
  requestIsSecure,
} from './shipping-connector-gates'
import { recordShipNotice, shipStationProductsFor } from './shipstation'

// lockdown-423: handled — the callback route and every push ask `connectorSiteRefusal`, which asks `lockdownRefusal`, before any write.

/*
 * THE SHIPPINGEASY CONNECTOR (AGL-3633). The order and the callback as data
 * are in `model/shippingeasy.ts`; this is the HTTP, the keys and the state.
 *
 * ## The merchant's own keys, so nothing to sign up for on our side
 *
 * ShippingEasy's order API is a CUSTOMER API: a merchant pushes orders into
 * their own account with the API key and secret on their Settings → API
 * Credentials page and the store API key of an "API" store. There is no
 * partner account between us and them, so the connector is offered wherever
 * commerce's secret keyring exists (`readCommerceSecretKeyring`), exactly as
 * the ShipStation card is, and nowhere else. The secret is sealed with the
 * shared secret box, bound to its site by the seal context; it never leaves
 * the server again, not even to the admin who typed it.
 *
 * ## Orders go out on commerce's own events
 *
 * Commerce subscribes to its `order.paid`, `order.cancelled` and
 * `order.refunded` events under the name `shippingeasy`
 * (`order-event-triggers.ts`). The subscriber pushes the order as it stands
 * NOW, read fresh, so a retried event never sends a stale copy: a paid order
 * with something to ship is created, and a canceled or refunded one that was
 * sent is canceled there. A failure that may pass (a 5xx, a 429, a timeout)
 * throws, and the outbox retries with its backoff; on the last attempt the
 * site's managers are told. A refusal that will not pass (bad keys, an order
 * ShippingEasy rejects) is recorded on the card instead of retried forever.
 * "Send open orders" on the card pushes what is open now, for the orders
 * paid before the connection or while it was failing.
 *
 * ## Each order once
 *
 * A record per order under the connection
 * (`commerceShippingEasyConnections/{hostId}/orders/{orderId}`) is claimed in
 * a transaction before the call: a second push of the same order while the
 * first is in flight is retried later, and one already sent answers
 * `already`. When ShippingEasy refuses a create, the order is looked up by
 * its identifier first, so an order that did arrive (a response lost on the
 * way back) is recorded as sent rather than as a failure.
 *
 * ## The callback is a shipment, recorded once
 *
 * `/api/commerce/shippingeasy/{hostId}` takes ShippingEasy's shipment
 * notification, signed with the merchant's API secret over the callback's
 * own path, query and body, and records each order of the shipment through
 * `recordShipNotice` — the same door ShipStation's notices go through — keyed
 * by the tracking number, so a redelivery or a number typed into Aglyn first
 * is one parcel and the buyer gets one shipped email.
 */

/** Where each site's connection is kept: server-only, every client denied. */
export const SHIPPINGEASY_CONNECTIONS = 'commerceShippingEasyConnections'

/** The per-order records under a connection. */
export const SHIPPINGEASY_ORDER_RECORDS = 'orders'

/** Callback requests per minute, per site and per calling address. */
export const SHIPPINGEASY_RATE_LIMIT = 120

/** The largest callback body read. A shipment of a few orders is tens of kilobytes. */
export const SHIPPINGEASY_CALLBACK_MAX_BYTES = 1024 * 1024

/** How long a claimed push holds its order before another may try. */
export const SHIPPINGEASY_CLAIM_MS = 2 * 60_000

/** How long one call to ShippingEasy may take. */
export const SHIPPINGEASY_REQUEST_TIMEOUT_MS = 15_000

/** Orders "Send open orders" pushes per click. */
export const SHIPPINGEASY_SYNC_LIMIT = 100

/** How far back "Send open orders" looks: older open orders are the merchant's to handle by hand. */
export const SHIPPINGEASY_SYNC_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/** The env var that points the connector at another ShippingEasy address. */
export const SHIPPINGEASY_BASE_URL_ENV = 'SHIPPINGEASY_API_BASE_URL'

/** A connection as stored. */
export interface ShippingEasyConnection {
  hostId: string
  /** The account's API key: sent in every query string, so not a secret on its own. */
  apiKey: string
  /** The account's API secret, sealed with the secret box; never stored in the clear. */
  sealedApiSecret: string
  /** The id of the key that sealed it, for rotation. */
  secretKeyId: string
  /** The API store's key, from ShippingEasy's Stores & Orders page. */
  storeApiKey: string
  createdAtMs: number
  createdBy: string
  updatedAtMs?: number
  lastPushAtMs?: number
  lastCallbackAtMs?: number
  /** The last thing that went wrong, for the card. Cleared by the next success. */
  lastError?: { message: string; atMs: number; orderNumber?: string } | null
}

/** Where one order stands with ShippingEasy. */
export type ShippingEasyOrderState = 'sending' | 'sent' | 'failed' | 'canceling' | 'canceled' | 'cancel_failed'

/** One order's record under a connection. */
export interface ShippingEasyOrderRecord {
  orderId: string
  externalId: string
  state: ShippingEasyOrderState
  claimedAtMs?: number
  sentAtMs?: number
  canceledAtMs?: number
  error?: string | null
  updatedAtMs: number
}

/** The merchant's keys in the clear, for one call. */
export interface ShippingEasyCredentials {
  apiKey: string
  apiSecret: string
  storeApiKey: string
}

/** What the connector's server calls are given, so specs can stand in for the network and the clock. */
export interface ShippingEasyDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  env?: Record<string, string | undefined>
}

/** A failure that may pass: the outbox retries it. */
export class ShippingEasyUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShippingEasyUnavailableError'
  }
}

/*==========================================
 * KEYS
 *=========================================*/

/** What a key from ShippingEasy's pages looks like: their keys are hex, allowed some slack. */
export const SHIPPINGEASY_KEY = /^[A-Za-z0-9_-]{8,128}$/

/** What binds a sealed secret to its site: a copy opens for no other. */
export const shippingEasySealContext = (hostId: string): string => `${SHIPPINGEASY_CONNECTIONS}/${hostId}#apiSecret`

/** The API secret sealed for a site, with the id of the key that sealed it. */
export function sealShippingEasySecret(
  hostId: string,
  apiSecret: string,
  keyring: SecretBoxKeyring,
): Pick<ShippingEasyConnection, 'sealedApiSecret' | 'secretKeyId'> {
  return {
    sealedApiSecret: sealSecret(apiSecret, keyring.current, { context: shippingEasySealContext(hostId) }),
    secretKeyId: keyring.current.id,
  }
}

/** A site's API secret in the clear and whether to seal it again, or `null` when it cannot be opened. */
export function openShippingEasySecret(
  connection: Pick<ShippingEasyConnection, 'hostId' | 'sealedApiSecret'> | null,
  keyring: SecretBoxKeyring | null,
): { apiSecret: string; reseal: boolean } | null {
  if (!connection?.sealedApiSecret || !keyring) return null
  try {
    const opened = openSecret(connection.sealedApiSecret, keyring, { context: shippingEasySealContext(connection.hostId) })
    return { apiSecret: opened.plaintext, reseal: needsReseal(opened, keyring) }
  } catch {
    return null
  }
}

/** The connection's keys in the clear, or `null` when the secret cannot be opened. */
export function shippingEasyCredentialsOf(
  connection: ShippingEasyConnection,
  keyring: SecretBoxKeyring | null,
): ShippingEasyCredentials | null {
  const opened = openShippingEasySecret(connection, keyring)
  return opened ? { apiKey: connection.apiKey, apiSecret: opened.apiSecret, storeApiKey: connection.storeApiKey } : null
}

/** The hex HMAC-SHA256 ShippingEasy signs with. */
export function signShippingEasy(apiSecret: string, plaintext: string): string {
  return createHmac('sha256', apiSecret).update(plaintext, 'utf8').digest('hex')
}

/** ShippingEasy's API address: the env's when it is an https URL, else theirs. */
export function shippingEasyBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = String(env[SHIPPINGEASY_BASE_URL_ENV] ?? '').trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === 'https:') return url.origin
    } catch {
      // An unreadable override falls back to ShippingEasy's own address.
    }
  }
  return SHIPPINGEASY_DEFAULT_BASE_URL
}

/*==========================================
 * CALLS
 *=========================================*/

/** One signed call to ShippingEasy. `path` is the full path, `/api/…`. Network failures become `ShippingEasyUnavailableError`. */
export async function shippingEasyRequest(
  credentials: ShippingEasyCredentials,
  input: { method: 'GET' | 'POST'; path: string; query?: Record<string, string>; body?: unknown },
  deps: ShippingEasyDeps = {},
): Promise<{ status: number; text: string }> {
  const now = deps.now ?? Date.now
  const body = input.body === undefined ? '' : JSON.stringify(input.body)
  const params: Record<string, string> = {
    ...(input.query ?? {}),
    api_key: credentials.apiKey,
    api_timestamp: String(Math.floor(now() / 1000)),
  }
  const signature = signShippingEasy(
    credentials.apiSecret,
    shippingEasySignaturePlaintext({ method: input.method, path: input.path, params, body }),
  )
  const url = `${shippingEasyBaseUrl(deps.env)}${input.path}?${shippingEasyCanonicalQuery(params)}&api_signature=${signature}`
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, {
      method: input.method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(SHIPPINGEASY_REQUEST_TIMEOUT_MS),
    })
    return { status: response.status, text: (await response.text().catch(() => '')).slice(0, 4000) }
  } catch (error) {
    throw new ShippingEasyUnavailableError(`ShippingEasy could not be reached (${(error as Error)?.name ?? 'error'})`)
  }
}

/** A refusal's words for the card: ShippingEasy's own message when it sent one, else its status. */
export function shippingEasyRefusalMessage(response: { status: number; text: string }): string {
  const fallback = `ShippingEasy answered ${response.status}`
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(response.text) as Record<string, unknown>
  } catch {
    return fallback
  }
  const errors = parsed?.['errors'] ?? parsed?.['error'] ?? parsed?.['message']
  const message = Array.isArray(errors)
    ? errors.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('; ')
    : typeof errors === 'string'
      ? errors
      : errors
        ? JSON.stringify(errors)
        : ''
  return (message || fallback).slice(0, 300)
}

const storePath = (credentials: ShippingEasyCredentials) => `/api/stores/${encodeURIComponent(credentials.storeApiKey)}/orders`

/** Whether a status may pass on its own: worth the outbox's retry. */
const transient = (status: number) => status >= 500 || status === 429 || status === 408

/**
 * Whether the keys work: one read of the store's orders. `refused` means
 * ShippingEasy said no to these keys or this store; `unavailable` means it
 * could not be asked.
 */
export async function checkShippingEasyCredentials(
  credentials: ShippingEasyCredentials,
  deps: ShippingEasyDeps = {},
): Promise<{ ok: true } | { ok: false; reason: 'refused' | 'unavailable'; message: string }> {
  try {
    const response = await shippingEasyRequest(credentials, { method: 'GET', path: storePath(credentials), query: { per_page: '1' } }, deps)
    if (response.status >= 200 && response.status < 300) return { ok: true }
    if (transient(response.status)) return { ok: false, reason: 'unavailable', message: shippingEasyRefusalMessage(response) }
    return { ok: false, reason: 'refused', message: shippingEasyRefusalMessage(response) }
  } catch (error) {
    return { ok: false, reason: 'unavailable', message: (error as Error).message }
  }
}

/*==========================================
 * PUSHING AN ORDER
 *=========================================*/

/** What one push came to. A transient failure throws `ShippingEasyUnavailableError` instead. */
export type ShippingEasyPushOutcome =
  | { result: 'not_connected' | 'skipped' | 'already' | 'sent' | 'canceled' }
  | { result: 'refused'; message: string }
  | { result: 'failed'; message: string }

function connectionRef(hostId: string): FirebaseFirestore.DocumentReference {
  return firebaseAdmin.app().firestore().collection(SHIPPINGEASY_CONNECTIONS).doc(hostId)
}

/** Records the last error, or clears it after a success, on the connection. Never throws. */
async function noteOnConnection(
  hostId: string,
  patch: Partial<Pick<ShippingEasyConnection, 'lastPushAtMs' | 'lastCallbackAtMs' | 'lastError'>>,
): Promise<void> {
  await connectionRef(hostId)
    .set(patch, { merge: true })
    .catch((error: unknown) => console.warn('shippingeasy: connection not stamped', hostId, error))
}

type Claim =
  | { go: true; record: ShippingEasyOrderRecord | null }
  | { go: false; outcome: ShippingEasyPushOutcome }

/**
 * Sends one order to ShippingEasy as it stands now, or cancels it there.
 * Safe to call any number of times for the same order: see the block header.
 */
export async function pushShippingEasyOrder(
  hostId: string,
  orderId: string,
  deps: ShippingEasyDeps = {},
): Promise<ShippingEasyPushOutcome> {
  const now = deps.now ?? Date.now
  const firestore = firebaseAdmin.app().firestore()
  const stored = await connectionRef(hostId).get()
  if (!stored.exists) return { result: 'not_connected' }
  const connection = stored.data() as ShippingEasyConnection
  const orderSnapshot = await firestore.collection('hosts').doc(hostId).collection('orders').doc(orderId).get()
  if (!orderSnapshot.exists) return { result: 'skipped' }
  const order = (orderSnapshot.data() ?? {}) as Partial<HostOrder> & { createdAtMs?: number; updatedAtMs?: number }
  const intent = shippingEasyIntent(order, orderId)
  if (!intent) return { result: 'skipped' }

  const refused = await connectorSiteRefusal({ method: 'POST' }, hostId)
  if (refused) return { result: 'refused', message: (await refused.text()).slice(0, 300) }

  const credentials = shippingEasyCredentialsOf(connection, readCommerceSecretKeyring())
  const externalId = shippingEasyExternalId(order, orderId)
  if (!credentials) {
    const message = 'The ShippingEasy API secret cannot be opened. Enter your keys again.'
    await noteOnConnection(hostId, { lastError: { message, atMs: now(), orderNumber: externalId } })
    return { result: 'failed', message }
  }

  const recordRef = connectionRef(hostId).collection(SHIPPINGEASY_ORDER_RECORDS).doc(orderId)
  const claim: Claim = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(recordRef)
    const record = snapshot.exists ? (snapshot.data() as ShippingEasyOrderRecord) : null
    const atMs = now()
    const inFlight =
      (record?.state === 'sending' || record?.state === 'canceling') &&
      atMs - Number(record.claimedAtMs ?? 0) < SHIPPINGEASY_CLAIM_MS
    if (inFlight) throw new ShippingEasyUnavailableError('This order is being sent to ShippingEasy already')
    if (intent === 'create') {
      if (record && record.state !== 'sending' && record.state !== 'failed') {
        return { go: false, outcome: { result: 'already' } }
      }
      transaction.set(recordRef, {
        orderId,
        externalId: record?.externalId ?? externalId,
        state: 'sending',
        claimedAtMs: atMs,
        updatedAtMs: atMs,
      } satisfies ShippingEasyOrderRecord)
      return { go: true, record }
    }
    // Cancel: only what was sent there. An order that never arrived has
    // nothing to cancel, and one canceled already is answered as such.
    if (!record || record.state === 'failed' || record.state === 'sending') return { go: false, outcome: { result: 'skipped' } }
    if (record.state === 'canceled') return { go: false, outcome: { result: 'already' } }
    transaction.set(recordRef, { ...record, state: 'canceling', claimedAtMs: atMs, updatedAtMs: atMs })
    return { go: true, record }
  })
  if ('outcome' in claim) return claim.outcome

  const sentId = claim.record?.externalId ?? externalId
  const settle = async (state: ShippingEasyOrderState, extra: Partial<ShippingEasyOrderRecord> = {}) => {
    await recordRef.set({ state, updatedAtMs: now(), ...extra }, { merge: true })
  }

  if (intent === 'cancel') {
    let response: { status: number; text: string }
    try {
      response = await shippingEasyRequest(
        credentials,
        { method: 'POST', path: `${storePath(credentials)}/${encodeURIComponent(sentId)}/cancellations` },
        deps,
      )
    } catch (error) {
      await settle('sent')
      throw error
    }
    if (transient(response.status)) {
      await settle('sent')
      throw new ShippingEasyUnavailableError(shippingEasyRefusalMessage(response))
    }
    if (response.status >= 200 && response.status < 300) {
      await settle('canceled', { canceledAtMs: now(), error: null })
      await noteOnConnection(hostId, { lastPushAtMs: now(), lastError: null })
      return { result: 'canceled' }
    }
    const message = `Order ${sentId} could not be canceled in ShippingEasy: ${shippingEasyRefusalMessage(response)}`
    await settle('cancel_failed', { error: message })
    await noteOnConnection(hostId, { lastError: { message, atMs: now(), orderNumber: sentId } })
    return { result: 'failed', message }
  }

  const lookUp = async (): Promise<boolean> => {
    const found = await shippingEasyRequest(
      credentials,
      { method: 'GET', path: `${storePath(credentials)}/${encodeURIComponent(sentId)}` },
      deps,
    ).catch(() => null)
    return Boolean(found && found.status >= 200 && found.status < 300)
  }
  const markSent = async (): Promise<ShippingEasyPushOutcome> => {
    await settle('sent', { sentAtMs: now(), error: null })
    await noteOnConnection(hostId, { lastPushAtMs: now(), lastError: null })
    return { result: 'sent' }
  }
  // A claim that lapsed mid-call may have landed: look before creating
  // again, so ShippingEasy never holds the order twice.
  if (claim.record?.state === 'sending' && (await lookUp())) return markSent()

  const hostRef = firestore.collection('hosts').doc(hostId)
  const products = await shipStationProductsFor(hostRef, [order])
  const payload = shippingEasyOrderPayload({ docId: orderId, order }, products)
  // A network failure throws past here with the claim left to lapse rather
  // than released: the call may have landed, and the retry's refused create
  // looks the order up before calling it failed.
  const response = await shippingEasyRequest(credentials, { method: 'POST', path: storePath(credentials), body: payload }, deps)
  if (transient(response.status)) {
    await settle('failed', { error: shippingEasyRefusalMessage(response) })
    throw new ShippingEasyUnavailableError(shippingEasyRefusalMessage(response))
  }
  if (response.status >= 200 && response.status < 300) return markSent()
  // A refused create may be an order that arrived on an earlier try whose
  // answer was lost: ask for it by its identifier before calling it failed.
  if (response.status !== 401 && response.status !== 403 && (await lookUp())) return markSent()
  const message =
    response.status === 401 || response.status === 403
      ? 'ShippingEasy refused the API key, secret or store API key. Enter them again.'
      : `Order ${sentId} was refused by ShippingEasy: ${shippingEasyRefusalMessage(response)}`
  await settle('failed', { error: message })
  await noteOnConnection(hostId, { lastError: { message, atMs: now(), orderNumber: sentId } })
  return { result: 'failed', message }
}

/**
 * The `shippingeasy` subscriber to commerce's order events. Throws on a
 * failure that may pass, so the outbox retries; on its last attempt the
 * site's managers are told and the card shows why.
 */
export async function deliverOrderEventToShippingEasy(
  envelope: Pick<PluginDomainEventEnvelope, 'hostId' | 'payload' | 'attempt' | 'event'>,
  deps: ShippingEasyDeps = {},
): Promise<ShippingEasyPushOutcome | null> {
  const orderId = String(((envelope.payload ?? {}) as { order?: { id?: unknown } }).order?.id ?? '')
  if (!orderId || orderId.includes('/')) return null
  try {
    return await pushShippingEasyOrder(envelope.hostId, orderId, deps)
  } catch (error) {
    if (!(error instanceof ShippingEasyUnavailableError) || envelope.attempt < PLUGIN_EVENT_MAX_ATTEMPTS) throw error
    const message = `${error.message}. Select Send open orders on the ShippingEasy card to try again.`
    await noteOnConnection(envelope.hostId, { lastError: { message, atMs: (deps.now ?? Date.now)() } })
    await notifyHostManagers(envelope.hostId, {
      type: 'content.order',
      title: 'An order could not be sent to ShippingEasy',
      body: `An order on {site} never reached ShippingEasy after ${envelope.attempt} attempts (${error.message}).`,
      link: `/${envelope.hostId}/products/settings`,
    }).catch(() => undefined)
    return { result: 'failed', message }
  }
}

/** What "Send open orders" came to. */
export interface ShippingEasySyncResult {
  sent: number
  already: number
  failed: number
  /** Whether more open orders are left past this pass's limit. */
  more: boolean
}

/**
 * Pushes the site's open orders from the last 90 days, a pass at a time: the
 * orders paid before the connection, or while it was failing. One indexed
 * query (`requiresShipping ==`, `updatedAtMs` range) — the same index the
 * ShipStation feed reads.
 */
export async function syncShippingEasyOrders(hostId: string, deps: ShippingEasyDeps = {}): Promise<ShippingEasySyncResult> {
  const now = deps.now ?? Date.now
  const orders = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .where('requiresShipping', '==', true)
    .where('updatedAtMs', '>=', now() - SHIPPINGEASY_SYNC_WINDOW_MS)
    .orderBy('updatedAtMs', 'asc')
    .limit(500)
    .get()
  const open = orders.docs.filter((doc) => shippingEasyIntent((doc.data() ?? {}) as never, doc.id) === 'create')
  const result: ShippingEasySyncResult = { sent: 0, already: 0, failed: 0, more: open.length > SHIPPINGEASY_SYNC_LIMIT }
  for (const doc of open.slice(0, SHIPPINGEASY_SYNC_LIMIT)) {
    try {
      const outcome = await pushShippingEasyOrder(hostId, doc.id, deps)
      if (outcome.result === 'sent') result.sent += 1
      else if (outcome.result === 'already') result.already += 1
      else if (outcome.result === 'failed' || outcome.result === 'refused') {
        result.failed += 1
        // Bad keys or a refused site fail every order alike: stop asking.
        if (outcome.result === 'refused' || /refused the API key/.test(outcome.message)) break
      }
    } catch (error) {
      result.failed += 1
      if (error instanceof ShippingEasyUnavailableError) continue
      throw error
    }
  }
  return result
}

/*==========================================
 * THE CALLBACK
 *=========================================*/

/**
 * Whether a callback was signed with this secret: the HMAC of its method,
 * path, query (without `api_signature`) and raw body, compared in constant
 * time; and, when it carries `api_timestamp`, sent within the hour.
 */
export function verifyShippingEasyCallback(input: {
  apiSecret: string
  method: string
  path: string
  query: URLSearchParams
  body: string
  nowMs: number
}): 'ok' | 'unsigned' | 'bad_signature' | 'expired' {
  const presented = String(input.query.get('api_signature') ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(presented)) return 'unsigned'
  const params: Record<string, string> = {}
  for (const [name, value] of input.query.entries()) if (name !== 'api_signature') params[name] = value
  const expected = signShippingEasy(
    input.apiSecret,
    shippingEasySignaturePlaintext({ method: input.method, path: input.path, params, body: input.body }),
  )
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(presented, 'hex'))) return 'bad_signature'
  if (params['api_timestamp'] !== undefined) {
    const seconds = Number(params['api_timestamp'])
    if (!Number.isFinite(seconds) || Math.abs(input.nowMs - seconds * 1000) > SHIPPINGEASY_TIMESTAMP_TOLERANCE_MS) return 'expired'
  }
  return 'ok'
}

/** `POST /api/commerce/shippingeasy/{hostId}` — ShippingEasy's shipment notification. See the block header. */
export async function shippingEasyRoute(
  request: Request,
  context: { params: Record<string, string | string[]> },
  deps: ShippingEasyDeps = {},
): Promise<Response> {
  const now = deps.now ?? Date.now
  const hostId = connectorHostIdOf(context.params)
  if (!hostId) return text(404, 'Not found')
  if (request.method !== 'POST') return text(405, 'ShippingEasy posts shipments here.', { allow: 'POST' })
  if (!requestIsSecure(request, deps.env)) return text(403, `Use the https:// address ${PLATFORM_BRAND_NAME} gave you.`)

  const ip = readClientIp(request.headers) ?? 'unknown'
  const rate = await consumeRateLimit(`shippingeasy:${hostId}:${ip}`, { limit: SHIPPINGEASY_RATE_LIMIT, windowMs: 60_000 })
  if (!rate.allowed) {
    return text(429, 'Too many requests; ShippingEasy will retry.', {
      'retry-after': String(Math.max(1, Math.ceil((rate.resetMs - now()) / 1000))),
    })
  }

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > SHIPPINGEASY_CALLBACK_MAX_BYTES) return text(413, 'The callback is too large.')
  const body = await request.text()
  if (Buffer.byteLength(body, 'utf8') > SHIPPINGEASY_CALLBACK_MAX_BYTES) return text(413, 'The callback is too large.')

  const ref = connectionRef(hostId)
  const stored = await ref.get()
  const connection = stored.exists ? (stored.data() as ShippingEasyConnection) : null
  const keyring = readCommerceSecretKeyring()
  const opened = openShippingEasySecret(connection, keyring)
  if (connection && !opened) console.error('shippingeasy: the stored API secret could not be opened', hostId)
  const url = new URL(request.url)
  // An unknown site is answered exactly like a wrong signature: an unproven
  // caller learns nothing about which sites are connected.
  const verdict = opened
    ? verifyShippingEasyCallback({ apiSecret: opened.apiSecret, method: request.method, path: url.pathname, query: url.searchParams, body, nowMs: now() })
    : 'bad_signature'
  if (verdict !== 'ok') {
    return text(401, verdict === 'expired' ? 'The callback is too old.' : `The signature does not match the API secret saved in ${PLATFORM_BRAND_NAME}.`)
  }
  if (opened?.reseal && keyring) {
    await ref
      .set(sealShippingEasySecret(hostId, opened.apiSecret, keyring), { merge: true })
      .catch((error: unknown) => console.warn('shippingeasy: secret not resealed', hostId, error))
  }

  const refused = await connectorSiteRefusal(request, hostId)
  if (refused) return refused

  const callback = readShippingEasyCallback(body)
  if ('problem' in callback) return text(400, callback.problem)
  await noteOnConnection(hostId, { lastCallbackAtMs: now() })
  if (!SHIPPINGEASY_SHIPPED_STATES.has(callback.workflowState)) {
    return text(200, `Nothing recorded for a ${callback.workflowState || 'shipment'} label.`)
  }
  const digest = digestSecret(body).slice(0, 32)
  const problems: string[] = []
  try {
    for (const notice of callback.notices) {
      const outcome = await recordShipNotice(hostId, notice, digest, { source: 'shippingeasy' })
      if (outcome.status !== 200) problems.push(outcome.body)
    }
  } catch (error) {
    console.error('shippingeasy: callback failed', hostId, error)
    return text(500, `${PLATFORM_BRAND_NAME} could not record the shipment. ShippingEasy will retry.`)
  }
  // A notice for an order this site does not have, or one already canceled,
  // will not record on a retry either: it is answered 200 so ShippingEasy
  // stops sending it, and the card says what happened.
  if (problems.length) {
    await noteOnConnection(hostId, { lastError: { message: problems.join(' ').slice(0, 300), atMs: now() } })
  }
  return text(200, problems.length ? problems.join(' ') : 'Recorded.')
}

/*==========================================
 * THE CONSOLE CARD
 *=========================================*/

/** What the card shows about a connection. Never a key in full, never the secret. */
export interface ShippingEasyConnectionStatus {
  /** Whether this deployment can seal a secret at all. */
  available: boolean
  connected: boolean
  apiKeyEnding?: string
  storeApiKeyEnding?: string
  createdAtMs?: number
  updatedAtMs?: number
  lastPushAtMs?: number
  lastCallbackAtMs?: number
  lastError?: { message: string; atMs: number; orderNumber?: string } | null
}

const ending = (key: string) => key.slice(-4)

export function shippingEasyStatusOf(connection: ShippingEasyConnection | null, available: boolean): ShippingEasyConnectionStatus {
  if (!connection) return { available, connected: false }
  return {
    available,
    connected: true,
    apiKeyEnding: ending(connection.apiKey),
    storeApiKeyEnding: ending(connection.storeApiKey),
    createdAtMs: connection.createdAtMs,
    ...(connection.updatedAtMs ? { updatedAtMs: connection.updatedAtMs } : {}),
    ...(connection.lastPushAtMs ? { lastPushAtMs: connection.lastPushAtMs } : {}),
    ...(connection.lastCallbackAtMs ? { lastCallbackAtMs: connection.lastCallbackAtMs } : {}),
    ...(connection.lastError ? { lastError: connection.lastError } : {}),
  }
}

/** The card's actions. `status` is the GET. */
export const SHIPPINGEASY_ACTIONS = ['status', 'connect', 'sync', 'disconnect'] as const
export type ShippingEasyAction = (typeof SHIPPINGEASY_ACTIONS)[number]

const ACTIVITY = { type: 'commerce:shippingEasy', id: 'shippingeasy', name: 'ShippingEasy' } as const

/**
 * One action of the ShippingEasy card, for a caller the connectors route has
 * already proven a site admin (or, for `status`, an editor) on a site with
 * commerce. Answers the status and body the route sends.
 *
 * - `connect` saves the three keys after one read proves them, sealing the
 *   secret; on a site already connected it replaces them (a merchant who
 *   made a new secret in ShippingEasy enters it here).
 * - `sync` pushes the open orders, a pass at a time.
 * - `disconnect` deletes the connection; the per-order records go with it,
 *   so a later connect sends the open orders afresh.
 */
export async function shippingEasyConnectorAction(
  input: {
    hostId: string
    action: ShippingEasyAction
    body: Record<string, unknown>
    actor: { uid: string; email: string | null }
    log: (action: string, target: typeof ACTIVITY) => Promise<void>
    prepareOpenOrders?: (hostId: string) => Promise<unknown>
  },
  deps: ShippingEasyDeps = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { hostId, action, body } = input
  const now = deps.now ?? Date.now
  const keyring = readCommerceSecretKeyring()
  const available = keyring !== null
  const ref = connectionRef(hostId)
  const read = async () => {
    const doc = await ref.get()
    return doc.exists ? (doc.data() as ShippingEasyConnection) : null
  }

  if (action === 'status') return { status: 200, body: { ...shippingEasyStatusOf(await read(), available) } }

  if (action === 'disconnect') {
    if (!(await read())) return { status: 200, body: { available, connected: false } }
    await firebaseAdmin.app().firestore().recursiveDelete(ref)
    await input.log('Disconnected ShippingEasy', ACTIVITY)
    return { status: 200, body: { available, connected: false } }
  }

  if (!keyring) return { status: 503, body: { error: 'ShippingEasy cannot be connected on this deployment yet' } }

  if (action === 'sync') {
    const connection = await read()
    if (!connection) return { status: 409, body: { error: 'ShippingEasy is not connected.' } }
    const result = await syncShippingEasyOrders(hostId, deps)
    await input.log('Sent open orders to ShippingEasy', ACTIVITY)
    return { status: 200, body: { ...shippingEasyStatusOf(await read(), available), sync: { ...result } } }
  }

  const keys = {
    apiKey: String(body['apiKey'] ?? '').trim(),
    apiSecret: String(body['apiSecret'] ?? '').trim(),
    storeApiKey: String(body['storeApiKey'] ?? '').trim(),
  }
  if (!SHIPPINGEASY_KEY.test(keys.apiKey) || !SHIPPINGEASY_KEY.test(keys.apiSecret) || !SHIPPINGEASY_KEY.test(keys.storeApiKey)) {
    return { status: 400, body: { error: 'Paste the API key, API secret and store API key exactly as ShippingEasy shows them.' } }
  }
  const check = await checkShippingEasyCredentials(keys, deps)
  if ('reason' in check) {
    return check.reason === 'refused'
      ? { status: 422, body: { error: `ShippingEasy did not accept these keys (${check.message}). Check all three and try again.` } }
      : { status: 502, body: { error: 'ShippingEasy could not be reached. Try again in a minute.' } }
  }
  const atMs = now()
  const existing = await read()
  const connection: ShippingEasyConnection = {
    ...(existing ?? { createdAtMs: atMs, createdBy: input.actor.uid }),
    hostId,
    apiKey: keys.apiKey,
    storeApiKey: keys.storeApiKey,
    ...sealShippingEasySecret(hostId, keys.apiSecret, keyring),
    ...(existing ? { updatedAtMs: atMs } : {}),
    lastError: null,
  }
  await ref.set(connection)
  if (!existing && input.prepareOpenOrders) {
    await input.prepareOpenOrders(hostId).catch((error: unknown) =>
      console.warn('shippingeasy: open orders not stamped', hostId, error),
    )
  }
  await input.log(existing ? 'Replaced the ShippingEasy keys' : 'Connected ShippingEasy', ACTIVITY)
  return { status: 200, body: { ...shippingEasyStatusOf(connection, available) } }
}
