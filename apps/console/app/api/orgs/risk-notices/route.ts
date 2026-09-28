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

/**
 * A workspace's HOLDS & REVIEWS (AGL-3368): the risk notices its owners and
 * admins were sent, and the one thing they can do about a hold — ask for a
 * review.
 *
 * - `GET ?orgId=` lists the notices, newest first, rendered from the risk
 *   notice catalog's OWNER half with each item's review state. Never the
 *   evidence, the signals or staff's notes: a fraud actor is a workspace
 *   owner too.
 * - `POST { orgId, noticeId, note }` requests a review. It APPENDS a note to
 *   the notice's existing abuse-queue row and alerts staff; it never writes
 *   the row's status or its held send, so no owner can release a hold or
 *   lift a lock from here.
 *
 * Owners and admins only; staff may read.
 */

// lockdown-423: exempt — the appeal path. A locked workspace's owners must still be able to read why
// and ask for a review; it writes only a note onto the platform's own abuse-queue row, never to the
// workspace.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listOwnerRiskNotices,
  requestRiskReview,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

const MANAGER_ROLES = new Set(['owner', 'admin'])

/** Firestore ids the notice seam mints: 40 hex. */
const NOTICE_ID = /^[a-f0-9]{40}$/

async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = String((method === 'GET' ? query.orgId : body?.orgId) ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    const isManager = MANAGER_ROLES.has(String(actor?.member?.role))

    if (method === 'GET') {
      if (!isManager && !isStaff) {
        return Response.json(
          { error: 'Holds and reviews are for the workspace’s owners and admins' },
          { status: 403 },
        )
      }
      const notices = await listOwnerRiskNotices({ orgId, viewerUid: decoded.uid })
      return Response.json(
        { notices },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // A review is asked for by the workspace, never on its behalf.
    if (!isManager) {
      return Response.json(
        { error: 'Only the workspace’s owners and admins can request a review' },
        { status: 403 },
      )
    }
    const noticeId = String(body?.noticeId ?? '')
    if (!NOTICE_ID.test(noticeId)) {
      return Response.json({ error: 'Malformed noticeId' }, { status: 400 })
    }
    const outcome = await requestRiskReview({
      orgId,
      noticeId,
      uid: decoded.uid,
      email: decoded.email ? String(decoded.email) : null,
      note: String(body?.note ?? ''),
    })
    if ('error' in outcome) {
      return Response.json({ error: outcome.error }, { status: outcome.status })
    }
    return Response.json(
      { ok: true, reference: outcome.reference, requestedAtMs: outcome.requestedAtMs },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[orgs/risk-notices] failed', error)
    return Response.json({ error: 'Holds and reviews failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
