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
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { parseSignedOut, signedOutTombstone } from './session-tombstone'

export const dynamic = 'force-dynamic'

const SESSION_COOKIE = '__session'
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Cross-subdomain sessions (AGL-236): Firebase client auth persists
 * per-origin, so hopping between {org}.aglyn.io workspaces would force
 * re-login. POST mints a session cookie scoped to the parent domain from
 * a fresh ID token; GET exchanges the cookie for a custom token so a new
 * subdomain's client can sign in silently; DELETE clears it on sign-out.
 * Revocation-aware: the exchange rejects cookies minted before the
 * user's tokens were revoked.
 */
function cookieAttributes(request: Request, maxAgeSeconds: number) {
  const host = String(request.headers.get('host') ?? '').split(':')[0]
  const onWorkspaceDomain =
    host === WORKSPACE_DOMAIN || host.endsWith(`.${WORKSPACE_DOMAIN}`)
  return [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    // Domain only on the real deployment so localhost dev still works;
    // Secure likewise (localhost is http).
    ...(onWorkspaceDomain ? [`Domain=.${WORKSPACE_DOMAIN}`, 'Secure'] : []),
  ].join('; ')
}

function jsonWithCookie(
  body: unknown,
  status: number,
  cookie?: string,
): Response {
  const response = Response.json(body, { status })
  if (cookie) response.headers.set('Set-Cookie', cookie)
  return response
}

function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get('cookie')
  if (!raw) return undefined
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).trim() === name) {
      return decodeURIComponent(pair.slice(index + 1).trim())
    }
  }
  return undefined
}

async function handler(request: Request): Promise<Response> {
  try {
    const auth = firebaseAdmin.app().auth()

    if (request.method === 'POST') {
      const authorization = request.headers.get('authorization') ?? ''
      const idToken = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined
      if (!idToken) {
        return Response.json({ error: 'Unauthenticated' }, { status: 401 })
      }
      // Email-verification gate (AGL-479): never mint the cross-subdomain
      // session cookie for an unverified email/password account. Blocking it
      // here also covers workspaces — their silent sign-in reads this cookie,
      // so no cookie means no cross-subdomain access until the email is
      // verified. OAuth accounts arrive verified and pass through.
      // Exception (AGL-480): staff impersonation sessions (impersonatedBy
      // claim) are exempt, so an impersonated owner's unverified email
      // doesn't strand the support session — including across workspaces.
      try {
        const decoded = await auth.verifyIdToken(idToken)
        if (!decoded.email_verified && !isImpersonationSession(decoded)) {
          return emailUnverifiedResponse()
        }
      } catch {
        return Response.json({ error: 'Unauthenticated' }, { status: 401 })
      }
      let sessionCookie: string
      try {
        sessionCookie = await auth.createSessionCookie(idToken, {
          expiresIn: SESSION_TTL_MS,
        })
      } catch (error) {
        // AGL-467: a mint failure here strands the delegated cross-subdomain
        // hand-off (no cookie → workspace bounces back). Log it explicitly.
        console.error(
          '[auth/session] POST mint failed',
          JSON.stringify({
            code: (error as { code?: string })?.code,
            message: (error as { message?: string })?.message,
          }),
        )
        return Response.json(
          { error: 'Mint failed', reason: 'mint-failed' },
          { status: 401 },
        )
      }
      return jsonWithCookie(
        { ok: true },
        200,
        `${SESSION_COOKIE}=${sessionCookie}; ${cookieAttributes(request, SESSION_TTL_MS / 1000)}`,
      )
    }

    if (request.method === 'GET') {
      // 401 responses carry a `reason` so the client can tell an explicit
      // sign-out (tombstone/revocation → sign this origin out too) from a
      // merely missing/expired cookie (→ re-mint from the live local
      // session) — AGL-463.
      const cookie = readCookie(request, SESSION_COOKIE)
      if (!cookie) {
        return Response.json(
          { error: 'No session', reason: 'absent' },
          { status: 401 },
        )
      }
      // Timestamped sign-out tombstone (AGL-624): return WHEN the sign-out
      // happened so a restoring client can distinguish a real remote
      // sign-out (newer than its own last sign-in) from a stale tombstone
      // left by an earlier sign-out whose re-login mint failed/raced — the
      // latter must heal, not force a logout on refresh.
      const tombstone = parseSignedOut(cookie)
      if (tombstone) {
        return Response.json(
          { error: 'Signed out', reason: 'signed-out', signedOutAt: tombstone.at },
          { status: 401 },
        )
      }
      try {
        const decoded = await auth.verifySessionCookie(cookie, true)
        // Carry the impersonation claim through the cross-subdomain exchange
        // (AGL-480). The session cookie preserves it, but the re-minted custom
        // token would drop it — losing the banner and re-tripping the
        // email-verify gate on the next subdomain.
        const developerClaims = isImpersonationSession(decoded)
          ? {
              impersonatedBy: decoded['impersonatedBy'],
              impersonatedByEmail: decoded['impersonatedByEmail'] ?? null,
            }
          : undefined
        const token = await auth.createCustomToken(decoded.uid, developerClaims)
        return Response.json({ token }, { status: 200 })
      } catch (error) {
        const code = (error as { code?: string })?.code ?? ''
        // AGL-467: surface WHY the exchange failed. A `createCustomToken`
        // failure here (vs. a verify failure) breaks cross-subdomain silent
        // sign-in specifically, and was invisible because it was folded into
        // a generic 401.
        console.error(
          '[auth/session] GET exchange failed',
          JSON.stringify({
            code,
            message: (error as { message?: string })?.message,
          }),
        )
        const reason =
          code === 'auth/session-cookie-revoked'
            ? 'revoked'
            : code === 'auth/session-cookie-expired'
              ? 'expired'
              : 'invalid'
        return jsonWithCookie(
          { error: 'Session invalid', reason },
          401,
          `${SESSION_COOKIE}=; ${cookieAttributes(request, 0)}`,
        )
      }
    }

    if (request.method === 'DELETE') {
      // Timestamped tombstone, not deletion (AGL-463/AGL-624): other
      // subdomains read this as "signed out elsewhere" — but only if the
      // sign-out is newer than their last sign-in — while a truly absent
      // cookie no longer signs anyone out.
      return jsonWithCookie(
        { ok: true },
        200,
        `${SESSION_COOKIE}=${signedOutTombstone(Date.now())}; ${cookieAttributes(request, SESSION_TTL_MS / 1000)}`,
      )
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (error) {
    // Unexpected failures (admin SDK init, malformed request) — report
    // unauthenticated without touching the cookie; the client treats
    // reasonless 401s as re-mintable.
    console.error(
      '[auth/session] handler error',
      JSON.stringify({
        method: request.method,
        code: (error as { code?: string })?.code,
        message: (error as { message?: string })?.message,
      }),
    )
    return Response.json(
      { error: 'Session invalid', reason: 'invalid' },
      { status: 401 },
    )
  }
}

export { handler as GET, handler as POST, handler as DELETE }
