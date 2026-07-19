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
import { requireActiveMember } from './membership'
import { checkMemberEntitlement } from './gate'

/**
 * Member feed (AGL-316): posts the signed-in member is entitled to —
 * unscoped posts need any live subscription; product-scoped posts need
 * that product's entitlement. Server-enforced; bodies never reach
 * non-members.
 */
export const memberFeedHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  try {
    // Suspension gate (AGL-550): a suspended member's cookie (AGL-546)
    // no longer reads the feed — 403'd with the cookie cleared.
    const auth = await requireActiveMember(req, res, hostId, 'Sign in first')
    if (!auth) return
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const email = String(auth.member.get('email') ?? '')
    if (!email) return res.status(401).json({ error: 'Sign in first' })

    const postsSnapshot = await hostRef
      .collection('memberPosts')
      .limit(50)
      .get()
    const entitlementCache = new Map<string, boolean>()
    const posts: Array<{
      id: string
      title: string
      body: string
      createdAtMs: number
    }> = []
    for (const docSnapshot of postsSnapshot.docs) {
      const scope = String(docSnapshot.get('productId') ?? '') || 'any'
      if (!entitlementCache.has(scope)) {
        entitlementCache.set(
          scope,
          await checkMemberEntitlement(hostId, email, scope),
        )
      }
      if (!entitlementCache.get(scope)) continue
      posts.push({
        id: docSnapshot.id,
        title: String(docSnapshot.get('title') ?? ''),
        body: String(docSnapshot.get('body') ?? ''),
        createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
      })
    }
    posts.sort((a, b) => b.createdAtMs - a.createdAtMs)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({ posts })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Feed unavailable' })
  }
}
