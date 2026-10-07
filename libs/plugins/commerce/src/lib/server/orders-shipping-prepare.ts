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

import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'

/*
 * `commerce/orders-shipping-prepare` (AGL-3613): POST `{ hostId }` stamps the
 * site's open orders written before AGL-3613 with what the shipping export
 * and a shipping tool's feed ask (`requiresShipping`, `updatedAtMs`), so the
 * indexed query finds them. The console calls it before an export for
 * shipping. Bounded to OPEN orders — the ones a shipping tool still has to
 * see — and a no-op for an order already stamped. The site's admins and
 * editors, the order book's roles.
 */

/** Statuses a shipping tool still has to see an order in. */
const OPEN_STATUSES: readonly CommerceModel.OrderStatus[] = ['pending', 'paid', 'partially_fulfilled']

/** The most open orders one `prepare` stamps; a store with more is stamped over several calls. */
export const PREPARE_MAX_ORDERS = 2000

/**
 * Stamps the site's open orders that predate the stamp. Answers how many it
 * stamped. `updatedAtMs` is the order's creation, not now: stamping is not
 * a change ShipStation needs to hear about.
 */
export async function prepareOpenOrders(hostId: string): Promise<number> {
  const firestore = firebaseAdmin.app().firestore()
  const orders = firestore.collection('hosts').doc(hostId).collection('orders')
  const snapshot = await orders.where('status', 'in', [...OPEN_STATUSES]).limit(PREPARE_MAX_ORDERS).get()
  let stamped = 0
  let batch = firestore.batch()
  let inBatch = 0
  for (const doc of snapshot.docs) {
    const data = (doc.data() ?? {}) as Partial<CommerceModel.HostOrder> & { requiresShipping?: unknown; updatedAtMs?: unknown; createdAtMs?: unknown }
    if (typeof data.requiresShipping === 'boolean' && typeof data.updatedAtMs === 'number') continue
    const createdAtMs = Number(data.createdAtMs)
    batch.update(doc.ref, {
      ...(typeof data.requiresShipping === 'boolean' ? {} : { requiresShipping: CommerceModel.orderRequiresShipping(data) }),
      ...(typeof data.updatedAtMs === 'number'
        ? {}
        : { updatedAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now() }),
    })
    stamped += 1
    inBatch += 1
    if (inBatch === 400) {
      await batch.commit()
      batch = firestore.batch()
      inBatch = 0
    }
  }
  if (inBatch) await batch.commit()
  return stamped
}

export const ordersShippingPrepareHandler: Aglyn.PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  let body: Record<string, unknown>
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    return res.status(400).json({ error: 'The request could not be read' })
  }
  const hostId = String(body['hostId'] ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) return res.status(400).json({ error: 'Missing hostId' })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const hostSnapshot = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) return res.status(404).json({ error: 'Unknown site' })
    const role = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (role !== 'admin' && role !== 'editor') return res.status(403).json({ error: 'Not permitted' })
    const owner = await getOrgForHost(hostId)
    if (!Aglyn.checkEntitlement(owner?.org as never, 'commerce')) {
      return res.status(403).json({ error: 'Selling is not enabled' })
    }
    const stamped = await prepareOpenOrders(hostId)
    return res.status(200).json({ ok: true, stamped })
  } catch (error) {
    console.error('orders-shipping-prepare failed', hostId, error)
    return res.status(500).json({ error: 'That did not work. Try again.' })
  }
}
