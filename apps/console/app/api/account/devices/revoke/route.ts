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
import { isValidDeviceId, revokeDeviceSession } from '../../../_lib/device-registry'

// lockdown-423: exempt — account-scoped, and the one action worth keeping
// reachable during an incident. There is no org context here and no capability
// granted: the sole effect is ending the CALLER'S OWN sessions, which is what
// somebody who believes their account is compromised is trying to do. Refusing
// it under a lockdown would take away the remedy at the moment it matters, in
// exactly the way the sibling read route argues for its own exemption. The
// mint and exchange carry the lockdown gate for auth.

/**
 * Revoke the sessions on one of the caller's own devices (AGL-1959).
 *
 * AGL-2318 shipped the list and refused to ship this until it could actually
 * invalidate, on the grounds that "a 'sign out everywhere' button that did not
 * actually sign anyone out would be worse than no button". The invalidation is
 * described in `_lib/device-revocation.ts`; this route is the three writes it
 * takes, in the order that matters.
 *
 * ## Order
 *
 * The device stamp goes FIRST. If `revokeRefreshTokens` fails we have refused
 * the device at our own boundary and the caller can retry; the reverse order
 * would end every session and leave no record of why, so the device row would
 * still read as live and the person would revoke it again.
 *
 * ## Pool
 *
 * `authForPool(decoded.firebase?.tenant)`, never the bare project auth.
 * AGL-2005 measured the consequence of getting this wrong on production: a
 * `revokeRefreshTokens` dated 2026-08-14 sitting on a project-pool ghost while
 * the real SSO account's `tokensValidAfterTime` never moved — a revocation
 * that returned 200 and revoked nothing.
 *
 * ## Scope
 *
 * The uid comes off the verified token and never from the request. There is no
 * uid parameter, because a uid parameter would make this a way to sign anybody
 * out.
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

  let deviceId: string
  try {
    const body = (await request.json()) as { deviceId?: unknown }
    deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
  } catch {
    deviceId = ''
  }
  // A path-shaped id would address a document outside this user's own
  // subcollection. `.doc()` on a slashed id resolves a nested path, so the
  // check is not cosmetic. Shared with the staff door (AGL-1513), because two
  // doors onto one subcollection must refuse the same ids.
  if (!isValidDeviceId(deviceId)) {
    return Response.json({ error: 'Invalid device' }, { status: 400 })
  }

  try {
    const auth = firebaseAdmin.app().auth()
    // `checkRevoked` here too: a caller whose own tokens were already revoked
    // is not signed in, and letting a revoked token drive a revocation would
    // be a way for the holder of a stolen token to sign the real owner out.
    const decoded = await auth.verifyIdToken(idToken, true)
    const uid = decoded.uid

    // Stamp-then-revoke, in the owning pool, with the cache drop — all of it
    // in `_lib/device-registry.ts` since AGL-1513, so the staff door cannot
    // drift from this one.
    const outcome = await revokeDeviceSession({
      firestore: firebaseAdmin.app().firestore(),
      uid,
      deviceId,
      tenantId: decoded.firebase?.tenant ?? null,
      revokedBy: 'owner',
      nowMs: Date.now(),
    })

    if (!outcome.existed) {
      return Response.json({ error: 'Unknown device' }, { status: 404 })
    }

    return Response.json(
      {
        ok: true,
        deviceId,
        revokedAt: outcome.revokedAt,
        // Named in the response, not only in the copy, so a caller cannot
        // present this as a per-device sign-out by accident.
        signedOutEverywhere: true,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const code = (error as { code?: string })?.code ?? ''
    if (
      code === 'auth/id-token-revoked' ||
      code === 'auth/id-token-expired' ||
      code === 'auth/argument-error'
    ) {
      return Response.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    console.error('[account/devices/revoke]', error)
    return Response.json({ error: 'Revoke failed' }, { status: 500 })
  }
}

export { handler as POST }
