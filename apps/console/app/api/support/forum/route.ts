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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForUser,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

const MAX_BODY = 5000
const FORUM_CATEGORIES = ['General', 'Building', 'Showcase', 'Feedback']

/**
 * Community forum (AGL-142): categories → threads → replies, open to paid
 * subscribers (staff always). Data at `forumThreads/{id}` + `replies`,
 * absent from the Firestore rules by design — reads and writes pass this
 * route so the paid gate can't be bypassed. Author display names come
 * from community profiles when present, else the email local part.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body: payload, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = app.firestore()
    const isStaff = Boolean(decoded['staff'])

    // Paid gate rides the caller's org plan (AGL-238).
    const paid = async () => {
      if (isStaff) return true
      const resolved = await getOrgForUser(decoded.uid)
      const plan = resolved?.org?.plan
      return Boolean(plan && plan !== 'free')
    }
    if (!(await paid())) {
      return Response.json({
        error: 'The community forum is for paid plans — see Billing',
      }, { status: 403 })
    }

    const authorName = async () => {
      // Prefer the personal account the user actually edits (Manage →
      // Profile writes users/{uid}). `profiles/{uid}` used to be the only
      // source, but its editor was the community page — retiring that with
      // AGL-653 would have silently dropped every forum author back to an
      // email prefix. Legacy profile values still win over that fallback.
      const [account, profile] = await Promise.all([
        firestore.collection('users').doc(decoded.uid).get(),
        firestore.collection('profiles').doc(decoded.uid).get(),
      ])
      const fullName = [account.get('firstName'), account.get('lastName')]
        .filter((part) => typeof part === 'string' && part.trim())
        .join(' ')
        .trim()
      return (
        fullName ||
        profile.get('displayName') ||
        profile.get('handle') ||
        (decoded.email ? String(decoded.email).split('@')[0] : 'member')
      )
    }

    const threadsRef = firestore.collection('forumThreads')

    if (method === 'GET') {
      const threadId = String(query['threadId'] ?? '')
      if (threadId) {
        const threadSnapshot = await threadsRef.doc(threadId).get()
        if (!threadSnapshot.exists) {
          return Response.json({ error: 'Unknown thread' }, { status: 404 })
        }
        const replies = await threadsRef
          .doc(threadId)
          .collection('replies')
          .orderBy('createdAt', 'asc')
          .limit(200)
          .get()
        return Response.json({
          thread: { $id: threadSnapshot.id, ...threadSnapshot.data() },
          replies: replies.docs.map((doc) => ({
            $id: doc.id,
            ...doc.data(),
            createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          })),
        }, { status: 200 })
      }
      const category = String(query['category'] ?? '')
      const listQuery = category
        ? threadsRef.where('category', '==', category).limit(100)
        : threadsRef.orderBy('updatedAt', 'desc').limit(100)
      const snapshot = await listQuery.get()
      return Response.json({
        categories: FORUM_CATEGORIES,
        threads: snapshot.docs.map((doc) => ({
          $id: doc.id,
          ...doc.data(),
          createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          updatedAt: doc.get('updatedAt')?.toMillis?.() ?? null,
        })),
      }, { status: 200 })
    }

    if (method === 'POST') {
      const title = String(payload?.title ?? '')
        .trim()
        .slice(0, 150)
      const body = String(payload?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      const category = FORUM_CATEGORIES.includes(String(payload?.category))
        ? String(payload?.category)
        : 'General'
      if (!title || !body) {
        return Response.json({ error: 'Missing title or body' }, { status: 400 })
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
      return Response.json({ threadId: threadRef.id }, { status: 200 })
    }

    if (method === 'PATCH') {
      const threadId = String(payload?.threadId ?? '')
      const body = String(payload?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      if (!threadId || !body) {
        return Response.json({ error: 'Missing thread or reply' }, { status: 400 })
      }
      const threadSnapshot = await threadsRef.doc(threadId).get()
      if (!threadSnapshot.exists) {
        return Response.json({ error: 'Unknown thread' }, { status: 404 })
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
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Forum operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST, handler as PATCH }
