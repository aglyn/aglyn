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

import { pluginRequestFromWeb, TENANT_APEX } from '@aglyn/aglyn/server'
import { revalidateHostAliases } from '../../../../utils/server/tenant-revalidate'
import {
  attachProjectDomain,
  detachProjectDomain,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  logHostActivity,
} from '@aglyn/tenant-data-admin'

/**
 * Releases a custom domain: removes it from the tenant deployment and clears
 * `host.cname` (AGL-742).
 *
 * Disconnect used to clear `host.cname` client-side only, leaving the hostname
 * registered forever. The platform kept serving it, so with no host holding
 * that cname `get-host.ts` resolved nothing and the domain 404'd instead of
 * being released — while certificates kept renewing and the domain counted
 * against the deployment's limit.
 *
 * Deliberately does NOT touch DNS. A real custom domain's CNAME lives in the
 * customer's own zone; we have no access to it and must not imply otherwise.
 *
 * A name that was never registered (`not-found`) is treated as success — it is
 * the desired end state already, mirroring how attach tolerates a name that is
 * already registered. Auth: Firebase ID token; caller must be a host admin.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const hostSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }

    // Lockdown verdict (AGL-1506): host doc in hand; the owning org's doc
    // is fetched for the org scope (an org lock never stamps host docs, so
    // host-only would miss it) — a domain detach is a rare admin mutation,
    // and the read is request-cache-deduped. Staff bypass is the un-panic
    // invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    // Only this host's own domain may be released — never a domain read off
    // the request body, which would let an admin detach someone else's.
    const domain = String(hostSnapshot.get('cname') ?? '')
      .trim()
      .toLowerCase()
    if (!domain) {
      return Response.json({ detached: true, alreadyClear: true }, { status: 200 })
    }

    // `not-found` is success (the name is already gone) and `skipped` is a
    // deployment that does not register names at all — neither is a failure to
    // report, and neither leaves an orphan behind.
    const released = await detachProjectDomain(domain, 'tenant')
    if (released.outcome === 'failed') {
      // Record that the platform still holds it, so the orphan is visible
      // rather than silent, and keep `cname` so a retry has something to act
      // on. Same honesty as attach's `cnameAttachmentPending`.
      await hostSnapshot.ref
        .set({ cnameDetachmentPending: true }, { merge: true })
        .catch(() => undefined)
      return Response.json(
        { error: released.detail ?? 'Detach failed at the platform' },
        { status: 502 },
      )
    }

    // Undo the platform-subdomain edge redirect (AGL-1273): once no custom
    // domain is connected, `{subdomain}.aglyn.app` must SERVE again rather
    // than redirect to a domain the customer just released.
    //
    // Two calls because a redirect is a property of the registration, so the
    // way to drop it is to drop the entry and put a plain one back. Only when
    // there WAS an entry: `not-found` means the name is served by a wildcard
    // and never had a redirect of its own, and registering one there would
    // invent an entry this route never removed.
    //
    // Best-effort, in the order that fails safe. If the re-register loses, the
    // name is left unregistered rather than redirecting to a domain that is
    // gone — a wildcard still serves it, and the site keeps an address either
    // way; a stale redirect would leave it with none.
    //
    // ⛔ Do NOT collapse these back into one call. This was a single
    // `PATCH {redirect: null}` against the hosting vendor's API, and that is
    // precisely what the provider seam exists to not have. The contract in
    // `domain-provider.ts` is three operations — attach, detach, status — and
    // an in-place mutate is a fourth that every driver would owe: the wildcard
    // driver registers nothing and has no entry to patch, and the webhook
    // driver would need a new verb in an operator's already-deployed endpoint.
    // A fourth operation across three drivers is a real cost, and it is not
    // worth what it buys here.
    //
    // What it would buy is closing a window whose worst case is already
    // covered. The entry being dropped exists ONLY because a custom domain was
    // connected — `upsertSubdomainRedirect` is what created it — so the state
    // this restores is the one every site without a custom domain is already
    // in: unregistered, and served by the wildcard on the tenant apex. The
    // re-register is belt-and-braces for a name that resolves without it. A
    // lost one costs nothing a visitor can see, which is why this may stay two
    // calls and stay best-effort.
    const subdomain = String(hostSnapshot.get('subdomain') ?? '')
      .trim()
      .toLowerCase()
    if (subdomain) {
      const platformName = `${subdomain}.${TENANT_APEX}`
      const removed = await detachProjectDomain(platformName, 'tenant')
      if (removed.outcome === 'detached') {
        await attachProjectDomain(platformName, {}, 'tenant')
      }
    }

    await hostSnapshot.ref.set(
      {
        cname: firebaseAdmin.firestore.FieldValue.delete(),
        cnameAttachmentPending: firebaseAdmin.firestore.FieldValue.delete(),
        cnameDetachmentPending: firebaseAdmin.firestore.FieldValue.delete(),
        subdomainRedirectPending: firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )

    /*==========================================
     * THE EVENT IS `cname` LEAVING THE DOCUMENT (AGL-118), which is the
     * write directly above — the mirror image of where attach logs, and
     * chosen the same way.
     *
     * Two of this route's exits answer 200 and neither is this event:
     *
     *  - `alreadyClear`, on a site with no domain to release. It is a 200
     *    because the caller's desired end state already holds, not because
     *    anything moved — and an entry there would put "released
     *    example.com" in the feed of a site that has never had a domain,
     *    with no domain name to even put in it.
     *  - `outcome === 'failed'` is a 502, but it is the branch most likely
     *    to attract a log line, because it is where the platform is
     *    genuinely doing something. It stamps `cnameDetachmentPending` and
     *    KEEPS `cname`: the domain is still attached, still certifying,
     *    still counting against the deployment. A row there would say the
     *    customer released a domain we are in fact still holding — the exact
     *    orphan this route exists to make visible, made invisible again by
     *    the audit trail agreeing with the mistake.
     *
     * Everything after this write is best-effort cache work that cannot
     * re-attach the domain, so the state the entry describes is settled.
     *=========================================*/
    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null },
      'Released the custom domain',
      { type: 'host', id: hostId, name: domain },
    )

    // AFTER the write, never before: the tenant re-reads on the next request,
    // so busting first would race the delete and re-warm the entry we are
    // trying to drop. The domain no longer resolves to this host, and the
    // `cname--` alias entry is the only thing that still says it does.
    await revalidateHostAliases({ subdomain, hostId, cname: domain })

    return Response.json({ detached: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Detach failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
