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
import {
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
} from '@aglyn/tenant-data-admin'
import {
  resolveHostToken,
  type HostTokenSource,
} from '@aglyn/aglyn/app-utils/host-tokens'
import { sendEmail } from '@aglyn/shared-util-email'
import { createHmac } from 'crypto'
import * as CommerceModel from '../model'
import { tokenSigningSecret } from './download'
import { enqueueSupplierDelivery } from './supplier-outbox'

/**
 * Dropship routing for a multi-line CART order (AGL-3773).
 *
 * The Buy-button path has routed a paid order to its product's supplier since
 * AGL-289; the cart path recorded each line's `supplierId` and told nobody, so
 * a supplier assigned to a product never heard about an order placed through
 * the cart. This sends one notice per supplier on the order, naming only that
 * supplier's lines.
 *
 * - **Token.** Each supplier gets `HMAC(hostId:orderId:supplierId)`, the token
 *   `supplier-update.ts` re-derives for every supplier on the order, so the
 *   link it posts tracking through marks only its own lines shipped (AGL-2455).
 *   Nothing is stored for it.
 * - **Webhook.** Queued, never posted from the webhook, through the same
 *   outbox as the Buy-button path (AGL-2473): a deterministic id and
 *   `create()`, so a second pass cannot queue it twice or reset its retries.
 * - **Email.** Sent inline through Aglyn's own provider, like the receipt.
 *
 * The caller runs this once, behind the AGL-498 `created` guard, and it never
 * throws: a supplier that cannot be told is logged and stamped on the order's
 * timeline as routed only when the notice went out, and the paid order
 * stands.
 */

/** What the supplier is told about one line. */
export interface SupplierRoutedLine {
  productId: string
  name: string
  variantLabel?: string
  sku?: string
  quantity: number
}

/** The session fields the notice is built from. */
export interface SupplierRoutingSession {
  customer_details?: { email?: string | null; name?: string | null } | null
  shipping_details?: {
    name?: string | null
    address?: {
      line1?: string | null
      line2?: string | null
      city?: string | null
      state?: string | null
      postal_code?: string | null
      country?: string | null
    } | null
  } | null
}

export interface RouteCartOrderOptions {
  firestore: FirebaseFirestore.Firestore
  hostId: string
  orderId: string
  /** The number the merchant and supplier know the order by, e.g. `#12`. */
  orderLabel: string
  lineItems: readonly CommerceModel.OrderLineItem[]
  session: SupplierRoutingSession
  /** The host this request came in on; the tracking link is built on it. */
  requestHost: string
}

/** The callback token for one supplier on one order. */
export function supplierRoutingToken(
  hostId: string,
  orderId: string,
  supplierId: string,
): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`${hostId}:${orderId}:${supplierId}`)
    .digest('hex')
    .slice(0, 32)
}

/** The order's lines, grouped by the supplier that fulfills them. */
export function linesBySupplier(
  lineItems: readonly CommerceModel.OrderLineItem[],
): Map<string, SupplierRoutedLine[]> {
  const grouped = new Map<string, SupplierRoutedLine[]>()
  for (const line of lineItems) {
    const supplierId = String(line.supplierId ?? '')
    if (!supplierId) continue
    const lines = grouped.get(supplierId) ?? []
    lines.push({
      productId: String(line.productId ?? ''),
      name: String(line.name ?? 'Product'),
      ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      quantity: Number(line.quantity ?? 1),
    })
    grouped.set(supplierId, lines)
  }
  return grouped
}

function describeLine(line: SupplierRoutedLine): string {
  return (
    `${line.quantity}× ${line.name}` +
    (line.variantLabel ? ` (${line.variantLabel})` : '') +
    (line.sku ? `, SKU ${line.sku}` : '')
  )
}

/**
 * Notifies every supplier with lines on a paid cart order. Resolves once each
 * notice is queued or sent; never rejects.
 */
