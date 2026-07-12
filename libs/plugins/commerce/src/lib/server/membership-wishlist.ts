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
import { readMemberSession } from './membership'

/**
 * Member wishlist (AGL-297): product ids on the siteMembers doc.
 * Guests keep theirs in localStorage; the wishlist block merges the
 * local list into the member's on first signed-in read.
 */
export const membershipWishlistHandler: PluginApiHandler = async (req, res) => {
  const isPost = req.method === 'POST'
  if (!isPost && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(
    (isPost ? req.body?.hostId : req.query.hostId) ?? '',
  )
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  const memberId = readMemberSession(req, hostId)
  if (!memberId) return res.status(401).json({ error: 'Not signed in' })

  try {
    const memberRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('siteMembers')
      .doc(memberId)
    const snapshot = await memberRef.get()
    if (!snapshot.exists) return res.status(401).json({ error: 'Not signed in' })
    let wishlist: string[] = (snapshot.get('wishlist') ?? []) as string[]

    if (isPost) {
      const action = String(req.body?.action ?? 'add')
      if (action === 'merge') {
        const incoming = Array.isArray(req.body?.productIds)
          ? (req.body.productIds as string[]).map(String).slice(0, 100)
          : []
        wishlist = [...new Set([...wishlist, ...incoming])].slice(0, 200)
      } else {
        const productId = String(req.body?.productId ?? '')
        if (!productId) {
          return res.status(400).json({ error: 'Missing productId' })
        }
        wishlist =
          action === 'remove'
            ? wishlist.filter((id) => id !== productId)
            : [...new Set([...wishlist, productId])].slice(0, 200)
      }
      await memberRef.set({ wishlist }, { merge: true })
    }
    return res.status(200).json({ productIds: wishlist })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Wishlist unavailable' })
  }
}
