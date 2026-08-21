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
  authorizeConsoleHandoff,
  firebaseAdmin,
  getConsoleDomainClaim,
  isImpersonationSession,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

// lockdown-423: exempt — this is a leg of SIGNING IN, and the lockdown gate
// for auth lives on the session mint and exchange, which this flow still goes
// through afterwards. Refusing here would replace the 423 notice with a broken
// handoff on a domain that cannot show one.

/**
 * `POST /api/auth/handoff/authorize` — the AUTH HOST leg of the cross-domain
 * console session handoff (AGL-1902, design D3).
 *
 * Runs on `auth.aglyn.com` / `app.aglyn.com`, where the user has just signed
 * in, and never on the custom domain. It authorizes a pending handoff and
 * returns the URL to navigate to — with the return secret in the FRAGMENT, so
 * it never reaches our own edge access logs or any log drain (D1).
 *
 * **Bearer, not the session cookie.** The caller has an ID token in hand
 * because it has just signed in, and a cross-site caller cannot read or forge
 * an `Authorization` header — the same reasoning the passkey routes already
 * rely on.
 *
 * **The membership check is the point of this route.** An attacker can verify
 * a domain they genuinely own and have a real console served on it. What stops
 * them is that the auth host refuses to authorize a handoff unless the
 * signed-in user is a member of the org that owns the target host. A victim
 * phished onto `console.aglyn-support.com` signs in here, on an origin we
 * control, and is told they have no access to that workspace. Their credential
 * never touches the attacker's origin.
 *
 * The refusal reasons are returned so the auth host can render the D5 copy
 * under OUR branding — a "you may not be here" message has to be shown
 * somewhere trustworthy, and the custom domain may be exactly the thing that is
 * suspended.
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

  let requestId: string
  try {
    const body = (await request.json()) as { handoff?: unknown }
    requestId = typeof body?.handoff === 'string' ? body.handoff.trim() : ''
  } catch {
    requestId = ''
  }
  if (!requestId) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    // `checkRevoked`: a revoked token is not a sign-in, and this route's whole
    // job is to convert "just signed in" into a session somewhere else.
    const decoded = await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken(idToken, true)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return Response.json(
        { error: 'Verify your email to continue', reason: 'email-unverified' },
        { status: 403 },
      )
    }

    const result = await authorizeConsoleHandoff({
      requestId,
      uid: decoded.uid,
      tenantId: decoded.firebase?.tenant ?? null,
      impersonated: isImpersonationSession(decoded),
      isMember: async ({ targetHost }) => {
        // The org ID lives on the claim. `resolveConsoleDomain` deliberately
        // never returns it, because a verdict is read by an unauthenticated
        // route; this one is authenticated and may.
        const claim = await getConsoleDomainClaim(targetHost)
        if (!claim?.orgId) return false
        const membership = await resolveOrgMembership(decoded.uid, claim.orgId)
        return Boolean(membership)
      },
    })

    if (!result.ok) {
      // Read structurally: `strictNullChecks` is off repo-wide and
      // discriminated-union narrowing does not survive it across a lib
      // boundary — the shape `security-alerts.ts` already uses for the same
      // reason.
      const refusal = result as { reason?: string; orgSlug?: string | null }
      return Response.json(
        {
          error: 'Handoff refused',
          reason: refusal.reason,
          orgSlug: refusal.orgSlug ?? null,
        },
        { status: refusal.reason === 'not-a-member' ? 403 : 409 },
      )
    }
    const granted = result as {
      secret: string
      targetHost: string
      continuePath: string
    }

    // The secret rides in the FRAGMENT. Fragments are never transmitted to any
    // server, so the one channel we own and cannot audit — our own access logs
    // and their drains — never sees a session-grade secret. The caller
    // navigates with `location.replace` rather than us answering a 302,
    // because a `Location` header would put it back in those logs.
    const url =
      `https://${granted.targetHost}/auth/handoff` +
      `#${encodeURIComponent(requestId)}.${encodeURIComponent(granted.secret)}`
    return Response.json(
      { ok: true, url, continuePath: granted.continuePath },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const code = (error as { code?: string })?.code ?? ''
    if (code.startsWith('auth/')) {
      return Response.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    console.error('[auth/handoff/authorize]', error)
    return Response.json({ error: 'Handoff failed' }, { status: 500 })
  }
}

export { handler as POST }
