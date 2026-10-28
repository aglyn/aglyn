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
import { POS_HARDWARE_SKUS, type PosHardwareOrder } from '../model/pos-hardware'
import type { PosPermission } from '../model/plugin-permissions'
import { authorizePosStaff, posRequestBody } from './pos-auth'
import { isPosHardwareSellerStore, posHardwareInPersonConfig, posHardwareOrderNumber } from './pos-hardware'

/*==========================================
 * `POST /api/commerce/pos-hardware-sale` (AGL-4038): selling a card reader in
 * person, at the platform's own store's register, to someone who is not a
 * member of it.
 *
 *   status   whether this store is the platform's hardware seller, and the
 *            hardware items a product of it may be — the product editor's
 *            "Point of sale hardware" choice is shown only where it is.
 *   pending  the "To attach" list: sales of hardware nobody has said whose
 *            they are yet (a kiosk or offline sale, a buyer with no account
 *            or no workspace yet), newest first. Records any paid sale still
 *            waiting to be recorded first (`sweepInPersonPosHardwareSales`).
 *
 * `status` is asked of whoever works the register; everything else needs
 * "Sell at the register" (`posSell`) on the seller store, since it is part
 * of ringing a sale there, and answers 404 on any other store.
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
  const permission: PosPermission | undefined = action === 'status' ? undefined : 'posSell'
  const gate = await authorizePosStaff(req, hostId, permission)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const staff = gate.staff
  const config = posHardwareInPersonConfig()
  const seller = isPosHardwareSellerStore(config, staff.hostId, staff.orgId)
  try {
    if (action === 'status') {
      if (!seller) return res.status(200).json({ seller: false })
      return res.status(200).json({
        seller: true,
        items: POS_HARDWARE_SKUS.map((sku) => ({ sku: sku.id, name: sku.displayName, kind: sku.kind })),
      })
    }
    if (!seller) return res.status(404).json({ error: 'Card reader sales are not available on this store.' })
    const inPerson = await import('./pos-hardware-in-person')
    switch (action) {
      case 'pending': {
        await inPerson.sweepInPersonPosHardwareSales(config)
        const pending = await inPerson.pendingInPersonPosHardwareOrders(config)
        return res.status(200).json({ orders: pending.map(({ id, order }) => toAttachView(id, order)) })
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[pos-hardware-sale]', action, error)
    return res.status(500).json({ error: 'The card reader sale could not answer' })
  }
}

/**
 * A sale on the To attach list, as the register shows it: what was sold and
 * when, the register order it came from, and what is known of the buyer —
 * the receipt address, or the address or account a register user gave.
 */
export function toAttachView(id: string, order: PosHardwareOrder) {
  return {
    id,
    number: posHardwareOrderNumber(id),
    registerOrderId: order.posSale?.orderId ?? null,
    registerNumber: order.posSale?.number ?? null,
    kiosk: order.posSale?.kiosk === true,
    offline: order.posSale?.offline === true,
    lines: (order.lines ?? []).map((line) => ({ sku: line.sku, name: line.name, quantity: line.quantity })),
    totalCents: order.totalCents ?? 0,
    createdAtMs: order.createdAtMs ?? 0,
    contactEmail: order.contactEmail ?? null,
    /** A buyer with an account and no workspace yet. */
    awaitingWorkspace: Boolean(order.attachment?.uid),
    /** A buyer with no account yet, invited to sign up. */
    invited: Boolean(order.attachment?.email && !order.attachment?.uid),
  }
}

export type ToAttachView = ReturnType<typeof toAttachView>
