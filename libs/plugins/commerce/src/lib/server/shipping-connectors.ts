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
import { firebaseAdmin, getOrgForHost, logHostActivity } from '@aglyn/tenant-data-admin'
import { readCommerceSecretKeyring } from './order-webhooks'
import { prepareOpenOrders } from './orders-shipping-prepare'
import {
  SHIPSTATION_CONNECTIONS,
  mintShipStationCredentials,
  openShipStationPassword,
  sealShipStationPassword,
  type ShipStationConnection,
} from './shipstation'

/*
 * THE CONSOLE'S SIDE OF THE SHIPSTATION CONNECTION (AGL-3613):
 * `commerce/shipping-connectors`.
 *
 * - GET `?hostId=` — whether ShipStation can be connected on this deployment
 *   (`available`: commerce's secret keyring exists), whether it is, its
 *   username and when it last called. Never the password.
 * - POST `{ hostId, action: 'connect' | 'rotate' | 'reveal' | 'disconnect' }`
 *   — a site's ADMINS only, because the credentials read every shippable
 *   order's name and address. `connect`, `rotate` and `reveal` answer the
 *   password; `rotate` ends the old one at once. `connect` also stamps the
 *   open orders written before the feed's fields existed
 *   (`prepareOpenOrders`), so ShipStation's first import finds them.
 */

/** What the card shows about a connection. */
export interface ShipStationConnectionStatus {
  /** Whether this deployment can seal a password at all. */
  available: boolean
  connected: boolean
  username?: string
  createdAtMs?: number
  rotatedAtMs?: number
  lastExportAtMs?: number
  lastShipNoticeAtMs?: number
}

function statusOf(connection: ShipStationConnection | null, available: boolean): ShipStationConnectionStatus {
  if (!connection) return { available, connected: false }
  return {
    available,
    connected: true,
    username: connection.username,
    createdAtMs: connection.createdAtMs,
    ...(connection.rotatedAtMs ? { rotatedAtMs: connection.rotatedAtMs } : {}),
    ...(connection.lastExportAtMs ? { lastExportAtMs: connection.lastExportAtMs } : {}),
    ...(connection.lastShipNoticeAtMs ? { lastShipNoticeAtMs: connection.lastShipNoticeAtMs } : {}),
  }
}

const ACTIVITY = { type: 'commerce:shipStation', id: 'shipstation', name: 'ShipStation' } as const

const ACTIONS = ['status', 'connect', 'rotate', 'reveal', 'disconnect'] as const
type Action = (typeof ACTIONS)[number]

export const shippingConnectorsHandler: Aglyn.PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  let body: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    } catch {
      return res.status(400).json({ error: 'The request could not be read' })
    }
  }
  const hostId = String((req.method === 'GET' ? req.query['hostId'] : body['hostId']) ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) return res.status(400).json({ error: 'Missing hostId' })
  const action = (req.method === 'GET' ? 'status' : String(body['action'] ?? '')) as Action
  if (!ACTIONS.includes(action) || (req.method === 'POST' && action === 'status')) {
    return res.status(400).json({ error: 'Unknown action' })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) return res.status(404).json({ error: 'Unknown site' })
    const role = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    // Reading the status is the order book's role; anything that makes,
    // shows or ends a credential that reads it is the admin's.
    const adminOnly = action !== 'status'
    if (adminOnly ? role !== 'admin' : role !== 'admin' && role !== 'editor') {
      return res.status(403).json({
        error: adminOnly ? 'Only a site admin can manage the ShipStation connection' : 'Not permitted',
      })
    }
    const owner = await getOrgForHost(hostId)
    if (!Aglyn.checkEntitlement(owner?.org as never, 'commerce')) {
      return res.status(403).json({ error: 'Selling is not enabled' })
    }

    const keyring = readCommerceSecretKeyring()
    const available = keyring !== null
    const ref = firestore.collection(SHIPSTATION_CONNECTIONS).doc(hostId)
    const actor = { uid: decoded.uid, email: decoded.email ?? null }

    if (action === 'status') {
      const doc = await ref.get()
      return res.status(200).json(statusOf(doc.exists ? (doc.data() as ShipStationConnection) : null, available))
    }
    if (action === 'disconnect') {
      const doc = await ref.get()
      if (!doc.exists) return res.status(200).json({ available, connected: false })
      await ref.delete()
      await logHostActivity(hostId, actor, 'Disconnected ShipStation', ACTIVITY)
      return res.status(200).json({ available, connected: false })
    }
    if (!keyring) {
      return res.status(503).json({ error: 'ShipStation cannot be connected on this deployment yet' })
    }
    if (action === 'reveal') {
      const doc = await ref.get()
      if (!doc.exists) return res.status(409).json({ error: 'ShipStation is not connected.' })
      const connection = doc.data() as ShipStationConnection
      const opened = openShipStationPassword(connection, keyring)
      if (!opened) {
        return res.status(409).json({ error: 'The password cannot be shown. Make a new password instead.' })
      }
      await logHostActivity(hostId, actor, 'Showed the ShipStation password', ACTIVITY)
      return res.status(200).json({ ...statusOf(connection, available), password: opened.password })
    }

    const { username, password } = mintShipStationCredentials()
    const sealed = sealShipStationPassword(hostId, password, keyring)
    const nowMs = Date.now()
    const outcome = await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref)
      if (action === 'connect') {
        if (doc.exists) return { conflict: 'ShipStation is already connected. Make a new password instead.' }
        const connection: ShipStationConnection = {
          hostId,
          username,
          ...sealed,
          createdAtMs: nowMs,
          createdBy: decoded.uid,
        }
        transaction.create(ref, connection)
        return { connection }
      }
      if (!doc.exists) return { conflict: 'ShipStation is not connected.' }
      const current = doc.data() as ShipStationConnection
      // A new password ends the old one at once: the merchant gives
      // ShipStation the new one, and anything holding the old one is refused.
      const connection: ShipStationConnection = { ...current, ...sealed, rotatedAtMs: nowMs }
      delete connection.exportCursor
      // Documents sealed before the secret box carried a digest; drop it.
      delete (connection as unknown as Record<string, unknown>)['passwordHash']
      transaction.set(ref, connection)
      return { connection }
    })
    if ('conflict' in outcome) return res.status(409).json({ error: outcome.conflict })
    if (action === 'connect') {
      await prepareOpenOrders(hostId).catch((error: unknown) =>
        console.warn('shipping-connectors: open orders not stamped', hostId, error),
      )
    }
    await logHostActivity(
      hostId,
      actor,
      action === 'connect' ? 'Connected ShipStation' : 'Made a new ShipStation password',
      ACTIVITY,
    )
    const connection = outcome.connection as ShipStationConnection
    return res.status(200).json({ ...statusOf(connection, available), password })
  } catch (error) {
    console.error('shipping-connectors failed', action, error)
    return res.status(500).json({ error: 'That did not work. Try again.' })
  }
}
