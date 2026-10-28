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
import { consumeRateLimit, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { maskEmailAddress } from '@aglyn/tenant-data-admin/server/admin-audit'
import { POS_HARDWARE_SKUS, type PosHardwareOrder } from '../model/pos-hardware'
import type { PosPermission } from '../model/plugin-permissions'
import { authorizePosStaff, posIdempotencyKey, posRequestBody, type PosStaff } from './pos-auth'
import { isPosHardwareSellerStore, posHardwareInPersonConfig, posHardwareOrderNumber } from './pos-hardware'

/** How many lookups one register user makes in ten minutes. */
export const BUYER_LOOKUPS_PER_WINDOW = 30
const LOOKUP_WINDOW_MS = 10 * 60 * 1000

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
 *   find     look the buyer up across the platform by exact email, a
 *            person's name or a workspace's name (`pos-hardware-buyer-lookup.ts`):
 *            the least that picks the right person, their address in full.
 *            Rate-limited per register user and written to the platform's
 *            audit log (the address masked there), every time.
 *   attach   say whose a sale is — by the register sale or the To attach
 *            entry — as an account and workspace (and store), an account
 *            with no workspace yet, or the address of someone with no
 *            account, who is invited to sign up (`pos-hardware-attach.ts`).
 *            Idempotency-Key required; audited.
 *   detach   put an attached sale back on the To attach list. Audited.
 *   serials  the serial numbers of the sale's readers, scanned or typed at
 *            the sale, so the order sets itself up when the buyer registers
 *            them (`pos-hardware-readers.ts`).
 *   terms    the terms of sale the buyer accepts before paying (Terms
 *            4.26–4.32 in short, with the link), and `terms-status` whether
 *            they have, for the register waiting on its display.
 *   accept-terms  the buyer accepted on the register tablet handed to them;
 *            `terms-on-display` notes who is putting them on the customer
 *            display, before the register shows them there (`pos-hardware-terms.ts`).
 *   register-at-booth  register a reader to the buyer's chosen store by the
 *            code it shows, while they are there, with the store's address
 *            when it has no reader Location yet (`address`; refused with
 *            `reason: 'needs-address'` without one). Idempotency-Key
 *            required; audited.
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
      case 'find': {
        const query = String(body['query'] ?? '').trim().slice(0, 120)
        if (query.length < 2) return res.status(400).json({ error: 'Type at least two letters, or an email address.' })
        const rate = await consumeRateLimit(`pos-hardware-lookup:${staff.uid}`, {
          limit: BUYER_LOOKUPS_PER_WINDOW,
          windowMs: LOOKUP_WINDOW_MS,
        })
        if (!rate.allowed) return res.status(429).json({ error: 'Too many lookups. Try again in a few minutes.' })
        const found = await (await import('./pos-hardware-buyer-lookup')).findHardwareBuyers(query)
        await audit(staff, 'pos-hardware-buyer-lookup', {
          // The audit log keeps an address masked; a name as typed. The
          // register itself is answered in full.
          query: found.kind === 'email' ? maskEmailAddress(query) : query,
          kind: found.kind,
          matched: [
            ...found.people.map((person) => person.uid),
            ...found.workspaces.map((workspace) => `org:${workspace.orgId}`),
          ],
        })
        return res.status(200).json(found)
      }
      case 'terms':
      case 'terms-status':
      case 'terms-on-display':
      case 'accept-terms': {
        const terms = await import('./pos-hardware-terms')
        const registerOrderId = String(body['registerOrderId'] ?? '')
        try {
          if (action === 'terms') return res.status(200).json(terms.posHardwareTermsView())
          if (action === 'terms-status') {
            return res.status(200).json(await terms.posHardwareTermsStatus(config, registerOrderId))
          }
          if (action === 'terms-on-display') {
            await terms.requestPosHardwareTermsOnDisplay({ config, registerOrderId, uid: staff.uid })
            return res.status(200).json({ ok: true })
          }
          const device = terms.posHardwareTermsDevice(req.headers as Record<string, unknown>)
          const acceptance = await terms.recordPosHardwareTermsAcceptance({
            config,
            registerOrderId,
            method: 'tablet',
            staffUid: staff.uid,
            ...device,
          })
          await audit(staff, 'pos-hardware-terms-accepted', { method: acceptance.method, version: acceptance.version, registerOrderId }, null)
          return res.status(200).json({ ok: true, acceptance })
        } catch (error) {
          if (error instanceof terms.PosHardwareTermsRefusal) {
            return res.status(error.status).json({ error: error.message })
          }
          throw error
        }
      }
      case 'serials':
      case 'register-at-booth': {
        const readers = await import('./pos-hardware-readers')
        try {
          if (action === 'serials') {
            const saved = await readers.recordPosHardwareSerials({
              config,
              registerOrderId: typeof body['registerOrderId'] === 'string' ? body['registerOrderId'] : null,
              orderId: typeof body['orderId'] === 'string' ? body['orderId'] : null,
              serials: body['serials'],
            })
            return res.status(200).json({ ok: true, serials: saved.serials, recorded: saved.recorded })
          }
          if (!posIdempotencyKey(req)) return res.status(400).json({ error: 'Missing Idempotency-Key' })
          const registerOrderId = typeof body['registerOrderId'] === 'string' ? body['registerOrderId'] : ''
          const orderId = registerOrderId
            ? (await import('./pos-hardware')).posHardwareInPersonOrderId(config.sellerHostId, registerOrderId)
            : String(body['orderId'] ?? '')
          const { order, readerId, storeAddress } = await readers.registerPosHardwareAtBooth({
            config,
            orderId,
            registrationCode: body['registrationCode'],
            label: body['label'],
            address: body['address'],
            uid: staff.uid,
          })
          await audit(
            staff,
            'pos-hardware-register-at-booth',
            {
              readerId,
              hostId: order.hostId,
              orgId: order.orgId,
              // That the buyer's store address was typed here, and where:
              // the store's reader Location was made from it. The street
              // stays with the store, never in the audit log.
              ...(storeAddress
                ? {
                    storeAddressEntered: {
                      city: storeAddress.city,
                      state: storeAddress.state ?? null,
                      country: storeAddress.country,
                    },
                  }
                : {}),
            },
            orderId,
          )
          return res.status(200).json({
            ok: true,
            readerId,
            storeAddressSaved: Boolean(storeAddress),
            order: toAttachView(orderId, order),
          })
        } catch (error) {
          if (error instanceof readers.PosHardwareReaderRefusal) {
            return res
              .status(error.status)
              .json({ error: error.message, ...(error.reason ? { reason: error.reason } : {}) })
          }
          throw error
        }
      }
      case 'attach':
      case 'detach': {
        if (!posIdempotencyKey(req)) return res.status(400).json({ error: 'Missing Idempotency-Key' })
        const attach = await import('./pos-hardware-attach')
        try {
          if (action === 'detach') {
            const orderId = String(body['orderId'] ?? '')
            const { order } = await attach.detachPosHardwareSale({ config, orderId })
            await audit(staff, 'pos-hardware-sale-detach', { orderId }, orderId)
            return res.status(200).json({ ok: true, order: toAttachView(orderId, order) })
          }
          const buyer = await attach.checkHardwareBuyer((body['buyer'] ?? {}) as Record<string, unknown>)
          const outcome = await attach.attachPosHardwareSale({
            config,
            buyer,
            attachedBy: staff.uid,
            registerOrderId: typeof body['registerOrderId'] === 'string' ? body['registerOrderId'] : null,
            orderId: typeof body['orderId'] === 'string' ? body['orderId'] : null,
          })
          const target = outcome.outcome === 'waiting' ? null : outcome.orderId
          await audit(
            staff,
            'pos-hardware-sale-attach',
            {
              outcome: outcome.outcome,
              uid: buyer.uid,
              orgId: buyer.orgId,
              hostId: buyer.hostId,
              email: buyer.uid ? null : maskEmailAddress(buyer.email),
              ...(outcome.outcome === 'waiting' ? { registerOrderId: outcome.registerOrderId } : {}),
            },
            target,
          )
          return res.status(200).json(
            outcome.outcome === 'waiting'
              ? { outcome: 'waiting' }
              : { outcome: outcome.outcome, order: toAttachView(outcome.orderId, outcome.order) },
          )
        } catch (error) {
          if (error instanceof attach.PosHardwareAttachRefusal) {
            return res.status(error.status).json({ error: error.message })
          }
          throw error
        }
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
    // The buyer's address in full, as the lookup shows it (AGL-4038): the
    // account's, a receipt's, or one typed for a buyer with no account.
    contactEmail: order.contactEmail ?? null,
    attached: order.attachment?.state === 'attached',
    /** Attached with the buyer's store chosen: a reader can be registered to it here. */
    storeChosen: order.attachment?.state === 'attached' && Boolean(order.hostId),
    /** Readers on the sale, and how many have a serial or are set up. */
    readers: (order.units ?? []).length,
    serialsTaken: (order.units ?? []).filter((unit) => unit.serialNumber).length,
    readersSetUp: (order.units ?? []).filter((unit) => unit.readerId).length,
    /** A buyer with an account and no workspace yet. */
    awaitingWorkspace: Boolean(order.attachment?.uid),
    /** A buyer with no account yet, invited to sign up. */
    invited: Boolean(order.attachment?.email && !order.attachment?.uid),
  }
}

export type ToAttachView = ReturnType<typeof toAttachView>

/**
 * One row of the platform's audit log for a lookup or an attachment: who on
 * the selling store did it, and what — never the buyer's full address.
 */
async function audit(
  staff: PosStaff,
  action: string,
  after: Record<string, unknown>,
  orderId: string | null = null,
): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  await addAdminAudit(firestore, {
    action,
    actorUid: staff.uid,
    actorEmail: null,
    scope: 'posHardwareSale',
    target: orderId ? `posHardwareSales/${orderId}` : `hosts/${staff.hostId}`,
    orgId: staff.orgId,
    before: null,
    after,
    at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  })
}
