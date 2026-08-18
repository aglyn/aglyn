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

import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForUser,
  isImpersonationSession,
  lockdownRefusal,
  recordAssistFeedback,
} from '@aglyn/tenant-data-admin'

/**
 * Aglyn Assist thumbs feedback (AGL-1860 data loop). Membership-gated: the
 * exchange lives under the caller's org, and only the two literal values
 * are accepted. No entitlement/flag gate — feedback on an exchange the org
 * already holds is always welcome, and the panel only offers the control
 * where the flag shows the panel at all.
 *
 * Lockdown IS wired (AGL-1506): this writes to the org's own subtree, and a
 * locked org's writes stop here like everywhere else. The exemptions are for
 * surfaces that must stay reachable while locked (sign-out, the notice,
 * support, self-serve billing) — a thumbs rating is not one of them.
 */
async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  let payload: Record<string, unknown> | null
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    payload = null
  }
  const orgId = String(payload?.orgId ?? '').trim()
  const exchangeId = String(payload?.exchangeId ?? '').trim()
  const feedback = payload?.feedback
  if (!orgId || !exchangeId || (feedback !== 'up' && feedback !== 'down')) {
    return Response.json(
      { error: 'Missing orgId, exchangeId, or feedback (up|down)' },
      { status: 400 },
    )
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const resolved = await getOrgForUser(decoded.uid, orgId)
    if (!resolved || resolved.orgId !== orgId) {
      return Response.json(
        { error: 'You are not a member of that organization' },
        { status: 403 },
      )
    }
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (resolved.org ?? {}) as Record<string, unknown>,
    })
    if (locked) return locked

    const recorded = await recordAssistFeedback(
      app.firestore(),
      orgId,
      exchangeId,
      feedback,
    )
    if (!recorded) {
      return Response.json({ error: 'Unknown exchange' }, { status: 404 })
    }
    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Feedback failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
