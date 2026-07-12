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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { randomBytes } from 'crypto'

export interface ResolvedCartLine extends Aglyn.CartLine {
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
  const hostId = String((isPost ? body.hostId : req.query.hostId) ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  const cookieName = `aglyn_cart_${hostId}`
  let cartId = String(req.cookies[cookieName] ?? '')
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)

  try {
    if (!cartId) {
      if (!isPost) return res.status(200).json({ lines: [], count: 0 })
      cartId = randomBytes(16).toString('hex')
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=${cartId}; Path=/; Max-Age=${60 * 60 * 24 * 90}; ` +
          'HttpOnly; SameSite=Lax; Secure',
      )
    }
    const cartRef = hostRef.collection('carts').doc(cartId)
    const cartSnapshot = await cartRef.get()
    const cart: Aglyn.HostCart = (cartSnapshot.data() as any) ?? { lines: [] }

    if (isPost) {
      const action = String(body.action ?? 'add')
      const line: Aglyn.CartLine = {
        productId: String(body.productId ?? ''),
        ...(body.variantId ? { variantId: String(body.variantId) } : {}),
        quantity: Math.round(Number(body.quantity ?? 1)),
      }
      if (action === 'clear') {
        cart.lines = []
      } else if (!line.productId) {
        return res.status(400).json({ error: 'Missing productId' })
      } else if (action === 'remove') {
        cart.lines = Aglyn.removeCartLine(cart, line)
      } else {
        cart.lines = Aglyn.upsertCartLine(
          cart,
          line,
          action === 'set' ? 'set' : 'add',
        )
      }
      await cartRef.set(
        {
          lines: cart.lines,
          updatedAtMs: Date.now(),
          ...(cartSnapshot.exists ? {} : { createdAtMs: Date.now() }),
        },
        { merge: true },
      )
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
        snapshot.exists ? Aglyn.liftLegacyProduct(snapshot.data() as any) : null,
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
        ...(Aglyn.canPurchase(product, variant.id, line.quantity)
          ? {}
          : { unavailable: true }),
      }
    })
    const subtotalCents = lines
      .filter((line) => !line.unavailable)
      .reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0)
    return res.status(200).json({
      lines,
      count: Aglyn.cartCount(cart),
      subtotalCents,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Cart unavailable' })
  }
}
