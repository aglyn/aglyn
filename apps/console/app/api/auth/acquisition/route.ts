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

import type { AcquisitionDoor } from '@aglyn/aglyn/app-utils/account-acquisition'
import { readFirstTouchCookie } from '@aglyn/shared-util-first-touch'
import { firebaseAdmin, isImpersonationSession } from '@aglyn/tenant-data-admin'
import { recordAccountAcquisition } from '@aglyn/tenant-data-admin/server/account-acquisition'
import { findUserByUidAcrossPools } from '@aglyn/tenant-data-admin/server/auth-pools'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — records the caller's own sign-up attribution while the account is being created; pre-org, so no org, host or user scope exists to bind a verdict to, and the session mint carries the scope gate for this flow

/**
 * Where a new account came from, recorded by the sign-up form the moment the
 * account exists (AGL-3289).
 *
 * The form sends the first touch its page kept; the cookie on the request is
 * the fallback for a page that could not read it. Everything else comes from
 * the VERIFIED token and the auth record, never from the body: who the
 * account is, how it signed in — which is what decides the door — and when it
 * was created, which decides whether this is account creation at all. A call
 * for an account older than the window writes nothing.
 *
 * Accepted from an UNVERIFIED account on purpose: the password door calls
 * this before the verification email has even been opened, and on a phone the
 * click that verifies often happens in a different browser, one that never
 * saw the visit.
 */

/** The doors this form has, by the provider a verified token names. */
function doorFor(provider: string | null): AcquisitionDoor | null {
  if (provider === 'password') return 'signup-password'
  if (provider === 'google.com') return 'signup-google'
  return null
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    // A staff member signed in AS somebody did not create their account.
    if (isImpersonationSession(decoded)) {
      return Response.json({ error: 'Not during impersonation' }, { status: 403 })
    }
    const provider = String(decoded.firebase?.sign_in_provider ?? '') || null
    const door = doorFor(provider)
    if (!door) {
      return Response.json({ error: 'Not a sign-up door' }, { status: 400 })
    }
    // Across every pool, not the project's alone (AGL-1122): a lookup that
    // cannot see an account answers "not new", which writes nothing.
    const pooled = await findUserByUidAcrossPools(decoded.uid)
    const createdAtMs = Date.parse(pooled?.record.metadata.creationTime ?? '')
    const result = await recordAccountAcquisition({
      uid: decoded.uid,
      accountCreatedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
      touch: body?.touch ?? readFirstTouchCookie(request.headers.get('cookie')),
      door,
      provider,
      email: decoded.email ?? null,
      headers: request.headers,
      recordedBy: 'signup',
    })
    return Response.json({ status: result.status }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[auth/acquisition] record failed', error)
    return Response.json({ error: 'Could not record where the account came from' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
