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

import { normalizePhone } from '@aglyn/aglyn/foundation/definitions/contact.types'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { COURIERS_API_ROUTES } from '../constants'
import {
  COURIER_PROVIDER_IDS,
  COURIER_PROVIDERS,
  isCourierProviderId,
  type CourierConnectionView,
  type CourierKeyMode,
  type CourierKeysView,
  type CourierProviderId,
} from '../model/couriers'
import type { CourierKeys, CourierProvider } from '../providers/provider'
import { CourierRefusal, orderIdOfRef, orderView, type CourierEngine } from './engine'
import { connectionId, type CourierStore, type StoredConnection, type StoredKeys } from './store'

/**
 * The couriers console API (AGL-3695). Every member route climbs
 * {@link CourierRouteDeps.gate} first — a signed-in, verified member of the
 * site at the route's role, the site selling with couriers on, the
 * deployment holding the sealing key — and then answers:
 *
 *   admin   connect · test · settings · webhook-token · disconnect
 *   editor  connection · order · quote · dispatch · cancel · refresh
 *
 * Editors work orders, as the Pickup & delivery queue does; only an admin
 * handles the keys. DoorDash's webhook is a machine route: it carries no
 * member token, and is verified by the Authorization value the merchant
 * entered in their DoorDash portal, whose hash the connection holds.
 *
 * No answer ever carries a key, a secret or a token's hash — except the
 * webhook token itself, ONCE, in the answer that minted it.
 */

export type CourierRole = 'editor' | 'admin'

export interface CourierGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface CourierRouteDeps {
  now(): number
  store: CourierStore
  engine: CourierEngine
  provider(id: CourierProviderId): CourierProvider
  /** Whether the deployment holds the sealing key. */
  configured(): boolean
  gate(request: Request, role: CourierRole): Promise<CourierGateResult | Response>
  /** The console address of a path, or `null` when the deployment has none. */
  consoleAddress(path: string, requestUrl: string): string | null
  /** Records a step on the workspace's activity log. Must not throw. */
  logActivity(input: {
    orgId: string
    uid: string
    action: 'connected' | 'disconnected' | 'dispatched' | 'cancelled'
    provider: CourierProviderId
    hostId: string
    orderId?: string
  }): Promise<void>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

const ORDER_ID = /^[A-Za-z0-9_-]{1,200}$/
const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/
/** DoorDash's developer and key ids are UUIDs; anything printable and short is let through to its test. */
const KEY_ID = /^[A-Za-z0-9_-]{4,120}$/
const SIGNING_SECRET = /^[A-Za-z0-9_+/=-]{16,400}$/

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/** A fresh webhook token and its hash. */
export function newWebhookToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url')
  return { token, hash: sha256(token) }
}

/** Whether a presented Authorization matches the stored hash: the whole value, or the value after its scheme. */
export function webhookAuthorized(presented: string, hash: string | null): boolean {
  if (!hash || !presented) return false
  const candidates = [presented.trim(), presented.trim().replace(/^(?:Basic|Bearer)\s+/i, '')]
  return candidates.some((candidate) => {
    const a = Buffer.from(sha256(candidate))
    const b = Buffer.from(hash)
    return candidate.length > 0 && a.length === b.length && timingSafeEqual(a, b)
  })
}

function readProvider(body: Record<string, unknown>, request: Request): CourierProviderId | null {
  const raw = body['provider'] ?? new URL(request.url).searchParams.get('provider') ?? COURIER_PROVIDER_IDS[0]
  return isCourierProviderId(raw) ? raw : null
}

function readOrderId(body: Record<string, unknown>, request: Request): string | null {
  const raw = String(body['orderId'] ?? new URL(request.url).searchParams.get('orderId') ?? '')
  return ORDER_ID.test(raw) && !/^__.*__$/.test(raw) ? raw : null
}

/** One mode's keys from a body, `null` when that mode was left blank, or a refusal. */
function readKeys(raw: unknown, mode: CourierKeyMode): CourierKeys | null | string {
  const record = (raw ?? null) as Record<string, unknown> | null
  if (!record) return null
  const developerId = String(record['developerId'] ?? '').trim()
  const keyId = String(record['keyId'] ?? '').trim()
  const signingSecret = String(record['signingSecret'] ?? '').trim()
  if (!developerId && !keyId && !signingSecret) return null
  if (!KEY_ID.test(developerId) || !KEY_ID.test(keyId) || !SIGNING_SECRET.test(signingSecret)) {
    return `Enter the developer id, key id and signing secret of your ${mode} key exactly as the portal shows them.`
  }
  return { developerId, keyId, signingSecret }
}

