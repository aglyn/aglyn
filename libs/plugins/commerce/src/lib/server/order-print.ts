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

import { holdsCommerceSiteKey } from './commerce-site-keys'
import { commerceSitePermissionRefusal } from '../model/plugin-permissions'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { formatOrderNumber, liftLegacyOrder, type HostOrder } from '../model'
import { buildOrderInvoiceHtml, invoiceStoreFrom } from '../utils/order-invoice'
import { buildPackingSlipHtml } from '../utils/order-packing-slip'
import type { orderInvoicePdfFile } from './commerce-pdf'
import { sendPdf, type CommercePdfFile } from './pdf-response'
import { validId } from './products-write'

/*
 * `GET /api/commerce/order-print?hostId&orderId&kind` (AGL-3841): the order
 * dialog's "Packing slip" and "Invoice" for the native apps, which print them
 * through the device's own print sheet; and `kind=invoice-pdf` (AGL-4095), the
 * invoice as a branded PDF file, for the console's "Download PDF" and the apps.
 *
 * The console builds both pages in the browser from the order it is showing
 * (`utils/order-packing-slip.ts`, `utils/order-invoice.ts`) and prints them
 * from a popup. This route runs the same two builders over the stored order,
 * the site and its store settings, and answers the markup with the title the
 * popup has, so an app prints the console's own page rather than a copy of
 * its layout.
 *
 * Gate: who may read the order (`canReadHostSensitive` in the rules: the
 * site's `admin` and `editor`), or staff. A read, so a frozen site still
 * prints.
 */

export type OrderPrintKind = 'invoice' | 'packing-slip'

export const ORDER_PRINT_KINDS: readonly OrderPrintKind[] = ['invoice', 'packing-slip']

/** The invoice as a PDF file, rather than a page to print. */
export const ORDER_INVOICE_PDF_KIND = 'invoice-pdf'

type Firestore = FirebaseFirestore.Firestore

export interface OrderPrintDeps {
  firestore?: () => Firestore
  verifyIdToken?: (token: string) => Promise<Record<string, unknown> & { uid: string }>
  /** The invoice's PDF; loads the PDF writer and sharp only when asked. */
  invoicePdf?: (input: Parameters<typeof orderInvoicePdfFile>[0]) => Promise<CommercePdfFile>
}

/** The page and its title for one order: what the console's popup is given. */
export function orderPrintPage(
  kind: OrderPrintKind,
  input: {
    order: HostOrder
    orderId: string
    host?: Record<string, unknown> | null
    store?: Record<string, unknown> | null
  },
): { title: string; html: string } {
  const number = formatOrderNumber(input.order, input.orderId)
  if (kind === 'packing-slip') {
    return { title: `Packing slip ${number}`, html: buildPackingSlipHtml(input.order, input.orderId) }
  }
  return {
    title: `Invoice ${number}`,
    html: buildOrderInvoiceHtml({
      order: input.order,
      orderId: input.orderId,
      store: invoiceStoreFrom(input.host, input.store),
    }),
  }
}

export function createOrderPrintHandler(options: OrderPrintDeps = {}): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const firestore = options.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
    const verifyIdToken =
      options.verifyIdToken ?? ((token: string) => firebaseAdmin.app().auth().verifyIdToken(token) as never)
    const hostId = req.query['hostId']
    const orderId = req.query['orderId']
    const invoicePdf =
      options.invoicePdf ?? (async (input) => (await import('./commerce-pdf')).orderInvoicePdfFile(input))
    const kind = String(req.query['kind'] ?? '') as OrderPrintKind
    const asPdf = String(kind) === ORDER_INVOICE_PDF_KIND
    if (!validId(hostId) || !validId(orderId)) return res.status(400).json({ error: 'Missing site or order' })
    if (!asPdf && !ORDER_PRINT_KINDS.includes(kind)) {
      return res.status(400).json({ error: 'kind must be invoice, invoice-pdf or packing-slip' })
    }
    const authorization = String(req.headers.authorization ?? '')
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
    if (!token) return res.status(401).json({ error: 'Unauthenticated' })
    try {
      let decoded: Record<string, unknown> & { uid: string }
      try {
        decoded = await verifyIdToken(token)
      } catch (error) {
        // Only a refused token is the caller's; an Auth outage is a 500 (AGL-2852).
        if (!isRefusedIdToken(error)) throw error
        return res.status(401).json({ error: 'Sign in again to continue' })
      }
      const db = firestore()
      const hostRef = db.collection('hosts').doc(hostId)
      const host = await hostRef.get()
      if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
      // "Manage orders" (`commerce.orders`, AGL-4047), read as the rules would read it.
      if (decoded['staff'] !== true && !holdsCommerceSiteKey(host, decoded.uid, 'commerce.orders')) {
        return res.status(403).json({ error: commerceSitePermissionRefusal('commerce.orders') })
      }
      const [stored, store] = await Promise.all([
        hostRef.collection('orders').doc(orderId).get(),
        kind === 'invoice' || asPdf ? hostRef.collection('settings').doc('store').get() : Promise.resolve(null),
      ])
      if (!stored.exists) return res.status(404).json({ error: 'This order no longer exists' })
      const order = liftLegacyOrder((stored.data() ?? {}) as never)
      if (asPdf) {
        const file = await invoicePdf({
          hostId,
          orderId,
          order,
          host: host.data() as Record<string, unknown>,
          store: (store?.data() ?? null) as Record<string, unknown> | null,
        })
        return sendPdf(res, file)
      }
      return res.status(200).json(
        orderPrintPage(kind, {
          order,
          orderId,
          host: host.data() as Record<string, unknown>,
          store: (store?.data() ?? null) as Record<string, unknown> | null,
        }),
      )
    } catch (error) {
      console.error('[commerce/order-print]', error)
      return res.status(500).json({ error: 'The page could not be made' })
    }
  }
}

export const orderPrintHandler = createOrderPrintHandler()
