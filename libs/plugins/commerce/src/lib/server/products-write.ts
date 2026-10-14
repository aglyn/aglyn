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

import { createHash } from 'node:crypto'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getLockdownVerdict, getOrgForHost, isImpersonationSession } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  type EditedProduct,
  productCollectionIds,
  productEditWrite,
  productMembershipInput,
  productSaveFields,
  smartCollectionRulesOf,
  stockAdjustmentWrite,
  validateProduct,
  type InventoryAdjustmentReason,
} from '../model'
import { planRefusal, roomRefusal } from './product-drafts'

/*
 * `POST /api/commerce/products/save` and `POST /api/commerce/products/stock`
 * (AGL-3652): the console product editor's save and its Adjust stock dialog,
 * for the native apps.
 *
 * The console makes both writes from the browser, computing derived fields
 * first (search keys, stock verdict, price, image, smart-collection
 * membership). These routes run THAT computation (`model/product-write.ts`,
 * which the console imports too) and make the same writes, under the gate
 * the Firestore rules put on them: a verified member with a write role on the
 * site (`canWriteHostContent`), or staff, while the site, its org and the
 * platform are not frozen (`hostWritesFrozen`). A new product also meets the
 * create path's own door: the plan's `commerce` entitlement and its
 * `productsPerHost` quota, counted in the same transaction as the create.
 */

type Firestore = FirebaseFirestore.Firestore

export const ROLE_REFUSAL = 'Editing requires the editor role'
const MAX_BODY_BYTES = 256_000

/** The reasons the Adjust stock dialog offers. */
export const STOCK_ADJUST_REASONS: readonly InventoryAdjustmentReason[] = ['restock', 'correction', 'damage', 'refund']

export interface ProductsWriteDeps {
  firestore?: () => Firestore
  verifyIdToken?: (token: string) => Promise<Record<string, unknown> & { uid: string }>
  orgForHost?: (hostId: string) => Promise<{ org: Record<string, unknown> } | null>
  lockdown?: (options: Parameters<typeof getLockdownVerdict>[0]) => Promise<unknown>
  dropCache?: typeof dropPluginSiteCache
  now?: () => number
}

type Reply = Parameters<PluginApiHandler>[1]

export function bodyOf(req: Parameters<PluginApiHandler>[0]): Record<string, unknown> {
  const raw = req.body
  if (typeof raw === 'string') {
    if (raw.length > MAX_BODY_BYTES) return {}
    try {
      return JSON.parse(raw || '{}')
    } catch {
      return {}
    }
  }
  return (raw ?? {}) as Record<string, unknown>
}

export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

export interface Gate {
  uid: string
  staff: boolean
  host: FirebaseFirestore.DocumentSnapshot
  org: Record<string, unknown>
}

/**
 * Who may write this site's products, as the rules decide it. Answers the
 * caller's reply on a refusal and returns null.
 */
