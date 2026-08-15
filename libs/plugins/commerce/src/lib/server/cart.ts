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
import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { cartCookieName, isCartId, mintCartId, readCartId } from './cart-cookie'

export interface ResolvedCartLine extends CommerceModel.CartLine {
  name: string
  variantLabel?: string
  unitAmountCents: number
  imageUrl?: string
  /** Line no longer purchasable (deleted/draft/sold out). */
  unavailable?: boolean
}

/**
 * Server-backed cart (AGL-293): cookie-keyed doc under
 * `hosts/{hostId}/carts`. GET returns the resolved cart; POST mutates
 * with {action: add|set|remove|clear}. Lines resolve against product
 * docs on every read so prices/names never go stale, and unavailable
 * lines surface instead of silently charging.
 */
export const cartHandler: PluginApiHandler = async (req, res) => {
  const isPost = req.method === 'POST'
  if (!isPost && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body = isPost
    ? typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body ?? {})
    : {}
  // AGL-1769: BOTH components of the path this handler writes come from the
  // caller — `hostId` off the body, `cartId` off a cookie whose name embeds
  // `hostId` — and `.doc()` appends a slash-separated PATH rather than taking
  // one opaque id. So an unvalidated pair named the nesting as well as the
  // document: a `hostId` of `a/b/c` wrote under `hosts/a/b/c`, invisible to
  // every console list because they resolve the host doc first.
  //
  // This handler is the one visitor-facing write in the AGL-1763 sweep that
  // needs NO credentials — no session, no member gate, no signature — so it is
  // the one place the id rule has to hold on its own.
  const hostId = String((isPost ? body.hostId : req.query.hostId) ?? '')
  // The message names BOTH causes it now covers (`762621581`): the guard reads
  // as "absent" but also refuses a hostId that is a path rather than an id, and
  // a caller told only "missing" would go looking for the wrong mistake.
  if (!isCartId(hostId))
    return res.status(400).json({ error: 'Missing or invalid hostId' })

  const cookieName = cartCookieName(hostId)
  // A cookie that is not a single document id reads as NO cart: a GET returns
  // an empty one and a POST mints a fresh id below, exactly as for a first-time
  // visitor. Nothing is stranded — a path that was never a cart id was never a
  // basket anyone filled.
  let cartId = readCartId(req.cookies, hostId)
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)

  try {
    if (!cartId) {
      if (!isPost) return res.status(200).json({ lines: [], count: 0 })
      cartId = mintCartId()
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=${cartId}; Path=/; Max-Age=${60 * 60 * 24 * 90}; ` +
          'HttpOnly; SameSite=Lax; Secure',
      )
    }
    const cartRef = hostRef.collection('carts').doc(cartId)
    const cartSnapshot = await cartRef.get()
    const cart: CommerceModel.HostCart = (cartSnapshot.data() as any) ?? { lines: [] }

    if (isPost) {
      const action = String(body.action ?? 'add')
      const line: CommerceModel.CartLine = {
        productId: String(body.productId ?? ''),
        ...(body.variantId ? { variantId: String(body.variantId) } : {}),
        quantity: Math.round(Number(body.quantity ?? 1)),
      }
      if (action === 'clear') {
        cart.lines = []
      } else if (!line.productId) {
        return res.status(400).json({ error: 'Missing productId' })
      } else if (action === 'remove') {
        cart.lines = CommerceModel.removeCartLine(cart, line)
      } else {
        cart.lines = CommerceModel.upsertCartLine(
          cart,
          line,
          action === 'set' ? 'set' : 'add',
        )
      }
      // AGL-1769: never mint an EMPTY cart. `clear` returns above before the
      // `!line.productId` check, so `{ hostId, action: 'clear' }` — no
      // product, valid or otherwise, and no credentials — used to create a
      // document per request holding `lines: []` and two timestamps. A `remove`
      // or a `set 0` that empties an absent basket is the same request wearing
      // a productId. A cart that would store no lines is not a cart.
      //
      // AGL-1760's test — does refusing discard money or work that already
      // occurred — is passed trivially here: there is no basket to strand. The
      // caller still gets its cookie and its empty-cart response, so the next
      // add lands on this id and creates the document properly.
      if (cartSnapshot.exists || cart.lines.length > 0) {
        await cartRef.set(
          {
            lines: cart.lines,
            updatedAtMs: Date.now(),
            ...(cartSnapshot.exists ? {} : { createdAtMs: Date.now() }),
          },
          { merge: true },
        )
      }
    }

    // Resolve display lines from product docs — never trust stored data.
    const uniqueProductIds = [...new Set(cart.lines.map((l) => l.productId))]
    const productSnapshots = await Promise.all(
      uniqueProductIds.map((id) =>
        hostRef.collection('products').doc(id).get(),
      ),
    )
    const productsById = new Map(
      productSnapshots.map((snapshot) => [
        snapshot.id,
        snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data() as any) : null,
      ]),
    )
    const lines: ResolvedCartLine[] = cart.lines.map((line) => {
      const product = productsById.get(line.productId)
      if (!product || product.deletedAt || product.status !== 'active') {
        return {
          ...line,
          name: product?.name ?? 'Unavailable product',
          unitAmountCents: 0,
          unavailable: true,
        }
      }
      const variant = line.variantId
        ? product.variants.find((item) => item.id === line.variantId)
        : product.variants[0]
      if (!variant) {
        return {
          ...line,
          name: product.name,
          unitAmountCents: 0,
          unavailable: true,
        }
      }
      return {
        ...line,
        name: product.name,
        ...(Object.keys(variant.options ?? {}).length
          ? { variantLabel: Object.values(variant.options ?? {}).join(' / ') }
          : {}),
        unitAmountCents: Math.round(Number(variant.priceUsd) * 100),
        ...(variant.imageUrl || product.mediaUrls?.[0] || product.imageUrl
          ? {
              imageUrl:
                variant.imageUrl ??
                product.mediaUrls?.[0] ??
                product.imageUrl,
            }
          : {}),
        ...(CommerceModel.canPurchase(product, variant.id, line.quantity)
          ? {}
          : { unavailable: true }),
      }
    })
    const subtotalCents = lines
      .filter((line) => !line.unavailable)
      .reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0)
    return res.status(200).json({
      lines,
      count: CommerceModel.cartCount(cart),
      subtotalCents,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Cart unavailable' })
  }
}