function keysView(keys: StoredKeys | null): CourierKeysView {
  return {
    configured: Boolean(keys),
    developerId: keys?.developerId ?? null,
    keyId: keys?.keyId ?? null,
    lastTestOk: keys?.lastTestOk ?? false,
    lastTestAtMs: keys?.lastTestAtMs ?? null,
    lastError: keys?.lastError ?? null,
  }
}

export function createCourierRoutes(deps: CourierRouteDeps) {
  const webhookUrl = (requestUrl: string, hostId: string): string | null =>
    deps.consoleAddress(
      `/api/${COURIERS_API_ROUTES.webhookDoordash}?${new URLSearchParams({ site: hostId }).toString()}`,
      requestUrl,
    )

  const connectionView = (connection: StoredConnection, requestUrl: string): CourierConnectionView => ({
    provider: connection.provider,
    providerLabel: COURIER_PROVIDERS[connection.provider].label,
    live: keysView(connection.live),
    test: keysView(connection.test),
    pickupPhone: connection.pickupPhone,
    pickupNote: connection.pickupNote,
    webhookUrl: webhookUrl(requestUrl, connection.hostId),
    webhookTokenSet: Boolean(connection.webhookTokenHash),
    updatedAtMs: connection.updatedAtMs,
  })

  /** Runs a gated handler, turning a refusal into its answer and anything else into a 500. */
  const guarded =
    (role: CourierRole, method: 'GET' | 'POST', handle: (gate: CourierGateResult, request: Request) => Promise<Response>) =>
    async (request: Request): Promise<Response> => {
      if (request.method !== method) return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, role)
      if (gate instanceof Response) return gate
      try {
        return await handle(gate, request)
      } catch (error) {
        if (error instanceof CourierRefusal) return fail(error.status, error.message)
        console.error('[couriers] route failed', new URL(request.url).pathname, error)
        return fail(500, 'Something went wrong. Try again.')
      }
    }

  const withOrder =
    (role: CourierRole, handle: (gate: CourierGateResult, orderId: string, request: Request) => Promise<Response>, method: 'GET' | 'POST' = 'POST') =>
    guarded(role, method, async (gate, request) => {
      const orderId = readOrderId(gate.body, request)
      if (!orderId) return fail(400, 'Missing orderId')
      return handle(gate, orderId, request)
    })

  return {
    /** GET ?hostId — what the deployment offers and the site's connection. */
    list: guarded('editor', 'GET', async (gate, request) => {
      const connection = await deps.store.getConnection(gate.hostId, 'doordash')
      return json({
        available: true,
        providers: COURIER_PROVIDER_IDS.map((id) => ({ id, ...COURIER_PROVIDERS[id] })),
        connection: connection ? connectionView(connection, request.url) : null,
      })
    }),

    connect: guarded('admin', 'POST', async (gate, request) => {
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Unknown courier')
      const keys: Partial<Record<CourierKeyMode, CourierKeys>> = {}
      for (const mode of ['live', 'test'] as const) {
        const read = readKeys(gate.body[mode], mode)
        if (typeof read === 'string') return fail(400, read)
        if (read) keys[mode] = read
      }
      const { connection, webhookToken } = await deps.engine.connect({
        orgId: gate.orgId,
        hostId: gate.hostId,
        uid: gate.uid,
        provider,
        keys,
        newWebhookToken,
      })
      await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'connected', provider, hostId: gate.hostId })
      return json({ connection: connectionView(connection, request.url), webhookToken })
    }),

    test: guarded('admin', 'POST', async (gate, request) => {
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Unknown courier')
      const connection = await deps.engine.test(gate.hostId, provider)
      return json({ connection: connectionView(connection, request.url) })
    }),

    settings: guarded('admin', 'POST', async (gate, request) => {
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Unknown courier')
      const connection = await deps.store.getConnection(gate.hostId, provider)
      if (!connection) return fail(409, `Connect your ${COURIER_PROVIDERS[provider].label} account first.`)
      const phoneRaw = String(gate.body['pickupPhone'] ?? '').trim()
      const pickupPhone = phoneRaw ? normalizePhone(phoneRaw) : null
      if (phoneRaw && !pickupPhone) return fail(400, 'Enter the store’s phone number with its area code.')
      const pickupNote = String(gate.body['pickupNote'] ?? '').trim().slice(0, 280) || null
      const patch = { pickupPhone, pickupNote, updatedAtMs: deps.now() }
      await deps.store.patchConnection(connection.id, patch)
      return json({ connection: connectionView({ ...connection, ...patch }, request.url) })
    }),

    webhookToken: guarded('admin', 'POST', async (gate, request) => {
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Unknown courier')
      const connection = await deps.store.getConnection(gate.hostId, provider)
      if (!connection) return fail(409, `Connect your ${COURIER_PROVIDERS[provider].label} account first.`)
      const minted = newWebhookToken()
      const patch = { webhookTokenHash: minted.hash, updatedAtMs: deps.now() }
      await deps.store.patchConnection(connection.id, patch)
      return json({ connection: connectionView({ ...connection, ...patch }, request.url), webhookToken: minted.token })
    }),

    disconnect: guarded('admin', 'POST', async (gate, request) => {
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Unknown courier')
      if (await deps.store.hasOpenRun(gate.hostId)) {
        return fail(409, 'A courier is still on one of your orders. Wait for it to finish, or cancel it first.')
      }
      await deps.store.deleteConnection(connectionId(gate.hostId, provider))
      await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'disconnected', provider, hostId: gate.hostId })
      return json({ connection: null })
    }),

    order: withOrder(
      'editor',
      async (gate, orderId) => json(orderView(orderId, await deps.store.getDelivery(gate.hostId, orderId))),
      'GET',
    ),

    quote: withOrder('editor', async (gate, orderId, request) => {
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Unknown courier')
      return json(await deps.engine.quote({ orgId: gate.orgId, hostId: gate.hostId, orderId, uid: gate.uid, provider }))
    }),

    dispatch: withOrder('editor', async (gate, orderId) => {
      const view = await deps.engine.dispatch({
        hostId: gate.hostId,
        orderId,
        uid: gate.uid,
        idempotencyKey: String(gate.body['idempotencyKey'] ?? ''),
      })
      if (view.run) {
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'dispatched', provider: view.run.provider, hostId: gate.hostId, orderId })
      }
      return json(view)
    }),

    cancel: withOrder('editor', async (gate, orderId) => {
      const view = await deps.engine.cancel({ hostId: gate.hostId, orderId, reason: 'Canceled by the store', byStore: true })
      if (view.run) {
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'cancelled', provider: view.run.provider, hostId: gate.hostId, orderId })
      }
      return json(view)
    }),

    refresh: withOrder('editor', async (gate, orderId) => json(await deps.engine.refresh(gate.hostId, orderId))),

    /** POST ?site — DoorDash Drive's webhook. Acknowledged once verified, whatever it names. */
    async webhookDoordash(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      if (!deps.configured()) return fail(404, 'Not found')
      const hostId = String(new URL(request.url).searchParams.get('site') ?? '')
      if (!HOST_ID.test(hostId)) return fail(401, 'Not a webhook this deployment registered')
      const connection = await deps.store.getConnection(hostId, 'doordash')
      if (!connection || !webhookAuthorized(request.headers.get('authorization') ?? '', connection.webhookTokenHash)) {
        return fail(401, 'Not a webhook this deployment registered')
      }
      const body = await request.json().catch(() => null)
      const event = deps.provider('doordash').parseWebhook(body)
      const orderId = event ? orderIdOfRef(event.deliveryRef) : null
      if (!event || !orderId) return json({ ok: true, result: 'ignored' })
      try {
        const result = await deps.engine.applySnapshot(hostId, orderId, event, { eventKey: event.eventKey, pendingResolved: true })
        return json({ ok: true, result })
      } catch (error) {
        // Not acknowledged, so DoorDash sends it again; the event key makes the retry safe.
        console.error('[couriers] webhook not applied', hostId, orderId, error)
        return fail(500, 'Not applied')
      }
    },
  }
}

export type CourierRoutes = ReturnType<typeof createCourierRoutes>
