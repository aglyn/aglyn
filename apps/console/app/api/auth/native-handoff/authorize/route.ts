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
  consumeRateLimit,
  firebaseAdmin,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import {
  authorizeNativeHandoff,
  isNativeHandoffRedirect,
  isPkceChallenge,
} from '@aglyn/tenant-data-admin/server/native-handoff'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * `POST /api/auth/native-handoff/authorize` — the browser leg of the native
 * apps' console hand-off (AGL-3816): the console page at `/auth/native`,
 * signed in, asks for a one-time code to hand to the app that opened it.
 *
 * **Bearer, not the session cookie.** The page holds the signed-in browser's
 * ID token, and a cross-site caller can neither read nor forge an
 * `Authorization` header, so a page elsewhere cannot mint a code for a
 * visitor's account by making their browser POST here.
 *
 * Refused for an unconfirmed address, since every console route refuses that
 * account anyway, and for a support session, which is a staff member's view
 * of a customer and never something to hand to a device. The redirect must be
 * one of the apps' own return addresses and the challenge an S256 PKCE
 * challenge; the code is bound to both. See
 * `libs/tenant/data/admin/src/lib/server/native-handoff.ts` for the threat
 * model.
 */

export const dynamic = 'force-dynamic'

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

  const body = (await request.json().catch(() => null)) as {
    challenge?: unknown
    redirectUri?: unknown
    state?: unknown
  } | null
  const challenge = body?.challenge
  const redirectUri = body?.redirectUri
  const state = typeof body?.state === 'string' ? body.state : ''
  if (
    !isPkceChallenge(challenge) ||
    !isNativeHandoffRedirect(redirectUri) ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(state)
  ) {
    return Response.json(
      { error: 'This sign-in link is not from the app. Open it from the app again.', reason: 'invalid-request' },
      { status: 400 },
    )
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (isImpersonationSession(decoded)) {
      return Response.json(
        { error: 'A support session cannot be handed to the app.', reason: 'impersonation' },
        { status: 403 },
      )
    }
    if (!decoded.email_verified) {
      return Response.json(
        { error: 'Verify your email to continue', reason: 'email-unverified' },
        { status: 403 },
      )
    }
    // A locked account (or a platform lockdown) gets the 423 notice here, as
    // the session mint gives it.
    const locked = await lockdownRefusal({
      request,
      // READ-ONLY passes, as it passes the session mint (AGL-1511): signing
      // the app in is how a customer reaches the data a read-only lock keeps
      // readable. The one write below is this sign-in's own one-time code.
      intent: 'read',
      staff: decoded['staff'] === true,
      uid: decoded.uid,
    })
    if (locked) return locked
    const limited = await consumeRateLimit(`native-handoff:${decoded.uid}`, {
      limit: 20,
      windowMs: 60 * 60 * 1000,
    })
    if (!limited.allowed) {
      return Response.json(
        { error: 'Too many sign-ins to the app — try again in an hour.' },
        { status: 429 },
      )
    }

    const { code } = await authorizeNativeHandoff({
      uid: decoded.uid,
      tenantId: decoded.firebase?.tenant ?? null,
      challenge,
      redirectUri,
    })
    const url =
      `${redirectUri}?code=${encodeURIComponent(code)}` +
      `&state=${encodeURIComponent(state)}`
    return Response.json(
      { ok: true, url },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[auth/native-handoff/authorize]', error)
    return Response.json({ error: 'Signing in to the app failed' }, { status: 500 })
  }
}

export { handler as POST }