export async function gate(req: Parameters<PluginApiHandler>[0], res: Reply, hostId: string, deps: Required<ProductsWriteDeps>): Promise<Gate | null> {
  const authorization = String(req.headers.authorization ?? '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!token) return void res.status(401).json({ error: 'Unauthenticated' }), null
  let decoded: Record<string, unknown> & { uid: string }
  try {
    decoded = await deps.verifyIdToken(token)
  } catch (error) {
    // Only a refused token is the caller's; an Auth outage is a 500 (AGL-2852).
    if (!isRefusedIdToken(error)) throw error
    return void res.status(401).json({ error: 'Sign in again to continue' }), null
  }
  const staff = decoded['staff'] === true
  if (!staff && decoded['email_verified'] !== true && !isImpersonationSession(decoded as never)) {
    return void res.status(403).json({ error: 'Verify your email address to make changes' }), null
  }
  const host = await deps.firestore().collection('hosts').doc(hostId).get()
  if (!host.exists) return void res.status(404).json({ error: 'Unknown site' }), null
  if (!staff && !hostRoleCanWrite((host.get('memberRoles') ?? {})[decoded.uid])) {
    return void res.status(403).json({ error: ROLE_REFUSAL }), null
  }
  const org = ((await deps.orgForHost(hostId))?.org ?? {}) as Record<string, unknown>
  const locked = await deps.lockdown({ staff, uid: decoded.uid, org: org as never, host: host.data() as never, request: { method: 'POST' } as never })
  if (locked) return void res.status(423).json({ error: 'This site is not accepting changes right now' }), null
  return { uid: decoded.uid, staff, host, org }
}

/** The site-wide cache drop a product change is owed (AGL-3386): an outbox entry in the write, then the drop. */
export function outboxEntry(firestore: Firestore, hostId: string) {
  return {
    ref: firestore.collection('publishOutbox').doc(createResourceUid()),
    data: { hostId, paths: ['/'], createdAt: FieldValue.serverTimestamp(), attempts: 0, entireHost: true },
  }
}

export async function settleCache(deps: Required<ProductsWriteDeps>, hostId: string, entry: FirebaseFirestore.DocumentReference, reason: string) {
  const dropped = await deps.dropCache({ hostIds: [hostId], reason }).catch(() => ({ complete: false }))
  if (dropped.complete) await entry.delete().catch(() => undefined)
}

export function resolved(deps: ProductsWriteDeps): Required<ProductsWriteDeps> {
  return {
    firestore: deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore),
    verifyIdToken: deps.verifyIdToken ?? ((token) => firebaseAdmin.app().auth().verifyIdToken(token) as never),
    orgForHost: deps.orgForHost ?? ((hostId) => getOrgForHost(hostId) as never),
    lockdown: deps.lockdown ?? ((options) => getLockdownVerdict(options)),
    dropCache: deps.dropCache ?? dropPluginSiteCache,
    now: deps.now ?? (() => Date.now()),
  }
}

/**
 * Saves a product as the console editor does. `create: true` makes a new
 * product under the client-minted `productId` (a retry finds its own product
 * and answers `replayed`); otherwise it replaces the live product, keeping
 * its live stock holds.
 */
export function createProductSaveHandler(options: ProductsWriteDeps = {}): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const deps = resolved(options)
    const body = bodyOf(req)
    const hostId = body['hostId']
    const productId = body['productId']
    const product = body['product'] as EditedProduct | undefined
    if (!validId(hostId) || !validId(productId) || !product || typeof product !== 'object' || !Array.isArray(product.variants)) {
      return res.status(400).json({ error: 'Missing site, product or its variants' })
    }
    if (typeof product.name !== 'string' || !product.name.trim()) return res.status(400).json({ error: 'Product name is required' })
    try {
      const door = await gate(req, res, hostId, deps)
      if (!door) return
      const nowMs = deps.now()
      const fields = productSaveFields(product, nowMs)
      const problem = validateProduct(fields as never)
      if (problem) return res.status(400).json({ error: problem })
      const db = deps.firestore()
      const hostRef = db.collection('hosts').doc(hostId)
      const products = hostRef.collection('products')
      const productRef = products.doc(productId)
      const smartQuery = hostRef.collection('collections').where('kind', '==', 'catalog').where('mode', '==', 'smart')
      const outbox = outboxEntry(db, hostId)
      const create = body['create'] === true
      const answer = await db.runTransaction(async (tx) => {
        const [existing, smart] = await Promise.all([tx.get(productRef), tx.get(smartQuery)])
        const membership = {
          collectionIds: productCollectionIds(
            productMembershipInput(fields, product) as never,
            smart.docs.map((doc) => smartCollectionRulesOf(doc.id, doc.data())),
          ),
        }
        if (create) {
          if (existing.exists) return { status: 200, body: { ok: true, id: productId, replayed: true } }
          const early = planRefusal(door.org as never)
          if (early) return { status: early.status, body: { error: early.error } }
          const used = (await tx.get(products.count())).data().count
          const room = roomRefusal(door.org as never, Number(used) || 0)
          if (room) return { status: room.status, body: { error: room.error } }
          tx.create(productRef, {
            ...fields,
            ...membership,
            createdAtMs: nowMs,
            deletedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdBy: door.uid,
          })
        } else {
          if (!existing.exists || existing.get('deletedAt')) return { status: 404, body: { error: 'This product was deleted' } }
          tx.set(productRef, {
            ...storedTimestamps(existing.data() ?? {}, product as unknown as Record<string, unknown>),
            ...productEditWrite(fields, existing.get('stockHolds')),
            ...membership,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        tx.set(outbox.ref, outbox.data)
        return { status: 200, body: { ok: true, id: productId, replayed: false } }
      })
      if (answer.status === 200 && !(answer.body as { replayed?: boolean }).replayed) {
        await settleCache(deps, hostId, outbox.ref, 'product saved from the app')
      }
      return res.status(answer.status).json(answer.body)
    } catch (error) {
      console.error('[commerce/products/save]', error)
      return res.status(500).json({ error: 'The product could not be saved' })
    }
  }
}

/**
 * The stored timestamps an edit keeps. The console's replace writes back the
 * Timestamps its seed carried (`createdAt`, a publish time); a client's JSON
 * cannot carry one, so each stored Timestamp field the request does not name
 * is kept as stored.
 */
export function storedTimestamps(stored: Record<string, unknown>, asked: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(stored).filter(
      ([key, value]) => !(key in asked) && typeof (value as { toDate?: unknown } | null)?.toDate === 'function',
    ),
  )
}

