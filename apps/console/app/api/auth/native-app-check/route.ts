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
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { mintNativeAppCheckToken } from '@aglyn/tenant-data-admin/server/native-handoff'
import { FieldValue } from 'firebase-admin/firestore'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * `POST /api/auth/native-app-check` — the Windows app's App Check tokens
 * (AGL-3816, Zach 2026-10-15).
 *
 * Compose Desktop has no attestation provider, so the console mints its
 * tokens for a session it signed in: the first rides the hand-off's
 * redemption, and this route refreshes them while the session lives. It asks
 * for the app's own ID token, which refreshes without App Check (measured, see
 * `native-handoff.ts`), so the two never wait on each other.
 *
 * The verify goes through the facade, which also refuses a revoked token or a
 * disabled or deleted account (AGL-1881), so nothing outlives sign-out or a
 * staff revocation for longer than the token in hand (an hour). Refused for a
 * support session, which is never handed to a device. Rate limited per account
 * and device install, and audited.
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
  // A random id the install makes once (no hardware identifier), so one device's refreshes are counted apart.
  const device = request.headers.get('x-aglyn-device') ?? ''
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(device)) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (isImpersonationSession(decoded)) {
      return Response.json(
        { error: 'A support session cannot be handed to the app.', reason: 'impersonation' },
        { status: 403 },
      )
    }
    const locked = await lockdownRefusal({
      request,
      // READ-ONLY passes, as signing in does (AGL-1511): this token is what
      // lets the desktop read at all, and refusing it would leave a read-only
      // workspace readable on the web and not on the desktop. Its one write
      // is the audit row below.
      intent: 'read',
      staff: decoded['staff'] === true,
      uid: decoded.uid,
    })
    if (locked) return locked
    const limited = await consumeRateLimit(`native-app-check:${decoded.uid}:${device}`, {
      limit: 12,
      windowMs: 60 * 60 * 1000,
    })
    if (!limited.allowed) {
      return Response.json(
        { error: 'Too many requests — try again shortly.' },
        { status: 429, headers: { 'Retry-After': '300' } },
      )
    }
    const minted = await mintNativeAppCheckToken()
    if (!minted) {
      return Response.json({ error: 'App Check is not configured', reason: 'not-configured' }, { status: 503 })
    }
    await addAdminAudit(firebaseAdmin.app().firestore(), {
      actorUid: decoded.uid,
      action: 'user.nativeAppCheck',
      target: `users/${decoded.uid}`,
      before: null,
      after: { tenantId: decoded.firebase?.tenant ?? null, device },
      at: FieldValue.serverTimestamp(),
    }).catch((error) => console.error('[auth/native-app-check] audit failed', error))
    return Response.json(
      { ok: true, token: minted.token, expiresAtMs: minted.expiresAtMs },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // A revoked token, a disabled or deleted account: a 401, and the app signs out.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[auth/native-app-check]', error)
    return Response.json({ error: 'Could not verify the app' }, { status: 500 })
  }
}

export { handler as POST }
