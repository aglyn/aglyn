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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import {
  describeConfiguredUrlRefusal,
  configuredUrlRefusal,
  fetchConfiguredPublicUrl,
  firebaseAdmin,
  notifyHostManagers,
} from '@aglyn/tenant-data-admin'
import { PLUGIN_EVENT_MAX_ATTEMPTS } from '@aglyn/tenant-data-admin/server/plugin-event-outbox'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  createSecretBoxKey,
  openSecret,
  parseSecretBoxKeyring,
  sealSecret,
  SECRET_BOX_KEY_BYTES,
  type SecretBoxKey,
  type SecretBoxKeyring,
} from '@aglyn/shared-util-tools/secret-box'
import { createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { COMMERCE_EVENT_DECLARATIONS } from '../model/order-events'
import * as Webhooks from '../model/order-webhooks'

/**
 * Merchant order webhooks (AGL-3611): the console's door and the delivery
 * behind it. The model (`model/order-webhooks.ts`) says what is stored where.
 *
 * DELIVERY RIDES THE PLUGIN EVENT OUTBOX. Commerce subscribes to its own
 * order and return events under the name `webhooks`; the subscriber posts the
 * event to every endpoint that takes it and records each attempt in the
 * delivery log. An endpoint that already took an event is not posted it
 * again, so when one of three endpoints fails, the subscriber throws, the
 * outbox retries it with its backoff (30s, 2m, 10m, 30m, 1h, 6h, 12h), and
 * only the failing endpoint is called again. On the last attempt the delivery
 * is marked failed and the site's managers are told.
 *
 * EVERY CALL GOES THROUGH `fetchConfiguredPublicUrl`: https on the default
 * port, a public address pinned at connect time, no redirect followed. A
 * merchant's endpoint is a stranger's server to us.
 *
 * THE SECRET IS SEALED with the shared secret box, under the keyring
 * `readCommerceSecretKeyring` answers, bound to its endpoint by the seal's
 * context. The plaintext leaves the server once, in the answer to the request
 * that made or rolled it.
 */

export const COMMERCE_SECRET_KEY_ENV = 'COMMERCE_SECRET_KEY'

const SECRETS = 'orderWebhookSecrets'

/** Delivery rows live this long, then Firestore's TTL removes them. */
export const ORDER_WEBHOOK_LOG_RETENTION_MS = 30 * 86_400_000

type Firestore = FirebaseFirestore.Firestore

/** The id of the key derived from `TOKEN_SIGNING_SECRET`. */
export const DERIVED_COMMERCE_KEY_ID = 'tss1'

/**
 * A secret-box key derived from `TOKEN_SIGNING_SECRET` with HKDF, under its
 * own label, so the commerce tokens and the sealed secrets never share key
 * material. `null` when that secret is unset.
 */
function derivedCommerceKey(): SecretBoxKey | null {
  const base = String(process.env['TOKEN_SIGNING_SECRET'] ?? '')
  if (!base) return null
  const material = new Uint8Array(hkdfSync('sha256', base, 'aglyn-commerce', 'secret-box:v1', SECRET_BOX_KEY_BYTES))
  return createSecretBoxKey(material, DERIVED_COMMERCE_KEY_ID)
}

/**
 * The keyring commerce seals its stored secrets with. `COMMERCE_SECRET_KEY`
 * (a secret-box keyring) when it is set, its first key sealing; otherwise the
 * key derived from `TOKEN_SIGNING_SECRET`, which every deployment that sells
 * already has. The derived key stays in the ring after a dedicated key is
 * configured, so what it sealed still opens. `null` when neither is usable.
 * Never throws.
 */
export function readCommerceSecretKeyring(): SecretBoxKeyring | null {
  let derived: SecretBoxKey | null = null
  try {
    derived = derivedCommerceKey()
  } catch {
    derived = null
  }
  const raw = String(process.env[COMMERCE_SECRET_KEY_ENV] ?? '').trim()
  if (raw) {
    try {
      const ring = parseSecretBoxKeyring(raw)
      const keys = derived && !ring.keys.some((key) => key.id === derived!.id) ? [...ring.keys, derived] : ring.keys
      return { current: ring.current, keys }
    } catch {
      // An unusable dedicated key falls back to the derived one rather than
      // sealing nothing.
    }
  }
  return derived ? { current: derived, keys: [derived] } : null
}

/** Whether this deployment can sign webhooks at all. */
export function orderWebhooksConfigured(): boolean {
  return readCommerceSecretKeyring() !== null
}

const sealContext = (hostId: string, endpointId: string) => `hosts/${hostId}/${SECRETS}/${endpointId}#secret`

/** A fresh signing secret: `whsec_` and 32 random bytes. */
export function mintOrderWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`
}

/** The HMAC-SHA256 of `{t}.{body}` under the secret, as hex. */
export function signOrderWebhook(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(Webhooks.orderWebhookSignedPayload(timestampSeconds, body)).digest('hex')
}

const hostRefFor = (firestore: Firestore, hostId: string) => firestore.collection('hosts').doc(hostId)

async function readSecret(
  firestore: Firestore,
  hostId: string,
  endpointId: string,
  keyring: SecretBoxKeyring,
): Promise<string> {
  const hostRef = hostRefFor(firestore, hostId)
  const snapshot = await hostRef.collection('orderWebhookSecrets').doc(endpointId).get()
  const sealed = String(snapshot.get('sealedSecret') ?? '')
  if (!sealed) throw new Error('This endpoint has no signing secret')
  return openSecret(sealed, keyring, { context: sealContext(hostId, endpointId) }).plaintext
}

function sealedSecretRecord(
  hostId: string,
  endpointId: string,
  secret: string,
  keyring: SecretBoxKeyring,
  now: number,
): Webhooks.OrderWebhookSecretRecord {
  return {
    sealedSecret: sealSecret(secret, keyring.current, { context: sealContext(hostId, endpointId) }),
    secretKeyId: keyring.current.id,
    updatedAtMs: now,
  }
}

/** What one POST came to. */
export interface OrderWebhookPostResult {
  attempt: Webhooks.OrderWebhookAttempt
  delivered: boolean
}

/**
 * Posts one body to one endpoint, signed. Never throws: a refusal, a timeout
 * or a reset is an attempt that failed, with the reason in words.
 */
export async function postOrderWebhook(input: {
  url: string
  secret: string
  event: string
  eventId: string
  body: string
  now?: () => number
  fetchImpl?: typeof fetchConfiguredPublicUrl
}): Promise<OrderWebhookPostResult> {
  const clock = input.now ?? Date.now
  const startedAt = clock()
  const timestamp = Math.floor(startedAt / 1000)
  const signature = Webhooks.formatOrderWebhookSignature(timestamp, signOrderWebhook(input.secret, timestamp, input.body))
  let httpStatus: number | null = null
  let error: string | undefined
  try {
    const result = await (input.fetchImpl ?? fetchConfiguredPublicUrl)(input.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Aglyn-Webhooks/1.0',
        [Webhooks.ORDER_WEBHOOK_SIGNATURE_HEADER]: signature,
        [Webhooks.ORDER_WEBHOOK_EVENT_HEADER]: input.event,
        [Webhooks.ORDER_WEBHOOK_EVENT_ID_HEADER]: input.eventId,
      },
      body: input.body,
      signal: AbortSignal.timeout(Webhooks.ORDER_WEBHOOK_TIMEOUT_MS),
    })
    if ('refusal' in result) {
      error = `Not sent: ${describeConfiguredUrlRefusal(result.refusal)}`
    } else {
      httpStatus = result.status
      if (!Webhooks.orderWebhookAccepted(httpStatus)) {
        error =
          httpStatus >= 300 && httpStatus < 400
            ? `The endpoint answered ${httpStatus}, a redirect; redirects are not followed`
            : `The endpoint answered ${httpStatus}`
      }
    }
  } catch (caught) {
    const name = (caught as Error)?.name
    error =
      name === 'TimeoutError' || name === 'AbortError'
        ? `No answer within ${Webhooks.ORDER_WEBHOOK_TIMEOUT_MS / 1000} seconds`
        : `The connection failed: ${String((caught as Error)?.message ?? caught).slice(0, 200)}`
  }
  const attempt: Webhooks.OrderWebhookAttempt = {
    atMs: startedAt,
    httpStatus,
    ...(error ? { error } : {}),
    durationMs: Math.max(0, clock() - startedAt),
  }
  return { attempt, delivered: !error }
}

function expiresAt(now: number) {
  return firebaseAdmin.firestore.Timestamp.fromMillis(now + ORDER_WEBHOOK_LOG_RETENTION_MS)
}

/** Records an attempt on the delivery row and on the endpoint's summary. */
async function recordAttempt(
  firestore: Firestore,
  hostId: string,
  endpointId: string,
  delivery: {
    id: string
    eventId: string
    event: string
    orderId: string | null
    body: string
    test?: boolean
    prior: Webhooks.OrderWebhookDelivery | null
  },
  result: OrderWebhookPostResult,
  status: Webhooks.OrderWebhookDeliveryStatus,
  now: number,
): Promise<void> {
  const hostRef = hostRefFor(firestore, hostId)
  const row: Webhooks.OrderWebhookDelivery & { expiresAt: unknown } = {
    endpointId,
    eventId: delivery.eventId,
    event: delivery.event,
    orderId: delivery.orderId,
    status,
    attempts: Webhooks.appendOrderWebhookAttempt(delivery.prior?.attempts, result.attempt),
    body: delivery.body.slice(0, Webhooks.ORDER_WEBHOOK_BODY_MAX),
    ...(delivery.test ? { test: true } : {}),
    createdAtMs: delivery.prior?.createdAtMs ?? now,
    updatedAtMs: now,
    expiresAt: expiresAt(now),
  }
  await hostRef.collection('orderWebhookDeliveries').doc(delivery.id).set(row)
  await hostRef
    .collection('orderWebhooks')
    .doc(endpointId)
    .update({
      lastDeliveryAtMs: now,
      lastDeliveryStatus: status,
      consecutiveFailures: result.delivered ? 0 : firebaseAdmin.firestore.FieldValue.increment(1),
    })
    .catch(() => undefined)
}

/**
 * The subscriber: posts one event to every endpoint of the site that takes
 * it and has not taken it already. Throws when any endpoint still owes it, so
 * the outbox retries; on the outbox's last attempt it records the failure and
 * tells the site's managers instead.
 */
export async function deliverOrderEventToWebhooks(
  envelope: PluginDomainEventEnvelope,
  deps: { fetchImpl?: typeof fetchConfiguredPublicUrl; now?: () => number } = {},
): Promise<{ delivered: number; failed: number }> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = hostRefFor(firestore, envelope.hostId)
  const endpoints = await hostRef.collection('orderWebhooks').where('enabled', '==', true).get()
  const taking = endpoints.docs.filter((doc) =>
    Webhooks.orderWebhookTakes(doc.data() as Webhooks.OrderWebhookEndpoint, envelope.event, envelope.occurredAtMs),
  )
  if (taking.length === 0) return { delivered: 0, failed: 0 }
  const keyring = readCommerceSecretKeyring()
  const clock = deps.now ?? Date.now
  const final = envelope.attempt >= PLUGIN_EVENT_MAX_ATTEMPTS
  const body = Webhooks.orderWebhookBody({
    eventId: envelope.id,
    event: envelope.event,
    occurredAtMs: envelope.occurredAtMs,
    hostId: envelope.hostId,
    payload: envelope.payload,
  })
  const orderId = String(((envelope.payload ?? {}) as { order?: { id?: unknown } }).order?.id ?? '') || null
  const outcomes = await Promise.all(
    taking.map(async (doc) => {
      const endpoint = doc.data() as Webhooks.OrderWebhookEndpoint
      const deliveryId = Webhooks.orderWebhookDeliveryId(envelope.id, doc.id)
      const priorSnapshot = await hostRef.collection('orderWebhookDeliveries').doc(deliveryId).get()
      const prior = priorSnapshot.exists ? (priorSnapshot.data() as Webhooks.OrderWebhookDelivery) : null
      // Taken already, on an earlier pass or by a resend from the console.
      if (prior?.status === 'delivered') return 'delivered' as const
      const settled = await attemptEndpoint({
        firestore,
        hostId: envelope.hostId,
        endpointId: doc.id,
        url: endpoint.url,
        keyring,
        event: envelope.event,
        eventId: envelope.id,
        body,
        clock,
        fetchImpl: deps.fetchImpl,
      })
      const status: Webhooks.OrderWebhookDeliveryStatus = settled.delivered ? 'delivered' : final ? 'failed' : 'retrying'
      await recordAttempt(
        firestore,
        envelope.hostId,
        doc.id,
        { id: deliveryId, eventId: envelope.id, event: envelope.event, orderId, body, prior },
        settled,
        status,
        clock(),
      )
      if (status === 'failed') {
        await notifyHostManagers(envelope.hostId, {
          type: 'content.order',
          title: 'An order webhook could not be delivered',
          body:
            `${envelope.event} never reached ${safeHost(endpoint.url)} on {site} after ` +
            `${envelope.attempt} attempts (${settled.attempt.error ?? 'no answer'}). ` +
            'Resend it from the delivery log once the endpoint is fixed.',
          link: `/${envelope.hostId}/products/settings`,
        }).catch(() => undefined)
      }
      return status
    }),
  )
  const delivered = outcomes.filter((status) => status === 'delivered').length
  const failed = outcomes.length - delivered
  if (failed > 0 && !final) {
    throw new Error(`${failed} of ${outcomes.length} order webhook endpoints did not take ${envelope.event}`)
  }
  return { delivered, failed }
}

/** One signed attempt at one endpoint; a missing key or secret is a failed attempt. */
async function attemptEndpoint(input: {
  firestore: Firestore
  hostId: string
  endpointId: string
  url: string
  keyring: SecretBoxKeyring | null
  event: string
  eventId: string
  body: string
  clock: () => number
  fetchImpl?: typeof fetchConfiguredPublicUrl
}): Promise<OrderWebhookPostResult> {
  const failed = (error: string): OrderWebhookPostResult => ({
    delivered: false,
    attempt: { atMs: input.clock(), httpStatus: null, error, durationMs: 0 },
  })
  if (!input.keyring) return failed('Webhook signing is not configured')
  let secret: string
  try {
    secret = await readSecret(input.firestore, input.hostId, input.endpointId, input.keyring)
  } catch (error) {
    return failed(`The signing secret could not be read: ${String((error as Error)?.message ?? error).slice(0, 120)}`)
  }
  return postOrderWebhook({
    url: input.url,
    secret,
    event: input.event,
    eventId: input.eventId,
    body: input.body,
    fetchImpl: input.fetchImpl,
    now: input.clock,
  })
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'the endpoint'
  }
}

// ---------------------------------------------------------------------------
// The console's door
// ---------------------------------------------------------------------------

const ACTIONS = ['status', 'create', 'update', 'roll-secret', 'delete', 'test', 'resend'] as const
type Action = (typeof ACTIONS)[number]

const isId = (value: string) => Boolean(value) && value.length <= 1500 && !/^__.*__$/.test(value) && !value.includes('/')

function cleanUrl(raw: unknown): { url: string } | { error: string } {
  const url = String(raw ?? '').trim()
  if (!url) return { error: 'Enter the endpoint’s address' }
  if (url.length > 2048) return { error: 'That address is too long' }
  const refusal = configuredUrlRefusal(url)
  if (refusal) return { error: `This endpoint cannot be used: ${describeConfiguredUrlRefusal(refusal)}` }
  return { url }
}

const cleanDescription = (raw: unknown) => String(raw ?? '').trim().slice(0, 120)

/**
 * `POST /api/commerce/order-webhooks` with `{ hostId, action, … }`. Endpoints
 * post the order book to an outside server, so only an admin of the whole
 * workspace manages them — the bar a refund sets.
 *
 *  - `status` → `{ configured, events: [{ event, label, description }] }`
 *  - `create` `{ url, events, description? }` → `{ id, secret }` (shown once)
 *  - `update` `{ endpointId, url?, events?, enabled?, description? }`
 *  - `roll-secret` `{ endpointId }` → `{ secret }`
 *  - `delete` `{ endpointId }`; the delivery log stays until it expires
 *  - `test` `{ endpointId }` → posts a `webhook.test` event now
 *  - `resend` `{ deliveryId }` → posts a logged delivery again now
 */
export const orderWebhooksHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  let body: Record<string, any>
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {}
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }
  const hostId = String(body.hostId ?? '')
  const action = String(body.action ?? '') as Action
  if (!isId(hostId)) return res.status(400).json({ error: 'Missing hostId' })
  if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'Unknown action' })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = hostRefFor(firestore, hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) return res.status(404).json({ error: 'Unknown site' })
    if ((hostSnapshot.get('memberRoles') ?? {})[decoded.uid] !== 'admin') {
      return res.status(403).json({ error: 'Webhooks are managed by a site admin' })
    }
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.orgWide || membership.hostRole !== 'admin') {
      return res.status(403).json({ error: 'Webhooks are managed by an admin of the whole workspace' })
    }
    const keyring = readCommerceSecretKeyring()
    if (action === 'status') {
      return res.status(200).json({
        configured: Boolean(keyring),
        maxEndpoints: Webhooks.ORDER_WEBHOOK_MAX_ENDPOINTS,
        events: COMMERCE_EVENT_DECLARATIONS.map((entry) => ({
          event: entry.event.id,
          label: entry.label,
          description: entry.description,
        })),
      })
    }
    if (!keyring) {
      return res.status(503).json({ error: 'Order webhooks are not configured on this deployment' })
    }
    const now = Date.now()
    const endpoints = hostRef.collection('orderWebhooks')

    if (action === 'create') {
      const url = cleanUrl(body.url)
      if ('error' in url) return res.status(400).json({ error: url.error })
      const events = Webhooks.normalizeOrderWebhookEvents(body.events)
      if (events.length === 0) return res.status(400).json({ error: 'Choose at least one event' })
      const secret = mintOrderWebhookSecret()
      const ref = endpoints.doc(createResourceUid())
      const created = await firestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(endpoints.limit(Webhooks.ORDER_WEBHOOK_MAX_ENDPOINTS))
        if (existing.size >= Webhooks.ORDER_WEBHOOK_MAX_ENDPOINTS) return false
        const endpoint: Webhooks.OrderWebhookEndpoint = {
          url: url.url,
          events,
          enabled: true,
          ...(cleanDescription(body.description) ? { description: cleanDescription(body.description) } : {}),
          secretHint: secret.slice(-4),
          consecutiveFailures: 0,
          createdAtMs: now,
          updatedAtMs: now,
          createdBy: decoded.uid,
        }
        transaction.create(ref, endpoint)
        transaction.create(hostRef.collection('orderWebhookSecrets').doc(ref.id), sealedSecretRecord(hostId, ref.id, secret, keyring, now))
        return true
      })
      if (!created) {
        return res.status(409).json({ error: `A store can keep ${Webhooks.ORDER_WEBHOOK_MAX_ENDPOINTS} webhook endpoints` })
      }
      return res.status(200).json({ ok: true, id: ref.id, secret })
    }

    if (action === 'resend') {
      const deliveryId = String(body.deliveryId ?? '')
      if (!isId(deliveryId)) return res.status(400).json({ error: 'Missing deliveryId' })
      const deliveryRef = hostRef.collection('orderWebhookDeliveries').doc(deliveryId)
      const deliverySnapshot = await deliveryRef.get()
      if (!deliverySnapshot.exists) return res.status(404).json({ error: 'Unknown delivery' })
      const delivery = deliverySnapshot.data() as Webhooks.OrderWebhookDelivery
      const endpointSnapshot = await endpoints.doc(delivery.endpointId).get()
      if (!endpointSnapshot.exists) return res.status(404).json({ error: 'That endpoint was deleted' })
      if (delivery.body.length >= Webhooks.ORDER_WEBHOOK_BODY_MAX) {
        return res.status(409).json({ error: 'This delivery was too large to keep, so it cannot be resent' })
      }
      const endpoint = endpointSnapshot.data() as Webhooks.OrderWebhookEndpoint
      const secret = await readSecret(firestore, hostId, delivery.endpointId, keyring)
      const result = await postOrderWebhook({ url: endpoint.url, secret, event: delivery.event, eventId: delivery.eventId, body: delivery.body })
      const status: Webhooks.OrderWebhookDeliveryStatus = result.delivered
        ? 'delivered'
        : delivery.status === 'delivered'
          ? 'delivered'
          : delivery.status
      await recordAttempt(
        firestore,
        hostId,
        delivery.endpointId,
        { id: deliveryId, eventId: delivery.eventId, event: delivery.event, orderId: delivery.orderId, body: delivery.body, test: delivery.test, prior: delivery },
        result,
        status,
        Date.now(),
      )
      return res.status(200).json({ ok: true, delivered: result.delivered, attempt: result.attempt })
    }

    const endpointId = String(body.endpointId ?? '')
    if (!isId(endpointId)) return res.status(400).json({ error: 'Missing endpointId' })
    const endpointRef = endpoints.doc(endpointId)
    const endpointSnapshot = await endpointRef.get()
    if (!endpointSnapshot.exists) return res.status(404).json({ error: 'Unknown endpoint' })
    const endpoint = endpointSnapshot.data() as Webhooks.OrderWebhookEndpoint

    if (action === 'update') {
      const patch: Partial<Webhooks.OrderWebhookEndpoint> = { updatedAtMs: now }
      if (body.url !== undefined) {
        const url = cleanUrl(body.url)
        if ('error' in url) return res.status(400).json({ error: url.error })
        patch.url = url.url
      }
      if (body.events !== undefined) {
        const events = Webhooks.normalizeOrderWebhookEvents(body.events)
        if (events.length === 0) return res.status(400).json({ error: 'Choose at least one event' })
        patch.events = events
      }
      if (body.enabled !== undefined) {
        patch.enabled = Boolean(body.enabled)
        if (patch.enabled) patch.consecutiveFailures = 0
      }
      if (body.description !== undefined) patch.description = cleanDescription(body.description)
      await endpointRef.update(patch)
      return res.status(200).json({ ok: true })
    }

    if (action === 'roll-secret') {
      const secret = mintOrderWebhookSecret()
      const batch = firestore.batch()
      batch.set(hostRef.collection('orderWebhookSecrets').doc(endpointId), sealedSecretRecord(hostId, endpointId, secret, keyring, now))
      batch.update(endpointRef, { secretHint: secret.slice(-4), updatedAtMs: now })
      await batch.commit()
      return res.status(200).json({ ok: true, secret })
    }

    if (action === 'delete') {
      const batch = firestore.batch()
      batch.delete(endpointRef)
      batch.delete(hostRef.collection('orderWebhookSecrets').doc(endpointId))
      await batch.commit()
      return res.status(200).json({ ok: true })
    }

    // test
    const eventId = `test_${randomBytes(9).toString('base64url')}`
    const testBody = Webhooks.orderWebhookBody({
      eventId,
      event: Webhooks.ORDER_WEBHOOK_TEST_EVENT,
      occurredAtMs: now,
      hostId,
      payload: { message: `A test event from ${PLATFORM_BRAND_NAME}. Answer with any 2xx status.` },
    })
    const secret = await readSecret(firestore, hostId, endpointId, keyring)
    const result = await postOrderWebhook({ url: endpoint.url, secret, event: Webhooks.ORDER_WEBHOOK_TEST_EVENT, eventId, body: testBody })
    await recordAttempt(
      firestore,
      hostId,
      endpointId,
      { id: Webhooks.orderWebhookDeliveryId(eventId, endpointId), eventId, event: Webhooks.ORDER_WEBHOOK_TEST_EVENT, orderId: null, body: testBody, test: true, prior: null },
      result,
      result.delivered ? 'delivered' : 'failed',
      Date.now(),
    )
    return res.status(200).json({ ok: true, delivered: result.delivered, attempt: result.attempt })
  } catch (error) {
    console.error('order webhooks action failed', action, error)
    return res.status(500).json({ error: 'The webhook could not be updated. Please try again.' })
  }
}
