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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { isBlockedSubdomain, SUBDOMAIN_PATTERN } from '@aglyn/aglyn/server'
import {
  domainStateServes,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  isPlatformReservedDomain,
  projectDomainStatus,
  updateExisting,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Staff host management (AGL-390): retarget a host's subdomain (validated,
 * unique, not reserved) from the staff console, and re-attach its custom
 * domain to the hosting platform (AGL-2011). Super-staff only; both audited
 * to adminAudit.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '')
  // An ALLOW-LIST, still — the second action is named, not pattern-matched,
  // so an unknown `action` is a 400 rather than a fall-through to the first.
  if (!hostId || (action !== 'set-subdomain' && action !== 'reattach-domain')) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const auth = firebaseAdmin.app().auth()
    const decoded = await auth.verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return Response.json({ error: 'Staff only' }, { status: 403 })
    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (actorRole !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }

    if (action === 'reattach-domain') {
      return await reattachDomain(hostId, decoded.uid)
    }

    const subdomain = String(body?.subdomain ?? '')
      .trim()
      .toLowerCase()
    if (!SUBDOMAIN_PATTERN.test(subdomain) || isBlockedSubdomain(subdomain)) {
      return Response.json({ error: 'Invalid or reserved subdomain' }, { status: 400 })
    }

    const firestore = firebaseAdmin.app().firestore()
    // Uniqueness: no other host may hold this subdomain.
    const taken = await firestore
      .collection('hosts')
      .where('subdomain', '==', subdomain)
      .limit(1)
      .get()
    if (!taken.empty && taken.docs[0].id !== hostId) {
      return Response.json({ error: 'That subdomain is taken' }, { status: 409 })
    }

    const hostRef = firestore.collection('hosts').doc(hostId)
    // THE EXISTENCE CHECK (AGL-1763). `hostId` is body-supplied and was only
    // ever checked non-empty; this read was already here for the audit's
    // `before` value and simply never asked `.exists` — the same one-line-away
    // shape AGL-1760 fixed. It is the guard now as well, so the cost is
    // unchanged.
    //
    // Refusing is right and nothing is discarded: this is a staff retarget, no
    // money and no prior work hang off it, and the operator fixes a mistyped id
    // by retyping it. Creating instead was actively harmful and SELF-POISONING,
    // which is what makes this worth more than a tidy-up. A merge-set minted
    // `hosts/{typo}` carrying `subdomain` and `updatedAt` and nothing else —
    // no `orgId`, no `displayName`, so invisible to every console list, which
    // scopes by `orgId`. But the uniqueness query above filters on `subdomain`
    // ALONE, so the phantom matches it. The next attempt to give that
    // subdomain to the host that should have had it is refused 409 "That
    // subdomain is taken" by a document no surface can show and no operator
    // can find — a failure that surfaces far from its cause, and only ever
    // for the one subdomain that was fat-fingered.
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'No such site' }, { status: 404 })
    }
    const before = hostSnapshot.get('subdomain') ?? null
    // SECOND LINE OF DEFENCE for the window the check cannot close — a site
    // erased between the read and the write. `update()` rejects on a missing
    // document where a merge-set creates one.
    const applied = await updateExisting(hostRef, {
      subdomain,
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (!applied) {
      return Response.json({ error: 'No such site' }, { status: 404 })
    }
    // Keep the routing mirror in step (AGL-628). `registerOrgHost` seeds
    // hostIndex.subdomain on create and /api/hosts/rename maintains it, but
    // this staff path never did — leaving a stale subdomain behind that
    // cross-org host resolution would then follow to the wrong site.
    //
    // A DELIBERATE, COMPLETE create rather than the `{ subdomain }` merge-set
    // it replaces, and the difference is not the phantom hostId — the guard
    // above already settled that. `hostIndex` is a pure projection of the host
    // doc, so re-deriving it for a host proven to exist is legitimate; a
    // `{ subdomain }`-only row is not. `orgId` is the field every reader wants
    // — `resolveOrgIdForHost` returns null without it, and null is the
    // pre-billing FAIL-OPEN (every feature on), so a subdomain-only index row
    // would hand a paid host an unmetered one. The host snapshot is in hand,
    // so both fields are written together.
    await firestore
      .collection('hostIndex')
      .doc(hostId)
      .set(
        {
          subdomain,
          ...(hostSnapshot.get('orgId')
            ? { orgId: hostSnapshot.get('orgId') }
            : {}),
        },
        { merge: true },
      )
    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      action: 'host.set-subdomain',
      target: `hosts/${hostId}`,
      before: { subdomain: before },
      after: { subdomain },
      at: FieldValue.serverTimestamp(),
    })
    return Response.json({ ok: true, subdomain }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Host update failed' }, { status: 500 })
  }
}

