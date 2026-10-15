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

import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { authForPool, consumeRateLimit, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  isLoopbackRedirect,
  isNativeHandoffRedirect,
  isPkceVerifier,
  mintNativeAppCheckToken,
  redeemNativeHandoff,
} from '@aglyn/tenant-data-admin/server/native-handoff'
import { FieldValue } from 'firebase-admin/firestore'

// lockdown-423: exempt — the app leg of signing in. Its sibling `authorize`
// answers a lockdown with the 423 before any code exists, so a code reaching
// here was minted for an account the verdict had just passed; refusing here
// would only turn that notice into a failed hand-off on a device.

/**
 * `POST /api/auth/native-handoff/redeem` — the app leg of the native console
 * hand-off (AGL-3816): the app trades the one-time code the console page
 * handed it, with the PKCE verifier only it holds, for a Firebase custom
 * token in the identity pool the account lives in, and signs in with it.
 *
 * Anonymous by design: the app has no session yet, and the code and verifier
 * together are the credential. The code is consumed by the first redemption
 * whatever it decides. A disabled account is refused here, since a custom
 * token says nothing about that until it is exchanged.
 */

export const dynamic = 'force-dynamic'

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const body = (await request.json().catch(() => null)) as {
    code?: unknown
    verifier?: unknown
    redirectUri?: unknown
  } | null
  const code = typeof body?.code === 'string' ? body.code : ''
  const verifier = body?.verifier
  const redirectUri = body?.redirectUri
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(code) ||
    !isPkceVerifier(verifier) ||
    !isNativeHandoffRedirect(redirectUri)
  ) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  const limited = await consumeRateLimit(
    `native-handoff-redeem:${readClientIp(request.headers) ?? 'unknown'}`,
    { limit: 30, windowMs: 10 * 60 * 1000 },
  )
  if (!limited.allowed) {
    return Response.json({ error: 'Too many attempts — try again shortly.' }, { status: 429 })
  }

  try {
    const redeemed = await redeemNativeHandoff({ code, verifier, redirectUri })
    if (!redeemed.ok) {
      const refusal = redeemed as { reason?: string }
      return Response.json(
        {
          error: 'That sign-in has expired or was already used. Sign in again.',
          reason: refusal.reason ?? 'absent',
        },
        { status: 410, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const granted = redeemed as { uid: string; tenantId: string | null }
    const pool = authForPool(granted.tenantId)
    const account = await pool.getUser(granted.uid)
    if (account.disabled) {
      return Response.json(
        { error: 'This account is turned off.', reason: 'disabled' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const token = await pool.createCustomToken(granted.uid)
    // The desktop's first App Check token rides the redemption (AGL-3816):
    // Identity Toolkit refuses the custom-token exchange without one, and the
    // desktop has no attestation of its own. Only for the loopback return,
    // which is the desktop's; the phone apps attest themselves.
    const desktop = isLoopbackRedirect(redirectUri)
    const appCheck = desktop
      ? await mintNativeAppCheckToken().catch((error) => {
          console.error('[auth/native-handoff/redeem] app check mint failed', error)
          return null
        })
      : null
    await addAdminAudit(firebaseAdmin.app().firestore(), {
      actorUid: granted.uid,
      action: 'user.nativeAppSignIn',
      target: `users/${granted.uid}`,
      before: null,
      after: {
        tenantId: granted.tenantId,
        app: desktop ? 'desktop' : redirectUri.startsWith('aglyn-pos:') ? 'aglyn-pos' : 'aglyn',
        appCheckIssued: Boolean(appCheck),
      },
      at: FieldValue.serverTimestamp(),
    }).catch((error) => console.error('[auth/native-handoff/redeem] audit failed', error))
    return Response.json(
      {
        ok: true,
        token,
        tenantId: granted.tenantId,
        ...(appCheck ? { appCheckToken: appCheck.token, appCheckExpiresAtMs: appCheck.expiresAtMs } : {}),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[auth/native-handoff/redeem]', error)
    return Response.json({ error: 'Signing in to the app failed' }, { status: 500 })
  }
}

export { handler as POST }
