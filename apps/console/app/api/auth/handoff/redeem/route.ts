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
  authForPool,
  HANDOFF_VERIFIER_COOKIE,
  redeemConsoleHandoff,
} from '@aglyn/tenant-data-admin'
import { readCookieValues } from '../../read-cookie'
import { sameOriginRefusal } from '../../../_lib/same-origin'

// lockdown-423: exempt — a leg of signing in, like its `authorize` sibling.
// The lockdown gate for auth lives on the session mint this flow goes through
// immediately afterwards, and refusing here would hide the 423 notice behind a
// broken handoff.

/**
 * `POST /api/auth/handoff/redeem` — the CUSTOM DOMAIN leg (AGL-1902, D2/D3/D9).
 *
 * Consumes an authorized handoff and returns a Firebase custom token: the
 * identical shape `GET /api/auth/session` already returns for cross-subdomain
 * silent sign-in, so the client completes sign-in and mints its own host-only
 * session cookie through the EXISTING `POST /api/auth/session` path. No second
 * session mechanism is introduced.
 *
 * ## Three independent fail-closed gates (D9)
 *
 * 1. **Origin.** `Origin` must be this host, and `Sec-Fetch-Site` must be
 *    `same-origin` when the browser sent it. Absent or mismatched → refuse.
 *    This is the repo's first `Sec-Fetch-*` check and it genuinely rejects
 *    rather than warning, because a gate that only warns is a property that is
 *    claimed rather than held.
 * 2. **The body secret**, which a cross-site attacker can neither read (it
 *    arrived in a fragment) nor guess (32 random bytes).
 * 3. **The atomic consume**, which is what makes a replay find nothing.
 *
 * CSRF is therefore not a live risk and no CSRF module is needed — AGL-919
 * deleted the last one for having zero callers and a fail-open default, and
 * nothing here argues for its return.
 *
 * ## Why every value of the verifier cookie is read
 *
 * A compromised sibling host under the customer's own apex can set
 * `Domain=.acme-agency.com; __aglyn_handoff=…`, which SHADOWS our host-only
 * cookie in the `Cookie` header with no way to tell them apart — the AGL-1259
 * duplicate-`__session` failure. Hashing every value and accepting if any
 * matches is safe by construction and turns a hijack attempt into a no-op
 * rather than a denial of service.
 */

export const dynamic = 'force-dynamic'

/** Host-only, and cleared on every terminal outcome. */
function clearVerifier(secure: boolean): string {
  return [
    `${HANDOFF_VERIFIER_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const refused = sameOriginRefusal(request)
  if (refused) return refused

  let requestId: string
  let secret: string
  try {
    const body = (await request.json()) as {
      handoff?: unknown
      secret?: unknown
    }
    requestId = typeof body?.handoff === 'string' ? body.handoff : ''
    secret = typeof body?.secret === 'string' ? body.secret : ''
  } catch {
    requestId = ''
    secret = ''
  }
  if (!requestId || !secret) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const host = String(request.headers.get('host') ?? '').split(':')[0]
  const secure =
    (request.headers.get('x-forwarded-proto') ?? '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https' || request.url.startsWith('https:')

  try {
    const result = await redeemConsoleHandoff({
      requestId,
      secret,
      verifiers: readCookieValues(request, HANDOFF_VERIFIER_COOKIE),
      requestHost: host,
    })
    // Structural read, for the reason above the same shape in `authorize`.
    const outcome = result as {
      ok: boolean
      reason?: string
      uid?: string
      tenantId?: string | null
      continuePath?: string
    }
    if (!outcome.ok) {
      // The verifier is cleared on refusal too. It is single-purpose and its
      // record is gone or unreachable, so leaving it set can only make a
      // retry look like a browser that started a flow it did not.
      const response = Response.json(
        { error: 'Handoff refused', reason: outcome.reason },
        { status: 401 },
      )
      response.headers.append('Set-Cookie', clearVerifier(secure))
      return response
    }

    // `authForPool`, never the bare project auth: a custom token carries the
    // pool it was minted for, and a uid is unique only WITHIN a pool. The
    // client half — assigning `auth.tenantId` before the exchange — is
    // `signInWithPooledCustomToken` (AGL-1993), which the landing page uses.
    const token = await authForPool(outcome.tenantId).createCustomToken(
      outcome.uid,
    )
    const response = Response.json(
      {
        ok: true,
        token,
        tenantId: outcome.tenantId ?? null,
        continuePath: outcome.continuePath ?? '/',
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
    response.headers.append('Set-Cookie', clearVerifier(secure))
    return response
  } catch (error) {
    console.error('[auth/handoff/redeem]', error)
    return Response.json({ error: 'Handoff failed' }, { status: 500 })
  }
}

export { handler as POST }
