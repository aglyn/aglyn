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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import {
  mintMemberSession,
  setMemberCookie,
  verifyMemberPassword,
} from './membership'

// Best-effort per-instance brute-force damper (mirrors AGL-87 unlock).
const attemptsByIp = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10

/** Site member sign-in (AGL-109); sets the session cookie on success. */
export const membershipLoginHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase()
  const password = String(req.body?.password ?? '')
  if (!hostId || !email || !password) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown',
  ).split(',')[0]
  const now = Date.now()
  const attempts = (attemptsByIp.get(ip) ?? []).filter(
    (at) => now - at < WINDOW_MS,
  )
  attempts.push(now)
  attemptsByIp.set(ip, attempts)
  if (attempts.length > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const membersQuery = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('siteMembers')
      .where('email', '==', email)
      .limit(1)
      .get()
    const memberDoc = membersQuery.docs[0]
    if (
      !memberDoc ||
      !verifyMemberPassword(password, memberDoc.get('passwordScrypt'))
    ) {
      return res.status(401).json({ error: 'Wrong email or password' })
    }
    // Event trigger (AGL-128/148).
    await emitHostEvent(hostId, 'memberSignIn', { email })
    // Cart linkage (AGL-294): stamp the guest cart with the member so
    // abandoned-cart and analytics can attribute it.
    const cartId = String(req.cookies?.[`aglyn_cart_${hostId}`] ?? '')
    if (cartId) {
      await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('carts')
        .doc(cartId)
        .set({ customerId: memberDoc.id }, { merge: true })
        .catch(() => undefined)
    }
    setMemberCookie(res, hostId, mintMemberSession(hostId, memberDoc.id))
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Sign-in failed' })
  }
}
