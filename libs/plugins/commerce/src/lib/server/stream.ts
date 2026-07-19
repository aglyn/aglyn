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
import { requireActiveMember } from './membership'
import { checkMemberEntitlement } from './gate'

const TTL_MS = 15 * 60 * 1000

function sign(hostId: string, productId: string, video: number, exp: number) {
  return createHmac('sha256', process.env.STRIPE_SECRET_KEY ?? 'aglyn')
    .update(`stream:${hostId}:${productId}:${video}:${exp}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Gated video streaming (AGL-315). POST (member session) checks the
 * entitlement and mints a short-TTL signed URL; GET with a valid
 * signature redirects to the media — shared links die within 15
 * minutes, and the mint step is the server-enforced gate.
 */
export const streamHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(
    (req.method === 'POST' ? req.body?.hostId : req.query.hostId) ?? '',
  )
  const productId = String(
    (req.method === 'POST' ? req.body?.productId : req.query.productId) ?? '',
  )
  const video = Math.max(
    0,
    Number(
      (req.method === 'POST' ? req.body?.video : req.query.video) ?? 0,
    ),
  )
  if (!hostId || !productId) {
    return res.status(400).json({ error: 'Missing hostId or productId' })
  }

  try {
    if (req.method === 'POST') {
      // Suspension gate (AGL-550): suspended members (AGL-546) cannot
      // mint stream URLs — 403'd with the session cookie cleared.
      const auth = await requireActiveMember(req, res, hostId, 'Sign in first')
      if (!auth) return
      const email = String(auth.member.get('email') ?? '')
      const entitled =
        email && (await checkMemberEntitlement(hostId, email, productId))
      if (!entitled) {
        return res.status(403).json({ error: 'Not entitled' })
      }
      const exp = Date.now() + TTL_MS
      const url =
        `/api/commerce/stream?hostId=${encodeURIComponent(hostId)}` +
        `&productId=${encodeURIComponent(productId)}&video=${video}` +
        `&exp=${exp}&sig=${sign(hostId, productId, video, exp)}`
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({ url, expiresAtMs: exp })
    }

    // GET: signature + expiry gate, then redirect to the media.
    const exp = Number(req.query.exp ?? 0)
    const sig = String(req.query.sig ?? '')
    if (!exp || exp < Date.now() || sig !== sign(hostId, productId, video, exp)) {
      return res.status(403).send('Link expired — reload the page')
    }
    const productSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('products')
      .doc(productId)
      .get()
    const product = CommerceModel.liftLegacyProduct(
      (productSnapshot.data() as any) ?? {},
    )
    const file = product.gatedVideos?.[video]
    if (!file?.url) return res.status(404).send('No video')
    res.setHeader('Cache-Control', 'private, no-store')
    return res.redirect(302, file.url)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Stream unavailable' })
  }
}