/** The ledger row id one attempt owns: the same key from the same member is the same row. */
export function stockAttemptId(uid: string, key: string): string {
  return 'app-' + createHash('sha256').update(`${uid}:${key}`).digest('hex').slice(0, 40)
}

/**
 * Adjusts one variant's stock as the Adjust stock dialog does: the variants
 * and stock fields on the product, and one `inventoryAdjustments` row, in one
 * transaction. The Idempotency-Key names that row, so a retried attempt finds
 * it and moves nothing twice.
 */
export function createProductStockHandler(options: ProductsWriteDeps = {}): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const deps = resolved(options)
    const body = bodyOf(req)
    const hostId = body['hostId']
    const productId = body['productId']
    const variantId = body['variantId']
    const key = String(req.headers['idempotency-key'] ?? '').trim().slice(0, 200)
    const reason = body['reason'] as InventoryAdjustmentReason
    const delta = Math.round(Number(body['delta']))
    const locationId = typeof body['locationId'] === 'string' && body['locationId'] ? body['locationId'] : undefined
    if (!validId(hostId) || !validId(productId) || typeof variantId !== 'string' || !variantId) {
      return res.status(400).json({ error: 'Missing site, product or variant' })
    }
    if (!key) return res.status(400).json({ error: 'Missing Idempotency-Key' })
    if (!STOCK_ADJUST_REASONS.includes(reason)) return res.status(400).json({ error: 'Unknown reason' })
    if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'Enter a number of units' })
    try {
      const door = await gate(req, res, hostId, deps)
      if (!door) return
      const db = deps.firestore()
      const hostRef = db.collection('hosts').doc(hostId)
      const productRef = hostRef.collection('products').doc(productId)
      const ledgerRef = hostRef.collection('inventoryAdjustments').doc(stockAttemptId(door.uid, key))
      const outbox = outboxEntry(db, hostId)
      const answer = await db.runTransaction(async (tx) => {
        const [ledger, stored] = await Promise.all([tx.get(ledgerRef), tx.get(productRef)])
        if (ledger.exists) {
          return { status: 200, body: { ok: true, replayed: true, inventory: stored.get('inventory') ?? null } }
        }
        if (!stored.exists || stored.get('deletedAt')) return { status: 404, body: { error: 'This product was deleted' } }
        const product = stored.data() as never as Parameters<typeof stockAdjustmentWrite>[0]
        if (!(product.variants ?? []).some((variant) => variant.id === variantId)) {
          return { status: 404, body: { error: 'That variant is no longer on this product' } }
        }
        const write = stockAdjustmentWrite(product, productId, { variantId, delta, reason, locationId }, deps.now())
        if (!write) return { status: 400, body: { error: 'Enter a number of units' } }
        tx.update(productRef, write.update)
        tx.create(ledgerRef, write.ledger)
        tx.set(outbox.ref, outbox.data)
        return { status: 200, body: { ok: true, replayed: false, inventory: (write.update as { inventory?: unknown }).inventory ?? null } }
      })
      if (answer.status === 200 && !(answer.body as { replayed?: boolean }).replayed) {
        await settleCache(deps, hostId, outbox.ref, 'stock adjusted from the app')
      }
      return res.status(answer.status).json(answer.body)
    } catch (error) {
      console.error('[commerce/products/stock]', error)
      return res.status(500).json({ error: 'Stock could not be adjusted' })
    }
  }
}

export const productSaveHandler = createProductSaveHandler()
export const productStockHandler = createProductStockHandler()
