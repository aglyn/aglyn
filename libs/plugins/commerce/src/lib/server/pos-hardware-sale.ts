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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { POS_HARDWARE_SKUS } from '../model/pos-hardware'
import { authorizePosStaff, posRequestBody } from './pos-auth'
import { isPosHardwareSellerStore, posHardwareInPersonConfig } from './pos-hardware'

/*==========================================
 * `POST /api/commerce/pos-hardware-sale` (AGL-4038): selling a card reader in
 * person, at the platform's own store's register, to someone who is not a
 * member of it.
 *
 *   status  whether this store is the platform's hardware seller, and the
 *           hardware items a product of it may be — the product editor's
 *           "Point of sale hardware" choice is shown only where it is.
 *
 * Gated like the register (`authorizePosStaff`, on a plan with POS). Every
 * answer is about THIS store: on any store but the configured seller it says
 * `seller: false` and nothing else, so no other workspace learns the
 * platform's configuration or is shown a control it cannot use.
 *=========================================*/

export const posHardwareSaleHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = posRequestBody(req)
  const hostId = String(body['hostId'] ?? '')
  const action = String(body['action'] ?? '')
  const gate = await authorizePosStaff(req, hostId)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const staff = gate.staff
  const config = posHardwareInPersonConfig()
  const seller = isPosHardwareSellerStore(config, staff.hostId, staff.orgId)
  try {
    switch (action) {
      case 'status':
        if (!seller) return res.status(200).json({ seller: false })
        return res.status(200).json({
          seller: true,
          items: POS_HARDWARE_SKUS.map((sku) => ({ sku: sku.id, name: sku.displayName, kind: sku.kind })),
        })
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[pos-hardware-sale]', action, error)
    return res.status(500).json({ error: 'The card reader sale could not answer' })
  }
}