export async function routeCartOrderToSuppliers(
  options: RouteCartOrderOptions,
): Promise<void> {
  const { firestore, hostId, orderId, orderLabel, session, requestHost } =
    options
  const grouped = linesBySupplier(options.lineItems)
  if (grouped.size === 0) return
  try {
    const routedOrg = await getOrgForHost(hostId)
    if (!Aglyn.checkEntitlement(routedOrg?.org as any, 'dropshipRouting')) {
      return
    }
    const hostRef = firestore.collection('hosts').doc(hostId)
    const orderRef = hostRef.collection('orders').doc(orderId)
    const shipTo = session?.shipping_details?.address
      ? session.shipping_details
      : null
    const shippingName =
      shipTo?.name ?? session?.customer_details?.name ?? null
    const customerEmail = session?.customer_details?.email ?? null
    const shippingAddress = shipTo?.address
      ? {
          line1: shipTo.address.line1 ?? null,
          line2: shipTo.address.line2 ?? null,
          city: shipTo.address.city ?? null,
          state: shipTo.address.state ?? null,
          postalCode: shipTo.address.postal_code ?? null,
          country: shipTo.address.country ?? null,
        }
      : null
    let storeName: string | null = null
    const storeNameOnce = async () => {
      if (storeName !== null) return storeName
      storeName =
        resolveHostToken(
          'businessName',
          (await hostRef
            .get()
            .then((snapshot) => snapshot.data())
            .catch(() => undefined)) as HostTokenSource | undefined,
        ) ?? 'A store'
      return storeName
    }

    for (const [supplierId, lines] of grouped) {
      try {
        const supplier = (
          await hostRef.collection('suppliers').doc(supplierId).get()
        ).data() as CommerceModel.HostSupplier | undefined
        if (!supplier) continue
        const token = supplierRoutingToken(hostId, orderId, supplierId)
        const updateUrl =
          `https://${requestHost}/api/commerce/supplier-update` +
          `?hostId=${hostId}&orderId=${orderId}&token=${token}`
        const payload = {
          hostId,
          orderId,
          lines: lines.map((line) => ({
            productId: line.productId,
            productName: line.name,
            ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
            ...(line.sku ? { sku: line.sku } : {}),
            quantity: line.quantity,
          })),
          customerEmail,
          shippingName,
          shippingAddress,
          updateUrl,
        }
        let told = false
        if (supplier.webhookUrl) {
          const queued = await enqueueSupplierDelivery({
            firestore,
            hostId,
            orderId,
            supplierId,
            supplierName: String(supplier.name ?? ''),
            url: String(supplier.webhookUrl),
            body: JSON.stringify(payload),
          })
          told = told || queued !== 'skipped'
        }
        if (supplier.email) {
          const store = await storeNameOnce()
          const recipient = shippingName ?? customerEmail ?? 'the buyer'
          const address = shippingAddress
            ? [
                shippingAddress.line1,
                shippingAddress.line2,
                [
                  shippingAddress.city,
                  [shippingAddress.state, shippingAddress.postalCode]
                    .filter(Boolean)
                    .join(' '),
                ]
                  .filter(Boolean)
                  .join(', '),
                shippingAddress.country,
              ]
                .filter(Boolean)
                .join(', ')
            : ''
          const subject =
            lines.length === 1
              ? `New order to fulfill for ${store}: ${lines[0].name}`
              : `New order to fulfill for ${store}: ${lines.length} items`
          await sendEmail({
            to: supplier.email,
            subject,
            text:
              `${store} has a new order for you to ship (order ${orderLabel}):\n` +
              lines.map((line) => `- ${describeLine(line)}`).join('\n') +
              '\n\n' +
              (address
                ? `Ship to: ${recipient}, ${address}\n\n`
                : `Ship to: ${recipient}. No shipping address was ` +
                  `collected at checkout; ask ${store} for it.\n\n`) +
              'When it ships, open this link to enter the carrier and ' +
              `tracking number:\n${updateUrl}`,
            fromName: Aglyn.resolveBrandingProfile(routedOrg?.org as never)
              .fromName,
            sendingIdentity: await hostSendingIdentity(hostId),
            audience: 'tenant',
            context: 'dropship supplier notice',
            // Owed to the recipient by their own order (AGL-3356).
            owedFor: 'order',
          })
          // Cost meter (AGL-1438): transactional, the order needs it.
          await meterHostEmail(hostId)
          told = true
        }
        if (!told) continue
        await orderRef.set(
          {
            timeline: firebaseAdmin.firestore.FieldValue.arrayUnion({
              atMs: Date.now(),
              event: 'routed',
              detail:
                `Sent ${lines.length} line${lines.length === 1 ? '' : 's'} ` +
                `to supplier ${supplier.name}`,
            }),
          },
          { merge: true },
        )
      } catch (supplierError) {
        // One supplier failing never keeps the others from being told.
        console.error('Dropship routing failed', supplierId, supplierError)
      }
    }
  } catch (routingError) {
    console.error('Dropship routing failed', routingError)
  }
}
