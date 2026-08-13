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
  resolveConsoleDomain,
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
  hostnameOf,
  isWorkspaceDomainHost,
  WORKSPACE_DOMAIN,
  workspaceSlugFromHost,
} from '../../../../constants/workspace-domain'
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_S,
  describeSignInClient,
  recordDeviceAndMaybeAlert,
} from '../../_lib/security-alerts'
import { enforceSanctionsGeo } from '../../../../constants/sanctions-geo'

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
/**
 * Is this request actually on HTTPS?
 *
 * Behind Vercel's proxy the runtime sees the forwarded header; the URL is the
 * fallback for a direct connection and for local dev. A comma-joined list is
 * possible through more than one proxy — the first entry is the client's leg,
 * which is the one `Secure` is about.
 */
function requestIsHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

function cookieAttributes(request: Request, maxAgeSeconds: number) {
  const onWorkspaceDomain = isWorkspaceDomainHost(request.headers.get('host'))
  return [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    // Domain only on the workspace domain: nowhere else shares a parent with
    // it, and a `Domain` a browser will not accept is a cookie that silently
    // does not get set.
    ...(onWorkspaceDomain ? [`Domain=.${WORKSPACE_DOMAIN}`] : []),
    // `Secure` is a separate question from `Domain` and used to be answered by
    // the same ternary. Two questions — "should this cookie be parent-scoped?"
    // and "is this connection HTTPS?" — and they already disagreed in
    // production (AGL-1353 D6, measured 2026-08-09): a `DELETE` on
    // `aglyn-console-aglyn.vercel.app` set a session tombstone over HTTPS with
    // no `Secure` flag at all. Harmless there only because `vercel.app` is HSTS
    // preloaded and on the Public Suffix List — neither of which transfers to
    // `console.acme-agency.com`. So it keys on the connection, and localhost
    // (http) still works.
    ...(requestIsHttps(request) ? ['Secure'] : []),
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

/**
 * Reads one cookie, preferring a NON-EMPTY value when the jar holds more
 * than one of the same name (AGL-1259).
 *
 * A browser will happily send two cookies with the same name at different
 * scopes — one `Domain=.aglyn.com`, one host-only — and the `Cookie` header
 * gives no way to tell them apart. Taking the first match meant an empty
 * duplicate permanently shadowed the real session:
 *
 * ```
 * Cookie: __session=; __session=<real>   → 401 {"reason":"absent"}
 * Cookie: __session=<real>               → 200
 * ```
 *
 * That is not hypothetical — it reproduces against production, and it is a
 * DEADLOCK rather than a hiccup: `useSessionCookie` reads `absent`, correctly
 * re-mints, the mint sets its own scope, the empty duplicate still sorts
 * first, and the next read says `absent` again. Observed as a console signed
 * in as the right user and showing "0 Workspaces" — a silent wrong answer,
 * with no path out but clearing site data.
 *
 * Preferring a non-empty value is the smallest change that breaks the
 * deadlock, and it is right on its own terms: an empty cookie carries no
 * session, so there is never a reason to choose it over one that does.
 */
function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get('cookie')
  if (!raw) return undefined
  let empty: string | undefined
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).trim() !== name) continue
    const value = decodeURIComponent(pair.slice(index + 1).trim())
    if (value) return value
    // Remember it, so a jar holding ONLY empties still behaves as before.
    empty = value
  }
  return empty
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

/**
 * The custom-console-domain sibling of the guard above (AGL-1099c).
 *
 * `rejectUnknownWorkspaceHost` returns `null` for every host that is not
 * `*.aglyn.com`, so a custom console domain sails straight past it — the guard
 * has no opinion at all about non-workspace hosts, which was correct only while
 * nothing routed on one. Once a domain resolves to an org, this route is the
 * one worth guarding directly: `/api/*` sits outside the middleware matcher, so
 * a host the middleware would refuse to render a console for can still call it.
 *
 * **Fails closed on a downgrade and open on an outage**, and the two are
 * genuinely different answers rather than one policy. `resolveConsoleDomain`
 * refuses only on an authoritative read — the org exists and does not hold
 * `whiteLabel`, or the claim is suspended or was never activated. A Firestore
 * failure comes back `degraded`, and a host with no claim at all comes back
 * `known: false`; both pass through, the first matching the workspace guard's
 * stated posture and the second because localhost, preview deployments and
 * self-hosted installs all look exactly like that.
 *
 * DELETE is exempt for the same reason as above: signing out from an unexpected
 * host must always work — and on a suspended domain it is the single most
 * useful thing left to do.
 */
async function rejectUnknownConsoleHost(
  request: Request,
): Promise<Response | null> {
  const host = hostnameOf(request.headers.get('host'))
  // The workspace domain is the other guard's business, apex and reserved
  // labels included.
  if (!host || isWorkspaceDomainHost(host)) return null
  try {
    const verdict = await resolveConsoleDomain(host)
    if (verdict.degraded || !verdict.known || verdict.servable) return null
    return Response.json(
      { error: 'console-domain-inactive', reason: verdict.reason },
      { status: 421 },
    )
  } catch {
    // Fail open, matching the guard above. This is defence in depth behind the
    // Vercel domain allowlist, not the boundary itself.
    return null
  }
}

