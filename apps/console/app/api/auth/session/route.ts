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
  resolveIdpDisplayName,
  resolveIdpPhone,
  resolveIdpPhotoUrl,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  seedUserProfile,
} from '@aglyn/tenant-data-admin'
import { after } from 'next/server'
import {
  parseSignedOut,
  signedOutTombstone,
  tombstoneIsExpired,
  SESSION_TOMBSTONE_TTL_MS,
} from './session-tombstone'
import {
  WORKSPACE_DOMAIN,
  workspaceSlugFromHost,
} from '../../../../constants/workspace-domain'

export const dynamic = 'force-dynamic'

const SESSION_COOKIE = '__session'
// Enterprise SSO (AGL-1101): a session minted from a GCIP-tenant ID token must
// be verified + exchanged against THAT tenant, but the `__session` cookie is
// opaque. This sidecar records the tenant so the GET exchange picks the right
// `authForTenant`. Absent → default-tenant session (the unchanged path).
const SESSION_TENANT_COOKIE = '__session_tenant'
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Cross-subdomain sessions (AGL-236): Firebase client auth persists
 * per-origin, so hopping between {org}.aglyn.com workspaces would force
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
  cookie?: string | string[],
): Response {
  const response = Response.json(body, { status })
  // Multiple Set-Cookie headers (AGL-1101: session + tenant sidecar) must each
  // be appended — `set` would collapse them into one.
  for (const value of cookie == null ? [] : [cookie].flat()) {
    response.headers.append('Set-Cookie', value)
  }
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

/**
 * Refuse to mint or exchange a `.aglyn.com`-scoped cookie on a hostname that
 * is not a real workspace.
 *
 * `/api/*` sits outside the middleware matcher, so the host gate in
 * `middleware.ts` never sees this route: an unregistered subdomain that could
 * not render a console page could still call it, and — because the cookie
 * carries `Domain=.aglyn.com` — the browser would attach the caller's real
 * `__session` to that request. This route hands that cookie back as a custom
 * token, so it is the one worth guarding directly rather than relying on the
 * layers above it.
 *
 * DELETE is exempt: signing out from an unexpected host should always work.
 */
async function rejectUnknownWorkspaceHost(
  request: Request,
): Promise<Response | null> {
  const slug = workspaceSlugFromHost(request.headers.get('host'))
  // The apex, the reserved labels, localhost, previews and self-hosted
  // domains all return null — none of them is a workspace subdomain.
  if (slug === null) return null
  try {
    const snapshot = await firebaseAdmin
      .firestore()
      .doc(`orgSlugs/${slug}`)
      .get()
    if (snapshot.exists) return null
  } catch {
    // Fail open on an outage, matching the middleware. The Vercel domain
    // allowlist is the boundary; this is defence in depth.
    return null
  }
  return Response.json(
    { error: 'unknown-workspace', workspace: slug },
    { status: 421 },
  )
}

async function handler(request: Request): Promise<Response> {
  try {
    const auth = firebaseAdmin.app().auth()

    if (request.method !== 'DELETE') {
      const rejected = await rejectUnknownWorkspaceHost(request)
      if (rejected) return rejected
    }

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
      // SSO (AGL-1101): read the tenant off the token so the cookie is minted
      // by the matching tenant auth. The default `verifyIdToken` validates a
      // tenant token fine and exposes `firebase.tenant`; the mint below then
      // re-validates against that tenant.
      let tenantId: string | undefined
      try {
        const decoded = await auth.verifyIdToken(idToken)
        if (!decoded.email_verified && !isImpersonationSession(decoded)) {
          return emailUnverifiedResponse()
        }
        tenantId = decoded.firebase?.tenant
        // Seed the personal profile doc (AGL-1127). No account-creation path
        // wrote `users/{uid}` — it was born the first time someone saved
        // Basic info — so Manage Account rendered its form against a document
        // that did not exist, for every account that had never used it.
        //
        // Here because this is the one place EVERY interactive sign-in
        // passes through with a verified token in hand, whichever provider
        // it came from: the Google popup, the mobile redirect (which
        // completes on a fresh page load and so has no handler of its own to
        // hang this off), and SSO. It is also what backfills the accounts
        // that predate this, on their next sign-in, without a migration.
        //
        // Off the critical path via `after()`: minting the session is what the
        // user is waiting on, and a cosmetic prefill must neither delay it nor
        // fail it. This was a bare `void promise` — which on a serverless
        // runtime is not the same thing. The instance can freeze the moment
        // the response is flushed, so the seed ran only when the box happened
        // to stay warm. The same bug was confirmed this session on the Stripe
        // org sync, where Firestore updated and Stripe did not.
        //
        // The seed only ever fills absent fields, so re-running it on every
        // mint is safe, and it doubles as the backfill for accounts that
        // predate it.
        //
        // Email/password sign-up seeds itself from the form instead — the
        // first/last name it collects are not on the token at this point,
        // because the account was created seconds ago with no displayName.
        const uid = decoded.uid
        const seed = {
          // Not `decoded['name']`: a SAML assertion puts mapped attributes
          // under `firebase.sign_in_attributes`, so the old read was blank for
          // every SSO account (AGL-1131).
          displayName: resolveIdpDisplayName(decoded) || null,
          photoUrl: resolveIdpPhotoUrl(decoded) || null,
          phoneNumber: resolveIdpPhone(decoded) || null,
        }
        after(async () => {
          try {
            await seedUserProfile(uid, seed)
          } catch (error) {
            console.error('[auth/session] profile seed failed', error)
          }
        })
      } catch {
        return Response.json({ error: 'Unauthenticated' }, { status: 401 })
      }
      const signAuth = tenantId
        ? auth.tenantManager().authForTenant(tenantId)
        : auth
      let sessionCookie: string
      try {
        sessionCookie = await signAuth.createSessionCookie(idToken, {
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
      // Pair the session cookie with the tenant sidecar (set to the tenant, or
      // cleared for a default-tenant session so a stale tenant cookie from a
      // prior SSO login can't mis-route this one).
      return jsonWithCookie({ ok: true }, 200, [
        `${SESSION_COOKIE}=${sessionCookie}; ${cookieAttributes(request, SESSION_TTL_MS / 1000)}`,
        `${SESSION_TENANT_COOKIE}=${tenantId ?? ''}; ${cookieAttributes(request, tenantId ? SESSION_TTL_MS / 1000 : 0)}`,
      ])
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
        // An expired tombstone is treated as no cookie at all, and cleared on
        // the way out (AGL-1142). Enforcing the lifetime HERE, not only via
        // the cookie's Max-Age, is what heals the ones already in browsers:
        // they were written with the session cookie's 14-day lifetime, and a
        // shorter Max-Age only applies to tombstones written from now on.
        //
        // Measured on production 2026-07-31: a nine-day-old tombstone was
        // still answering `401 signed-out` to every cross-subdomain exchange,
        // on an account that had signed in interactively since.
        if (tombstoneIsExpired(tombstone.at, Date.now())) {
          return jsonWithCookie(
            { error: 'No session', reason: 'absent' },
            401,
            [`${SESSION_COOKIE}=; ${cookieAttributes(request, 0)}`],
          )
        }
        return Response.json(
          { error: 'Signed out', reason: 'signed-out', signedOutAt: tombstone.at },
          { status: 401 },
        )
      }
      // SSO (AGL-1101): an SSO session cookie was minted by a GCIP tenant, so
      // verify + re-mint against that tenant. The client sets `auth.tenantId`
      // from the same sidecar before `signInWithCustomToken`, keeping the
      // silent cross-subdomain sign-in in-tenant.
      const sessionTenantId = readCookie(request, SESSION_TENANT_COOKIE) || undefined
      const sessionAuth = sessionTenantId
        ? auth.tenantManager().authForTenant(sessionTenantId)
        : auth
      try {
        const decoded = await sessionAuth.verifySessionCookie(cookie, true)
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
        const token = await sessionAuth.createCustomToken(
          decoded.uid,
          developerClaims,
        )
        return Response.json({ token, tenantId: sessionTenantId ?? null }, { status: 200 })
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
        return jsonWithCookie({ error: 'Session invalid', reason }, 401, [
          `${SESSION_COOKIE}=; ${cookieAttributes(request, 0)}`,
          `${SESSION_TENANT_COOKIE}=; ${cookieAttributes(request, 0)}`,
        ])
      }
    }

    if (request.method === 'DELETE') {
      // Timestamped tombstone, not deletion (AGL-463/AGL-624): other
      // subdomains read this as "signed out elsewhere" — but only if the
      // sign-out is newer than their last sign-in — while a truly absent
      // cookie no longer signs anyone out.
      return jsonWithCookie({ ok: true }, 200, [
        // A day, not the session's own 14 (AGL-1142). The tombstone only has
        // to outlive the window in which another subdomain might still be
        // acting on a session this sign-out ended; past that it can only deny
        // sessions nobody asked it to.
        `${SESSION_COOKIE}=${signedOutTombstone(Date.now())}; ${cookieAttributes(request, SESSION_TOMBSTONE_TTL_MS / 1000)}`,
        `${SESSION_TENANT_COOKIE}=; ${cookieAttributes(request, 0)}`,
      ])
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
