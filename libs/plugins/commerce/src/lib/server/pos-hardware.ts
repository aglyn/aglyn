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

import { createHash } from 'crypto'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, readOrgBilling } from '@aglyn/tenant-data-admin'
import { hostConsoleUrl } from '@aglyn/tenant-data-admin/server/host-console-link'
import {
  encodePosHardwareLines,
  isPosHardwareShippingMethod,
  POS_HARDWARE_ANCHOR,
  parsePosHardwareConfig,
  parsePosHardwareInPersonConfig,
  POS_HARDWARE_CURRENCY,
  POS_HARDWARE_METADATA_TYPE,
  POS_HARDWARE_ORDERS_COLLECTION,
  POS_HARDWARE_SALES_COLLECTION,
  POS_HARDWARE_SHIP_COUNTRIES,
  POS_HARDWARE_SHIPPING_LABELS,
  posHardwareOffers,
  posHardwareOrderSource,
  posHardwareSku,
  pricePosHardwareCart,
  type PosHardwareConfig,
  type PosHardwareInPersonConfig,
  type PosHardwareOrder,
} from '../model/pos-hardware'
import { mayVisitPosHardwareShop } from '../model/plugin-permissions'
import { authorizePosStaff, posIdempotencyKey, posRequestBody } from './pos-auth'
import { posStripe, posTerminalAvailable } from './pos-stripe'

/*==========================================
 * `POST /api/commerce/pos-hardware` (AGL-4038): the merchant's half of the
 * POS hardware shop, behind the Hardware card on Products → Point of sale.
 *
 *   catalog   what is on offer and at what price, or `available: false`
 *   checkout  a Stripe Checkout Session for the basket, on the PLATFORM
 *   orders    this site's hardware orders, newest first
 *
 * Gated like the register (`authorizePosStaff`, on a plan with POS), because
 * the readers it sells are the register's, with one difference (AGL-4047):
 * the shop admits whoever works the register (`managePos`) AND whoever may
 * buy hardware (`posBuyHardware`), which stands on its own — a bookkeeper
 * with no register orders the store's readers. A checkout needs
 * `posBuyHardware`; seeing the catalog and the site's orders needs either.
 *
 * THE SALE IS THE PLATFORM'S. The session is created with the platform key
 * and NO connected account, `transfer_data` or application fee: the merchant
 * is the buyer here, and the platform is the seller of record that places
 * the order with Stripe. The order document is written by the webhook once
 * Stripe says the session is paid (`pos-hardware-webhook.ts`), never here.
 *=========================================*/

/** The shop's config from this deployment, or `null` while it is hidden. */
export function posHardwareConfig(
  env: Record<string, string | undefined> = process.env,
): PosHardwareConfig | null {
  // A reader the platform cannot yet take payments on is not for sale: the
  // shop opens only where the register offers card readers at all.
  if (!posTerminalAvailable()) return null
  return parsePosHardwareConfig(env)
}

/**
 * The platform's own store that sells hardware in person (AGL-4038), or
 * `null` while that is off. Read like the shop's other figures; a store is
 * the seller only when BOTH its id and its workspace's match, so a site moved
 * to another workspace stops selling hardware rather than selling it for them.
 */
export function posHardwareInPersonConfig(
  env: Record<string, string | undefined> = process.env,
): PosHardwareInPersonConfig | null {
  return parsePosHardwareInPersonConfig(env)
}

/** Whether a store, owned by `orgId`, is the platform's own hardware seller. */
export function isPosHardwareSellerStore(
  config: PosHardwareInPersonConfig | null,
  hostId: string,
  orgId: string,
): config is PosHardwareInPersonConfig {
  return Boolean(config) && config?.sellerHostId === hostId && config?.sellerOrgId === orgId
}

/**
 * An in-person order's id, from the register sale it came from: one register
 * sale is one hardware order however often its completion is told.
 */
export function posHardwareInPersonOrderId(hostId: string, registerOrderId: string): string {
  return `hw_${createHash('sha256').update(`pos:${hostId}:${registerOrderId}`).digest('hex').slice(0, 20)}`
}

/** The order's id, derived from the attempt so a repeated press is one order. */
export function posHardwareOrderId(orgId: string, hostId: string, attemptKey: string): string {
  return `hw_${createHash('sha256').update(`${orgId}:${hostId}:${attemptKey}`).digest('hex').slice(0, 20)}`
}

/** The number a person reads: `HW-` and six characters of the id. */
export function posHardwareOrderNumber(orderId: string): string {
  return `HW-${orderId.replace(/^hw_/, '').slice(0, 6).toUpperCase()}`
}