async function handler(request: Request): Promise<Response> {
  try {
    const auth = firebaseAdmin.app().auth()

    if (request.method !== 'DELETE') {
      // Sanctions / OFAC geo-block (AGL-1492). Here for the reason stated at
      // the top of `rejectUnknownWorkspaceHost`: `/api/*` is outside the
      // middleware matcher, so the page-level block in `middleware.ts` never
      // sees this route — and this route is the one that MINTS THE SESSION,
      // i.e. the moment the console actually becomes usable across the
      // workspace domain. Blocking pages while still minting cookies would be
      // a control with a hole shaped exactly like the product.
      //
      // DELETE is exempt, matching the two guards below it: signing out must
      // always work, and refusing to let a blocked user end their own session
      // serves nobody's compliance interest.
      const refused = enforceSanctionsGeo(request.headers, 'json')
      if (refused) return refused
      const rejected =
        (await rejectUnknownWorkspaceHost(request)) ??
        (await rejectUnknownConsoleHost(request))
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
      // A tombstone standing in front of a caller who just proved they are
      // signed in is provably stale (AGL-1142).
      //
      // The nine-day tombstone measured on production was left by a mint that
      // was REFUSED rather than one that failed to happen — and a refusal is a
      // 401/403, which `await fetch(...)` resolves rather than throws, so the
      // client's best-effort `catch` never saw it and the tombstone stayed.
      // The likeliest way in is the email-verification gate below: verify your
      // email, sign in before the ID token refreshes, and the token still
      // says `email_verified: false`. The mint is refused, correctly — and the
      // tombstone then answers `401 signed-out` to every cross-subdomain
      // exchange until it expires.
      //
      // So the refusal paths clear it. Refusing to mint a SHARED cookie is a
      // statement about eligibility; it is not a statement that this person is
      // signed out, and leaving a tombstone to say so is simply false. Cleared
      // only after `verifyIdToken` succeeds, so an unauthenticated caller can
      // never erase a real sign-out.
      const clearTombstone = parseSignedOut(readCookie(request, SESSION_COOKIE))
        ? [`${SESSION_COOKIE}=; ${cookieAttributes(request, 0)}`]
        : undefined
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
      // Captured for the new-device security alert (AGL-665). Null when the
      // sign-in should not touch the device registry at all — staff
      // impersonation must never mail the customer "new device sign-in".
      let signInIdentity: { uid: string; email: string | null } | null = null
      try {
        const decoded = await auth.verifyIdToken(idToken)
        if (!decoded.email_verified && !isImpersonationSession(decoded)) {
          const unverified = emailUnverifiedResponse()
          for (const value of clearTombstone ?? []) {
            unverified.headers.append('Set-Cookie', value)
          }
          return unverified
        }
        tenantId = decoded.firebase?.tenant
        if (!isImpersonationSession(decoded)) {
          signInIdentity = {
            uid: decoded.uid,
            email: decoded.email ? String(decoded.email) : null,
          }
        }
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
        // Same reasoning as the unverified branch (AGL-1142): the caller's
        // token verified, so whatever went wrong in `createSessionCookie`,
        // a tombstone claiming they are signed out is stale.
        return jsonWithCookie(
          { error: 'Mint failed', reason: 'mint-failed' },
          401,
          clearTombstone,
        )
      }
      // New-device recognition (AGL-665): a long-lived HttpOnly device-id
      // cookie, re-set on every mint so an active browser never lapses. The
      // Firestore lookup, the device record and any alert email all run in
      // `after()` — sign-in latency and sign-in success owe nothing to them.
      const knownDeviceId = readCookie(request, DEVICE_COOKIE)
      const deviceId =
        signInIdentity && (knownDeviceId || crypto.randomUUID())
      if (signInIdentity && deviceId) {
        const identity = signInIdentity
        const client = describeSignInClient(request.headers)
        after(async () => {
          await recordDeviceAndMaybeAlert({
            firestore: firebaseAdmin.app().firestore(),
            uid: identity.uid,
            email: identity.email,
            deviceId,
            client,
            nowMs: Date.now(),
          })
        })
      }
      // Pair the session cookie with the tenant sidecar (set to the tenant, or
      // cleared for a default-tenant session so a stale tenant cookie from a
      // prior SSO login can't mis-route this one).
      return jsonWithCookie({ ok: true }, 200, [
        `${SESSION_COOKIE}=${sessionCookie}; ${cookieAttributes(request, SESSION_TTL_MS / 1000)}`,
        `${SESSION_TENANT_COOKIE}=${tenantId ?? ''}; ${cookieAttributes(request, tenantId ? SESSION_TTL_MS / 1000 : 0)}`,
        ...(deviceId
          ? [
              `${DEVICE_COOKIE}=${deviceId}; ${cookieAttributes(request, DEVICE_COOKIE_MAX_AGE_S)}`,
            ]
          : []),
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
