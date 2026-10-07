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

import { pluginShippingRateQuoter } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * `GET commerce/shipping/carrier-rates?hostId` (AGL-3612): whether this site
 * can price shipping by carrier, and the services it may offer — what the
 * Shipping card asks before it shows the Carrier rates kind. Answered from
 * core's quoter seam, so it is `available: false` wherever no plugin quotes
 * carriers or the deployment names no carrier provider, and the kind is not
 * offered. A site collaborator may ask; nothing here is a secret.
 */
export const carrierRatesAvailabilityHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const authorization = String(req.headers.authorization ?? '')
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthenticated' })
  const hostId = String((req.query as Record<string, unknown> | undefined)?.['hostId'] ?? '')
  if (!hostId || hostId.includes('/') || /^__.*__$/.test(hostId)) {
    return res.status(400).json({ error: 'Missing hostId' })
  }
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch {
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  try {
    const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
    if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
    const role = (host.get('memberRoles') ?? {})[decoded.uid]
    if (!role && decoded['staff'] !== true) return res.status(403).json({ error: 'Not permitted' })
    const quoter = pluginShippingRateQuoter()
    const available = quoter ? await quoter.available(hostId).catch(() => false) : false
    const services = available && quoter ? await quoter.listServices(hostId).catch(() => []) : []
    return res.status(200).json({ available, services })
  } catch {
    return res.status(200).json({ available: false, services: [] })
  }
}
