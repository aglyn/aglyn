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
import {
  hasPluginCheckoutExtras,
  quotePluginCheckoutExtras,
  type QuotedPluginCheckoutExtra,
} from '@aglyn/aglyn/plugin-manager/plugin-checkout-extras'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import * as CommerceModel from '../model'
import { readCartId } from './cart-cookie'

/**
 * Optional lines another plugin offers at the cart (AGL-3635) — package
 * protection is the first — through core's checkout-extras seam. Commerce
 * names no insurer: it asks the seam, shows each offer as a box, and charges
 * the ones the buyer ticked as ordinary lines on the session.
 *
 * Asked only for a basket that ships: an extra is about a parcel, and a cart
 * of downloads has none.
 */

/** How long the cart and checkout wait for an offer before selling without it. */
export const CHECKOUT_EXTRAS_TIMEOUT_MS = 2_500

/** One cart line, priced, as the extras quote reads it. */
export interface CheckoutExtrasLine {
  productId: string
  name: string
  sku?: string
  quantity: number
  unitCents: number
  physical: boolean
}

/** Every offer for a basket, or none. Never throws. */
export async function quoteCartExtras(input: {
  hostId: string
  lines: CheckoutExtrasLine[]
  destination?: { country?: string; postalCode?: string }
}): Promise<QuotedPluginCheckoutExtra[]> {
  if (!hasPluginCheckoutExtras()) return []
  const lines = input.lines.filter((line) => line.quantity > 0 && line.unitCents >= 0)
  if (!lines.some((line) => line.physical)) return []
  const itemsCents = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0)
  if (itemsCents <= 0) return []
  const country = String(input.destination?.country ?? '').trim().toUpperCase().slice(0, 2)
  const postalCode = String(input.destination?.postalCode ?? '').trim().slice(0, 12)
  return quotePluginCheckoutExtras(
    {
      hostId: input.hostId,
      // Every storefront session is charged in dollars today (`cart-checkout.ts`).
      currency: 'usd',
      itemsCents,
      lines: lines.map((line) => ({
        itemId: line.productId,
        name: line.name,
        ...(line.sku ? { sku: line.sku } : {}),
        quantity: line.quantity,
        unitCents: line.unitCents,
        ships: line.physical,
      })),
      ...(country || postalCode
        ? { destination: { ...(country ? { country } : {}), ...(postalCode ? { postalCode } : {}) } }
        : {}),
    },
    { timeoutMs: CHECKOUT_EXTRAS_TIMEOUT_MS },
  )
}

/** What the cart shows of an offer: never the quote id. */
export interface CartExtraView {
  id: string
  label: string
  description?: string
  amountCents: number
  defaultSelected: boolean
  termsUrl?: string
}

export function cartExtraView(extra: QuotedPluginCheckoutExtra): CartExtraView {
  return {
    id: extra.id,
    label: extra.label,
    ...(extra.description ? { description: extra.description } : {}),
    amountCents: extra.amountCents,
    defaultSelected: extra.defaultSelected,
    ...(extra.termsUrl ? { termsUrl: extra.termsUrl } : {}),
  }
}

/**
 * `GET /api/commerce/cart-extras?hostId=…` — the offers for the visitor's own
 * cart (cookie). Asked by the cart when it is SHOWN, never by the badge on
 * every page. A store with no offering plugin answers `[]` without reading a
 * document. `private, no-store`: the answer is this basket's.
 */
export const cartExtrasHandler: PluginApiHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const hostId = String(req.query.hostId ?? '')
  if (!isDocumentId(hostId)) return res.status(400).json({ error: 'Missing or invalid hostId' })
  if (!hasPluginCheckoutExtras()) return res.status(200).json({ extras: [] })
  const cartId = readCartId(req.cookies, hostId)
  if (!cartId) return res.status(200).json({ extras: [] })
  try {
    const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
    const cart = ((await hostRef.collection('carts').doc(cartId).get()).data() as CommerceModel.HostCart | undefined) ?? {
      lines: [],
    }
    const lines = await resolveCartExtrasLines(hostRef, cart.lines ?? [])
    const extras = await quoteCartExtras({
      hostId,
      lines,
      destination: {
        country: String(req.query.country ?? ''),
        postalCode: String(req.query.postalCode ?? ''),
      },
    })
    return res.status(200).json({ extras: extras.map(cartExtraView) })
  } catch (error) {
    console.error('cart extras failed', error)
    // An offer is never worth a broken cart.
    return res.status(200).json({ extras: [] })
  }
}

/** The cart's purchasable lines, priced from the product documents. */
async function resolveCartExtrasLines(
  hostRef: FirebaseFirestore.DocumentReference,
  cartLines: CommerceModel.CartLine[],
): Promise<CheckoutExtrasLine[]> {
  const ids = [...new Set(cartLines.map((line) => line.productId))].filter((id) => isDocumentId(id))
  const snapshots = await Promise.all(ids.map((id) => hostRef.collection('products').doc(id).get()))
  const products = new Map(
    snapshots.map((snapshot) => [
      snapshot.id,
      snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data() as never) : null,
    ]),
  )
  const lines: CheckoutExtrasLine[] = []
  for (const line of cartLines) {
    const product = products.get(line.productId)
    if (!product || product.deletedAt || product.status !== 'active') continue
    const variant = line.variantId
      ? product.variants.find((item) => item.id === line.variantId)
      : product.variants[0]
    if (!variant || !CommerceModel.variantHasPrice(variant)) continue
    lines.push({
      productId: line.productId,
      name: product.name,
      ...(variant.sku ? { sku: variant.sku } : {}),
      quantity: Math.max(0, Math.round(Number(line.quantity) || 0)),
      unitCents: Math.round(Number(variant.priceUsd) * 100),
      physical: (product.type ?? 'physical') === 'physical',
    })
  }
  return lines
}