export function hardwareOrdersRef(orgId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection(POS_HARDWARE_ORDERS_COLLECTION)
}

/**
 * `posHardwareSales/{orderId}`, the retained sale record beside each order
 * (see `PosHardwareSaleRecord`). Top-level on purpose: the workspace erasure
 * cannot reach it.
 */
export function posHardwareSaleRef(orderId: string) {
  return firebaseAdmin.app().firestore().collection(POS_HARDWARE_SALES_COLLECTION).doc(orderId)
}

/** An order as the merchant's card shows it: no Stripe ids, no staff notes. */
export function merchantHardwareOrderView(id: string, order: PosHardwareOrder) {
  return {
    id,
    number: posHardwareOrderNumber(id),
    status: order.status,
    lines: (order.lines ?? []).map((line) => ({
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitCents: line.unitCents,
      lineCents: line.lineCents,
    })),
    subtotalCents: order.subtotalCents ?? 0,
    shippingCents: order.shipping?.cents ?? 0,
    shippingLabel: order.shipping?.label ?? '',
    taxCents: order.taxCents ?? 0,
    totalCents: order.totalCents ?? 0,
    tracking: order.tracking ?? null,
    createdAtMs: order.createdAtMs ?? 0,
    updatedAtMs: order.updatedAtMs ?? order.createdAtMs ?? 0,
    // Bought in person (AGL-4038): handed over at the sale, no parcel.
    source: posHardwareOrderSource(order),
    discountCents: order.discountCents ?? 0,
    /** Readers still to set up, for an in-person order that took serials. */
    readersToSetUp: (order.units ?? []).filter((unit) => !unit.readerId).length,
  }
}

export type MerchantHardwareOrderView = ReturnType<typeof merchantHardwareOrderView>

/** The POS settings page of a site, as an absolute console URL. */
export async function posSettingsUrl(hostId: string): Promise<string> {
  return hostConsoleUrl(hostId, `/${hostId}/products/pos`)
}

/** `base` with `query` added before any `#fragment`, then `#hash`. */
export function withQueryAndHash(base: string, query: string, hash: string): string {
  const [path] = base.split('#')
  const joiner = path.includes('?') ? '&' : '?'
  return `${path}${joiner}${query}#${hash}`
}


