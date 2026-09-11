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
import {
  createPaidMediaDeliveryIo,
  firebaseAdmin,
  PAID_DOWNLOAD_LINK_TTL_MS,
  resolvePaidMediaDelivery,
} from '@aglyn/tenant-data-admin'
import { createHmac, timingSafeEqual } from 'crypto'

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

/** Download links expire 90 days after minting (AGL-514). */
const DOWNLOAD_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000

function signDownload(hostId: string, orderId: string, exp: number): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`download:${hostId}:${orderId}:${exp}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Order-scoped download token (AGL-302). Carries an embedded expiry (AGL-514)
 * so a leaked receipt link doesn't grant perpetual re-download; the per-order
 * download limit still bounds use within the window. Format: `${expMs}.${sig}`.
 */
export function mintDownloadToken(hostId: string, orderId: string): string {
  const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS
  return `${exp}.${signDownload(hostId, orderId, exp)}`
}

/** Constant-time verify of a download token, including its expiry. */
export function verifyDownloadToken(
  hostId: string,
  orderId: string,
  token: string,
): boolean {
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const exp = Number(token.slice(0, dot))
  const sig = token.slice(dot + 1)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  const expected = signDownload(hostId, orderId, exp)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
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
  if (!verifyDownloadToken(hostId, orderId, token)) {
    return res.status(403).send('Invalid or expired download link')
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
    // ONE ENTITLEMENT TEST, AND IT KNOWS ABOUT PARTIAL REFUNDS (AGL-2454).
    //
    // This used to be a status test against the literal `'refunded'` followed
    // by an ownership test, and `refund.ts` writes that literal only when the
    // order is FULLY refunded — so a 99%-refunded order stayed `paid` and this
    // gate went on serving the files. The two questions are now one call, and
    // it also answers "was THIS line refunded by name", which is the case a
    // line-scoped refund creates.
    //
    // The order-level refusal is kept separate from the ownership one so the
    // shopper is told which of the two happened; collapsing them would answer
    // "not part of this order" to a buyer whose own order was cancelled.
    if (!CommerceModel.orderEntitlesProduct(order, 'any')) {
      return res.status(403).send('This order cannot download files')
    }
    if (!CommerceModel.orderContainsProduct(order, productId)) {
      return res.status(403).send('Not part of this order')
    }
    if (!CommerceModel.orderEntitlesProduct(order, productId)) {
      return res.status(403).send('This purchase was refunded')
    }
    const product = CommerceModel.liftLegacyProduct(
      (productSnapshot.data() as any) ?? {},
    )
    const file = product.digitalFiles?.[fileIndex]
    if (!file?.url) return res.status(404).send('No file available')

    /**
     * Where the redirect lands, decided BEFORE an attempt is counted
     * (AGL-2847).
     *
     * Everything above only guards the 302, so what the 302 points at is what
     * a buyer, and anyone they forward the `Location` to, keeps. The resolver
     * hands back a link that expires, or nothing: a CDN URL signed for
     * {@link PAID_DOWNLOAD_LINK_TTL_MS} for a PRIVATE file in this site's
     * library or its org's, a V4 signed Storage read for an object no media
     * document owns, or an author-typed hotlink unchanged. A raw Storage
     * download URL is never the answer, and a file that is still public is
     * refused, because its URL already works for anyone forever.
     *
     * Resolving first means a refusal costs the buyer no attempt: the limit
     * meters files that were handed out, not the seller's setup.
     *
     * `?download=1` rides inside the signed URL and makes the CDN answer with
     * `attachment`. The signature covers `(scope, mediaId, exp)` and not the
     * parameter, so it chooses a disposition for the one file signed and can
     * reach no other.
     */
    const delivery = await resolvePaidMediaDelivery({
      stored: file.url,
      hostId,
      ttlMs: PAID_DOWNLOAD_LINK_TTL_MS,
      cdnParams: [['download', '1']],
      io: createPaidMediaDeliveryIo({
        firestore,
        bucket: firebaseAdmin
          .app()
          .storage()
          .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET']),
      }),
    })
    if (delivery.ok === false) {
      res.setHeader('Cache-Control', 'no-store')
      console.error(
        '[commerce/download] paid file not delivered',
        JSON.stringify({
          hostId,
          orderId,
          productId,
          file: fileIndex,
          refusal: delivery.refusal,
        }),
      )
      return delivery.refusal === 'not-private'
        ? res
            .status(409)
            .send('This file is not ready to download yet — contact the seller')
        : res.status(404).send('No file available')
    }

    // ATTEMPT ACCOUNTING, IN ONE TRANSACTION (AGL-2275).
    //
    // This was a read-then-write across an await, from a snapshot fetched
    // before the check, with the failure swallowed — so N parallel requests
    // all read the same count, all passed the limit, and all wrote
    // `attempts + 1`. The counter advanced by one for N downloads, which
    // makes `downloadLimit` unenforceable rather than merely approximate: a
    // buyer who fans out ten requests takes ten copies against a limit of one.
    // For a paid digital product that is the merchant's goods given away.
    //
    // It also wrote the WHOLE `downloadAttempts` map back from that stale
    // snapshot, so a concurrent download of a DIFFERENT product in the same
    // order had its increment erased.
    //
    // The half-finished conversion was visible in the file: `attemptsKey`
    // built the dotted path `downloadAttempts.{productId}` and the next line
    // threw it away with `void attemptsKey`. The dotted path is the right
    // instrument and needs `update()` — which merges only that nested key, and
    // whose "document must exist" precondition the transaction's own read has
    // just satisfied. `set(..., { merge: true })` cannot express it: a dotted
    // key there is a literal field name with a dot in it.
    const attemptsKey = `downloadAttempts.${productId}`
    const limit =
      product.downloadLimit != null
        ? Math.max(1, product.downloadLimit)
        : null
    const withinLimit = await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(orderRef)
      if (!fresh.exists) return false
      const attempts = Number(
        (fresh.get('downloadAttempts') ?? {})[productId] ?? 0,
      )
      if (limit != null && attempts >= limit) return false
      transaction.update(orderRef, { [attemptsKey]: attempts + 1 })
      return true
    })
    if (!withinLimit) {
      return res
        .status(429)
        .send('Download limit reached — contact the seller for help')
    }
    // Per-order and time-boxed: no cache may keep a redirect that carries a
    // signature past the link it opens.
    res.setHeader('Cache-Control', 'no-store')
    // The link dies within the hour, so a refund, an expired receipt token or
    // a spent limit also ends what a forwarded `Location` can fetch: the next
    // download has to come back through this route and its checks.
    return res.redirect(302, delivery.location)
  } catch (error) {
    console.error(error)
    return res.status(500).send('Download unavailable')
  }
}
