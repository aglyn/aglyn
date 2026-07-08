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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveTenantPermissions } from '../../../utils/server/tenant-permissions'

const MAX_BODY = 5000
const FORUM_CATEGORIES = ['General', 'Building', 'Showcase', 'Feedback']

/**
 * Community forum (AGL-142): categories → threads → replies, open to paid
 * subscribers (staff always). Data at `forumThreads/{id}` + `replies`,
 * absent from the Firestore rules by design — reads and writes pass this
 * route so the paid gate can't be bypassed. Author display names come
 * from community profiles when present, else the email local part.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    const firestore = app.firestore()
    const isStaff = Boolean(decoded['staff'])
    const membership = await resolveTenantPermissions(decoded.uid)

    const paid = async () => {
      if (isStaff) return true
      const tenantSnapshot = await firestore
        .collection('tenants')
        .doc(membership.ownerUid)
        .get()
      const plan = tenantSnapshot.get('plan')
      return Boolean(plan && plan !== 'free')
    }
    if (!(await paid())) {
      return res.status(403).json({
        error: 'The community forum is for paid plans — see Billing',
      })
    }

    const authorName = async () => {
      const profile = await firestore
        .collection('profiles')
        .doc(decoded.uid)
        .get()
      return (
        profile.get('displayName') ??
        profile.get('handle') ??
        (decoded.email ? String(decoded.email).split('@')[0] : 'member')
      )
    }

    const threadsRef = firestore.collection('forumThreads')

    if (req.method === 'GET') {
      const threadId = String(req.query['threadId'] ?? '')
      if (threadId) {
        const threadSnapshot = await threadsRef.doc(threadId).get()
        if (!threadSnapshot.exists) {
          return res.status(404).json({ error: 'Unknown thread' })
        }
        const replies = await threadsRef
          .doc(threadId)
          .collection('replies')
          .orderBy('createdAt', 'asc')
          .limit(200)
          .get()
        return res.status(200).json({
          thread: { $id: threadSnapshot.id, ...threadSnapshot.data() },
          replies: replies.docs.map((doc) => ({
            $id: doc.id,
            ...doc.data(),
            createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          })),
        })
      }
      const category = String(req.query['category'] ?? '')
      const listQuery = category
        ? threadsRef.where('category', '==', category).limit(100)
        : threadsRef.orderBy('updatedAt', 'desc').limit(100)
      const snapshot = await listQuery.get()
      return res.status(200).json({
        categories: FORUM_CATEGORIES,
        threads: snapshot.docs.map((doc) => ({
          $id: doc.id,
          ...doc.data(),
          createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          updatedAt: doc.get('updatedAt')?.toMillis?.() ?? null,
        })),
      })
    }

    if (req.method === 'POST') {
      const title = String(req.body?.title ?? '')
        .trim()
        .slice(0, 150)
      const body = String(req.body?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      const category = FORUM_CATEGORIES.includes(String(req.body?.category))
        ? String(req.body?.category)
        : 'General'
      if (!title || !body) {
        return res.status(400).json({ error: 'Missing title or body' })
      }
      const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
      const threadRef = threadsRef.doc()
      await threadRef.set({
        title,
        body,
        category,
        authorId: decoded.uid,
        authorName: await authorName(),
        staff: isStaff,
        replyCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      return res.status(200).json({ threadId: threadRef.id })
    }

    if (req.method === 'PATCH') {
      const threadId = String(req.body?.threadId ?? '')
      const body = String(req.body?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      if (!threadId || !body) {
        return res.status(400).json({ error: 'Missing thread or reply' })
      }
      const threadSnapshot = await threadsRef.doc(threadId).get()
      if (!threadSnapshot.exists) {
        return res.status(404).json({ error: 'Unknown thread' })
      }
      const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
      await threadsRef.doc(threadId).collection('replies').add({
        authorId: decoded.uid,
        authorName: await authorName(),
        staff: isStaff,
        body,
        createdAt: now,
      })
      await threadsRef.doc(threadId).set(
        {
          replyCount: firebaseAdmin.firestore.FieldValue.increment(1),
          updatedAt: now,
        },
        { merge: true },
      )
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Forum operation failed' })
  }
}
