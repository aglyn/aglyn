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
  EDIT_HINT_COOKIE,
  editAccessMintRefusal,
  findUserByUidAcrossPools,
  firebaseAdmin,
  mintEditAccessToken,
  verifyEditHintToken,
} from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

/**
 * Exchanges the `.aglyn.app` editor-presence hint for a real edit-access
 * token, entirely server-side and entirely same-site (AGL-1842).
 *
 * On `*.aglyn.app` the console is CROSS-site: no iframe probe, no shared
 * cookie, no postMessage handshake can ever see the console session — the
 * AGL-1829 auto-arm was structurally blind there, which is why the bar
 * needed the chord Zach has now rejected. What this host DOES have,
 * post-bounce, is the HttpOnly `aglyn_edit_hint` cookie the login-time
 * bounce planted on `Domain=.aglyn.app`. It arrives here on a plain
 * same-origin POST from the bar, and this route turns it into the SAME
 * signed token the console's `/api/edit-access/token` popup mints — by
 * asking the same authorization question through the same shared code
 * (`editAccessMintRefusal`): release flag, org membership, host
 * `memberRoles` admin/editor or org role above viewer, lockdown.
 *
 * A hint names a uid, nothing more. So beyond the shared gate this route
 * re-proves two things the console route gets from a live ID token for
 * free:
 *
 * - the ACCOUNT is still real — `getUser(uid)` must resolve and not be
 *   disabled. Console sign-out cannot reach `.aglyn.app` cookies, so this
 *   is the fail-closed half of the sign-out story: disable the account or
 *   remove the membership and the hint dies here, days before its expiry;
 * - the HOST answers to the domain the request arrived on — the same
 *   cname/subdomain check `/api/edit-context` applies, so a page cannot
 *   exchange under someone else's hostId.
 *
 * Cross-origin callers get nothing: the JSON content type forces a CORS
 * preflight this route never answers, and `SameSite=Lax` keeps the cookie
 * off genuinely cross-SITE requests anyway. A sibling `*.aglyn.app`
 * attacker exchanging on its OWN host still faces the membership gate —
 * the token minted is for a host the victim can already edit or a 403.
 *
 * Failure is the API: the auto-armed bar renders NOTHING on any refusal.
 * 401 means "no usable hint" (the aglyn.com marketing hosts land here and
 * fall back to their working iframe probe); 403 means "known editor, no
 * rights on this host" and is definitive silence.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    hostId?: unknown
  } | null
  const hostId = typeof body?.hostId === 'string' ? body.hostId : ''
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }

  // The hint rides the cookie header — never the body, so no script (ours
  // or a site author's) ever holds it.
  const cookieHeader = request.headers.get('cookie') ?? ''
  const hintValue = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${EDIT_HINT_COOKIE}=`))
    ?.slice(EDIT_HINT_COOKIE.length + 1)
  const claims = verifyEditHintToken('cookie', hintValue)
  if (!claims) {
    return Response.json({ error: 'No edit hint' }, { status: 401 })
  }

  try {
    // The account behind the hint must still exist and be enabled — the
    // checkable thing a week-long cookie is bound to.
    let userEmail: string | undefined
    try {
      // Across pools (AGL-2005). A project-level `getUser` THROWS for anyone
      // who signs in through SSO — their uid lives in their org's GCIP tenant
      // — so this denied edit access to exactly the enterprise customers the
      // feature is sold to, and denied it as "No edit access", which reads
      // like a permission decision rather than a lookup that never happened.
      //
      // It was masked until today: the forged project-pool twin AGL-1962
      // describes answered this call and was not disabled, so the route
      // passed. Deleting the twin re-exposed the real bug, and the guard that
      // should have caught it does not walk `apps/tenant` — widened with this
      // change.
      const found = await findUserByUidAcrossPools(claims.uid)
      if (!found || found.record.disabled) {
        return Response.json({ error: 'No edit access' }, { status: 403 })
      }
      userEmail = found.record.email ?? undefined
    } catch {
      return Response.json({ error: 'No edit access' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const orgId = host.get('orgId') as string | undefined
    if (!orgId) {
      return Response.json({ error: 'Site has no organization' }, { status: 409 })
    }

    // The request arrived on a domain; the named host must answer to it —
    // same rule and same dev/preview carve-out as `/api/edit-context`.
    const hostname = (request.headers.get('host') ?? '')
      .split(':')[0]
      .toLowerCase()
    const cname = host.get('cname') as string | undefined
    const subdomain = host.get('subdomain') as string | undefined
    const isProductionAlias =
      hostname === cname ||
      (subdomain && hostname === `${subdomain}.aglyn.app`)
    const isDevOrPreview =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.vercel.app') ||
      process.env.NODE_ENV !== 'production'
    if (!isProductionAlias && !isDevOrPreview) {
      return Response.json({ error: 'Wrong site' }, { status: 403 })
    }

    // ONE authorization path: the same shared gate the console's token mint
    // runs — flag, membership, edit role, lockdown. A hint carries no staff
    // claim, so no staff bypass rides this route.
    const refusal = await editAccessMintRefusal({
      request,
      firestore,
      host,
      orgId,
      uid: claims.uid,
    })
    if (refusal) return refusal

    const { token, expiresAtMs } = mintEditAccessToken(hostId, claims.uid)
    return Response.json(
      {
        token,
        expiresAtMs,
        siteName: (host.get('displayName') as string | undefined) ?? subdomain,
        // Same disclosure rule as the popup payload: the verified caller,
        // about themselves, over a same-origin response.
        userEmail,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Could not exchange edit hint' }, { status: 500 })
  }
}
