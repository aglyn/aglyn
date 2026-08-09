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

import { consumeRateLimit, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { PasskeyError, verifyAssertion } from '../../../../_lib/passkeys'

export const dynamic = 'force-dynamic'

/**
 * Sign-in ceremony, step 2 (AGL-662): verify the assertion, then mint a
 * Firebase custom token for the credential's OWNER — the uid comes from the
 * server-written credential index, never from the request, so the token can
 * only name the account that registered the key that signed the challenge.
 * The client then runs `signInWithCustomToken` and the existing
 * `/api/auth/session` mint; nothing downstream changes.
 *
 * Failures are deliberately uniform 401s: which of "unknown credential /
 * bad signature / replayed challenge" occurred is logged, not disclosed.
 */
export async function POST(request: Request): Promise<Response> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limited = await consumeRateLimit(`passkey-signin-ip:${ip}`, {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  })
  if (!limited.allowed) {
    return Response.json({ error: 'rate-limited' }, { status: 429 })
  }
  let body: { challengeId?: string; response?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  if (!body?.challengeId || !body?.response) {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  try {
    const assertion = await verifyAssertion({
      firestore: firebaseAdmin.app().firestore(),
      originHeader: request.headers.get('origin'),
      challengeId: String(body.challengeId),
      response: body.response as never,
    })
    // Project-pool token only — passkeys are not offered to GCIP tenant
    // users, and this mint must never carry developer claims: it is a plain
    // interactive sign-in, not impersonation or delegation.
    const token = await firebaseAdmin
      .app()
      .auth()
      .createCustomToken(assertion.uid)
    return Response.json({ token }, { status: 200 })
  } catch (error) {
    if (error instanceof PasskeyError) {
      console.warn('[passkeys/signin/verify] refused', error.reason)
      return Response.json({ error: 'passkey-signin-failed' }, { status: 401 })
    }
    console.error('[passkeys/signin/verify] failed', error)
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