/**
 * Re-run the hosting-platform attach for the domain a site ALREADY holds.
 *
 * Support's half of AGL-1913. The customer's card has had a Re-attach button
 * since AGL-166; staff had no equivalent, so the only way to unstick a
 * customer's domain was to impersonate them and press theirs — an
 * impersonation session opened to press one idempotent button, which is a
 * disproportionate amount of access for the job and shows up in the audit as
 * the customer acting on themselves.
 *
 * DELIBERATELY NARROWER THAN `/api/domains/attach`, and this is the security
 * property, not a simplification: it takes NO domain from the caller. It reads
 * `host.cname` and re-attaches that. So the capability granted here is "finish
 * what this site already claims", never "give this site a domain" — a staff
 * member cannot point a customer's site at a name the customer never asked
 * for, and there is no cross-host claim to race, which is why the uniqueness
 * transaction the customer route runs has no counterpart here. The host
 * already holds the claim; that is the precondition, not the outcome.
 *
 * Writes exactly one field, `cnameAttachmentPending`, under the same
 * `domainStateServes` predicate as the attach route and the completer cron.
 */
async function reattachDomain(
  hostId: string,
  actorUid: string,
): Promise<Response> {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_TENANT_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID

  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return Response.json({ error: 'No such site' }, { status: 404 })
  }
  const domain = String(hostSnapshot.get('cname') ?? '')
    .trim()
    .toLowerCase()
  if (!domain) {
    return Response.json(
      { error: 'This site has no custom domain to re-attach.' },
      { status: 400 },
    )
  }
  // The second writer to the tenant Vercel project, and therefore the second
  // place the claim/attach correspondence can be broken (AGL-1430).
  //
  // This action cannot be pointed at an arbitrary name — it re-attaches the
  // `cname` already on the document, and the test above proves a caller-supplied
  // domain is ignored. But `/api/domains/attach` was writing reserved names into
  // that field until this change, so a host stored before it can still be
  // carrying one, and a re-attach would put that name back on the project
  // outside the claim. Refuse rather than launder it: the fix is to disconnect
  // the domain, not to press the button again.
  if (isPlatformReservedDomain(domain)) {
    return Response.json(
      {
        error:
          `"${domain}" is a platform-reserved name and must not be attached ` +
          'to a site. Disconnect it rather than re-attaching.',
      },
      { status: 409 },
    )
  }
  if (!token || !projectId) {
    // The same 501 the customer route and the cron give, for the same reason:
    // on a self-hosted deployment there is no platform API to ask. NOT a 500 —
    // nothing is broken, the capability simply is not configured, and the card
    // renders a 501 as information rather than an error.
    return Response.json(
      {
        error:
          'Domain attachment is not configured (missing VERCEL_TOKEN / ' +
          'VERCEL_TENANT_PROJECT_ID).',
      },
      { status: 501 },
    )
  }

  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  const response = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/domains${query}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    },
  )
  const payload = await response.json().catch(() => null)
  // `domain_already_in_use` is the answer for a domain that is ALREADY on the
  // project, which is the common case for a re-attach and is success here. It
  // is not taken as a green light: `projectDomainStatus` below asks whether
  // the name is on OUR project rather than inferring it from the error code,
  // so the same code coming back from a name held elsewhere still resolves to
  // `not-attached`.
  if (!response.ok && payload?.error?.code !== 'domain_already_in_use') {
    console.error(payload)
    await hostRef
      .set({ cnameAttachmentPending: true }, { merge: true })
      .catch(() => undefined)
    return Response.json(
      { error: payload?.error?.message ?? 'Attach failed at the platform' },
      { status: 502 },
    )
  }

  const status = await projectDomainStatus(domain, { projectId })
  const serving = domainStateServes(status.state)
  const before = hostSnapshot.get('cnameAttachmentPending') === true
  await hostRef
    .set(
      {
        cnameAttachmentPending: serving
          ? firebaseAdmin.firestore.FieldValue.delete()
          : // Not a lie about the attach: it landed. But this field is what
            // `liveCustomDomain` reads to decide whether visitors may be sent
            // here, and a domain awaiting an ownership challenge or pointed
            // elsewhere is exactly what that guard exists for.
            true,
      },
      { merge: true },
    )
    .catch(() => undefined)

  // Audited like every other staff write on this route. The row records the
  // PROBED state rather than "re-attached", because the interesting question
  // afterwards is what the platform said, not that somebody pressed a button.
  await firestore.collection('adminAudit').add({
    actorUid,
    action: 'host.reattach-domain',
    target: `hosts/${hostId}`,
    before: { cnameAttachmentPending: before },
    after: { cnameAttachmentPending: !serving, state: status.state },
    at: FieldValue.serverTimestamp(),
  })

  return Response.json(
    {
      ok: true,
      domain,
      state: status.state,
      serving,
      attachmentPending: !serving,
    },
    { status: 200 },
  )
}

export const dynamic = 'force-dynamic'
export { handler as POST }
