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
import { createHmac } from 'crypto'

/**
 * Signing secret for commerce tokens (AGL-509). A dedicated env var with NO
 * fallback: the previous `STRIPE_SECRET_KEY ?? 'aglyn'` recipe made download
 * and supplier tokens forgeable on any deploy that had not set the Stripe key
 * (payloads like `download:${hostId}:${orderId}` are guessable). Fails closed.
 */
export function tokenSigningSecret(): string {
  const secret = process.env.TOKEN_SIGNING_SECRET
  if (!secret) {
    throw new Error('TOKEN_SIGNING_SECRET is not configured')
  }
  return secret
}

/**
 * Order-scoped download token (AGL-302); no expiry — limits gate use.
 */
export function mintDownloadToken(hostId: string, orderId: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`download:${hostId}:${orderId}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Digital delivery (AGL-302): token-gated download for a paid order's
 * digital product. Buyers always get the product's CURRENT files (new
 * versions re-deliver automatically); attempts count against the
 * product's download limit per order.
 */
export const downloadHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  const orderId = String(req.query.orderId ?? '')
  const token = String(req.query.token ?? '')
  const productId = String(req.query.productId ?? '')
  const fileIndex = Math.max(0, Number(req.query.file ?? 0))
  if (!hostId || !orderId || !token || !productId) {
    return res.status(400).send('Missing parameters')
  }
  if (token !== mintDownloadToken(hostId, orderId)) {
    return res.status(403).send('Invalid download link')
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const orderRef = hostRef.collection('orders').doc(orderId)
    const [orderSnapshot, productSnapshot] = await Promise.all([
      orderRef.get(),
      hostRef.collection('products').doc(productId).get(),
    ])
    if (!orderSnapshot.exists) return res.status(404).send('Unknown order')
    const order = CommerceModel.liftLegacyOrder(orderSnapshot.data() as any)
    if (['pending', 'cancelled', 'refunded'].includes(order.status)) {
      return res.status(403).send('This order cannot download files')
    }
    const owns =
      (order.lineItems ?? []).some((line) => line.productId === productId) ||
      order.productId === productId
    if (!owns) return res.status(403).send('Not part of this order')
    const product = CommerceModel.liftLegacyProduct(
      (productSnapshot.data() as any) ?? {},
    )
    const file = product.digitalFiles?.[fileIndex]
    if (!file?.url) return res.status(404).send('No file available')

    // Attempt accounting per order+product.
    const attemptsKey = `downloadAttempts.${productId}`
    const attempts = Number(
      (orderSnapshot.get('downloadAttempts') ?? {})[productId] ?? 0,
    )
    if (
      product.downloadLimit != null &&
      attempts >= Math.max(1, product.downloadLimit)
    ) {
      return res
        .status(429)
        .send('Download limit reached — contact the seller for help')
    }
    await orderRef
      .set(
        {
          downloadAttempts: {
            ...((orderSnapshot.get('downloadAttempts') as any) ?? {}),
            [productId]: attempts + 1,
          },
        },
        { merge: true },
      )
      .catch(() => undefined)
    void attemptsKey
    res.setHeader('Cache-Control', 'no-store')
    return res.redirect(302, file.url)
  } catch (error) {
    console.error(error)
    return res.status(500).send('Download unavailable')
  }
}