export const posHardwareHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = posRequestBody(req)
  const hostId = String(body['hostId'] ?? '')
  const action = String(body['action'] ?? '')
  // BUYING IS ITS OWN KEY (AGL-4047): anyone who works the register or may
  // buy hardware sees what the shop offers and what this site ordered, and
  // only a member holding "Buy point of sale hardware" — which follows
  // `managePos` until a role or the member sets it, and may be granted
  // without it — starts a checkout that the workspace pays for.
  const gate = await authorizePosStaff(
    req,
    hostId,
    action === 'checkout' ? 'posBuyHardware' : undefined,
    mayVisitPosHardwareShop,
  )
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const staff = gate.staff
  const config = posHardwareConfig()
  try {
    switch (action) {
      case 'catalog':
        if (!config) return res.status(200).json({ available: false })
        return res.status(200).json({
          available: true,
          offers: posHardwareOffers(config),
          shipping: config.shipping.map((option) => ({
            method: option.method,
            label: POS_HARDWARE_SHIPPING_LABELS[option.method],
            cents: option.cents,
          })),
          automaticTax: config.automaticTax,
          shipCountries: POS_HARDWARE_SHIP_COUNTRIES,
        })
      case 'orders': {
        // This site's orders, and the readers bought in person for the
        // workspace that wait for a store to be chosen at setup (AGL-4038).
        // A sale on the selling workspace's own To attach list is never one.
        const [site, workspace] = await Promise.all([
          hardwareOrdersRef(staff.orgId).where('hostId', '==', staff.hostId).orderBy('createdAtMs', 'desc').limit(50).get(),
          hardwareOrdersRef(staff.orgId)
            .where('hostId', '==', '')
            .where('attachment.state', '==', 'attached')
            .orderBy('createdAtMs', 'desc')
            .limit(50)
            .get(),
        ])
        const orders = [...site.docs, ...workspace.docs]
          .map((doc: any) => merchantHardwareOrderView(String(doc.id), doc.data() as PosHardwareOrder))
          .sort((a, b) => b.createdAtMs - a.createdAtMs)
          .slice(0, 50)
        return res.status(200).json({ orders })
      }
      case 'checkout': {
        if (!config) return res.status(404).json({ error: 'The hardware shop is not available.' })
        const attemptKey = posIdempotencyKey(req)
        if (!attemptKey) return res.status(400).json({ error: 'Missing Idempotency-Key' })
        if (!staff.orgId) return res.status(409).json({ error: 'This site has no workspace.' })
        const priced = pricePosHardwareCart(config, body['lines'])
        if ('error' in priced) return res.status(400).json({ error: priced.error })
        const method = body['shippingMethod']
        const shipping = isPosHardwareShippingMethod(method)
          ? config.shipping.find((option) => option.method === method)
          : undefined
        if (!shipping) return res.status(400).json({ error: 'Choose a shipping speed.' })

        const orderId = posHardwareOrderId(staff.orgId, staff.hostId, attemptKey)
        const billing = await readOrgBilling(staff.orgId).catch(() => ({}))
        const customer = String((billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '').trim()
        const base = await posSettingsUrl(staff.hostId)
        const params: Record<string, string | number | boolean> = {
          mode: 'payment',
          client_reference_id: orderId,
          success_url: withQueryAndHash(base, 'hardwareOrder=placed', POS_HARDWARE_ANCHOR),
          cancel_url: withQueryAndHash(base, 'hardwareOrder=canceled', POS_HARDWARE_ANCHOR),
          'payment_method_types[0]': 'card',
          'shipping_address_collection[allowed_countries][0]': POS_HARDWARE_SHIP_COUNTRIES[0],
          'phone_number_collection[enabled]': true,
          'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
          'shipping_options[0][shipping_rate_data][display_name]': POS_HARDWARE_SHIPPING_LABELS[shipping.method],
          'shipping_options[0][shipping_rate_data][fixed_amount][amount]': shipping.cents,
          'shipping_options[0][shipping_rate_data][fixed_amount][currency]': POS_HARDWARE_CURRENCY,
          'metadata[type]': POS_HARDWARE_METADATA_TYPE,
          'metadata[orderId]': orderId,
          'metadata[orgId]': staff.orgId,
          'metadata[hostId]': staff.hostId,
          'metadata[uid]': staff.uid,
          'metadata[lines]': encodePosHardwareLines(priced.lines),
          'metadata[shippingMethod]': shipping.method,
          'metadata[shippingCents]': shipping.cents,
          'metadata[subtotalCents]': priced.subtotalCents,
          'payment_intent_data[description]': `Card reader order ${posHardwareOrderNumber(orderId)}`,
          'payment_intent_data[metadata][type]': POS_HARDWARE_METADATA_TYPE,
          'payment_intent_data[metadata][orderId]': orderId,
          'payment_intent_data[metadata][orgId]': staff.orgId,
          ...(customer ? { customer } : {}),
          ...(config.automaticTax
            ? {
                'automatic_tax[enabled]': true,
                'shipping_options[0][shipping_rate_data][tax_behavior]': 'exclusive',
                // A returning workspace's saved address is kept up to date
                // from what Checkout collects, which automatic tax requires.
                ...(customer ? { 'customer_update[shipping]': 'auto' } : {}),
              }
            : {}),
        }
        priced.lines.forEach((line, index) => {
          const sku = posHardwareSku(line.sku)
          params[`line_items[${index}][quantity]`] = line.quantity
          // A literal, not POS_HARDWARE_CURRENCY: check:facilitator-charge-shape
          // reads Stripe Tax beside a usd line item only when it says so (AGL-1956).
          params[`line_items[${index}][price_data][currency]`] = 'usd'
          params[`line_items[${index}][price_data][unit_amount]`] = line.unitCents
          params[`line_items[${index}][price_data][product_data][name]`] = line.name
          if (sku) params[`line_items[${index}][price_data][product_data][description]`] = sku.use
          params[`line_items[${index}][price_data][product_data][metadata][sku]`] = line.sku
          if (config.automaticTax) params[`line_items[${index}][price_data][tax_behavior]`] = 'exclusive'
        })
        const created = await posStripe('POST', 'checkout/sessions', {
          params,
          idempotencyKey: `pos-hw-checkout-${orderId}`,
        })
        const url = String(created.body?.url ?? '')
        if (!created.ok || !url) {
          console.error('[pos-hardware] checkout refused', created.status, created.body?.error?.code)
          return res.status(502).json({ error: 'Checkout could not be started. Try again in a moment.' })
        }
        return res.status(200).json({ url, orderId })
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[pos-hardware]', action, error)
    return res.status(500).json({ error: 'The hardware shop could not answer' })
  }
}
