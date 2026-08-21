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
  countCollaboratorSeats,
  pluginRequestFromWeb,
  resolveCollaboratorSeatPool,
  resolveHostCollaboratorCap,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

// lockdown-423: exempt — same posture as the sibling add-on route it serves.
// AGL-1501 keeps billing/maintenance-locked sessions alive precisely so
// members can reach Billing; a 423 on the surface that assigns capacity they
// already bought would break the page they need. Security/manual locks revoke
// tokens at lock time, which closes this surface within the token hour.

/**
 * Assign purchased COLLABORATOR seats to sites (AGL-2439).
 *
 * `seatAddons.members` is an org-level POOL since Zach's 2026-08-19 decision:
 * one extra collaborator seat buys one site's worth of capacity, not one per
 * site. This route is the ONLY thing that writes `org.collaboratorAllocations`,
 * which says which site holds each seat.
 *
 * The AGL-1775 register route, on the other key. Deliberately the same file
 * shape, the same actions and the same refusal codes: this is ONE mechanism
 * used twice and a reader who has understood one has understood both.
 *
 *   `get` → the pool (purchased / allocated / available) and, per site, the
 *           seats it holds, the collaborators on it, and its effective cap
 *   `set` → assign `seats` to `hostId` (0 releases them back to the pool)
 *
 * `billing.manage`-gated: this is capacity that costs money, so it is the same
 * permission that buys it. Admin-SDK-only by construction — the rules deny
 * `collaboratorAllocations` to every client, staff included, because a client
 * that could write it would assign itself the whole pool on every site, which
 * is the exact defect the pool exists to close.
 *
 * THE INVARIANT, enforced here rather than trusted: the sum of allocations
 * never exceeds the purchased pool. The resolver clamps too — a stale map can
 * outlive a reduced purchase — but a write path that let the sum run over
 * would leave the console showing capacity that enforcement then refuses.
 *
 * NOTHING HERE CAN REMOVE A COLLABORATOR, and that is the grandfather
 * boundary (AGL-2439) at this surface. Releasing a seat from a site that is
 * using it lowers that site's cap; the collaborators already on it keep their
 * access and only the NEXT add is refused. `strandedCollaborators` is returned
 * so the console can say that before the seat moves rather than leaving an
 * admin to discover a refusal later — it is a warning, never a refusal, and it
 * must never become one.
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
  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (!orgId || !['get', 'set'].includes(action)) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'billing.manage'))
    ) {
      return Response.json({ error: 'billing.manage required' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const org = (orgSnapshot.data() ?? {}) as any

    /**
     * The site's collaborator head-count, through the SAME counter the cap is
     * enforced with (`countCollaboratorSeats` over the org roster plus
     * un-accepted invites) rather than a `hosts/{id}/members` aggregate.
     *
     * `hosts/{id}/members` is a DISPLAY roster only `/api/hosts/members`
     * writes — the AGL-2068 finding. Three of the four doors that admit a
     * collaborator never touch it, so counting it here would under-report and
     * this surface would offer to release a seat that is in fact holding
     * somebody's access.
     */
    const seatEntries = async () => {
      const [members, invites] = await Promise.all([
        orgRef.collection('members').get(),
        orgRef.collection('invites').where('acceptedAt', '==', null).get(),
      ])
      return [
        ...members.docs.map((doc) => ({ uid: doc.id, ...doc.data() }) as never),
        ...invites.docs.map((doc) => doc.data() as never),
      ]
    }

    if (action === 'get') {
      const pool = resolveCollaboratorSeatPool(org)
      const entries = await seatEntries()
      const hosts = await firestore
        .collection('hosts')
        .where('orgId', '==', orgId)
        .limit(200)
        .get()
      const sites = hosts.docs.map((host) => {
        const cap = resolveHostCollaboratorCap(org, host.id)
        return {
          hostId: host.id,
          displayName: host.get('displayName') ?? null,
          collaborators: countCollaboratorSeats(entries, host.id),
          allocatedSeats: pool.byHost[host.id] ?? 0,
          // See the entitlement notes below — same wire contract, per site.
          cap: Number.isFinite(cap) ? cap : 0,
          capUnlimited: !Number.isFinite(cap),
        }
      })
      const entitlements = resolveOrgEntitlements(org)
      const planCapPerSite = entitlements.membersPerHost
      const maxCapPerSite = entitlements.maxMembersPerHost
      return Response.json(
        {
          pool,
          // Enterprise sets `membersPerHost` and `maxMembersPerHost` to
          // `UNLIMITED`, which is `Number.POSITIVE_INFINITY`, and
          // `JSON.stringify(Infinity)` is `null`. Sent raw, the card compared
          // a live head-count against `null` — and `1 > null` is TRUE, so a
          // site with one collaborator on an uncapped plan rendered the
          // grandfather notice ("1 over the limit and kept") directly beneath
          // a readout of "1/∞ collaborators". Worse, `null >= null` is also
          // true, so the same row claimed it was "At your plan's maximum of
          // null per site — upgrade instead" on the top plan.
          //
          // Explicit flags rather than magic numbers, for the AGL-2482
          // reason: `null` on the wire cannot distinguish "unlimited" from
          // "the field is missing", and the card has to tell those apart.
          planCapPerSite: Number.isFinite(planCapPerSite) ? planCapPerSite : 0,
          planCapPerSiteUnlimited: !Number.isFinite(planCapPerSite),
          // The BAND. Assigning past it cannot raise a site's cap — the only
          // path beyond is a plan upgrade — so the console must not present
          // an over-band assignment as capacity.
          maxCapPerSite: Number.isFinite(maxCapPerSite) ? maxCapPerSite : 0,
          maxCapPerSiteUnlimited: !Number.isFinite(maxCapPerSite),
          sites,
        },
        { status: 200 },
      )
    }

    const hostId = String(body?.hostId ?? '')
    const seats = Math.floor(Number(body?.seats))
    if (!hostId || !Number.isFinite(seats) || seats < 0) {
      return Response.json({ error: 'Bad request' }, { status: 400 })
    }
    // The host must belong to THIS org. Without it, a manager of org A could
    // pin org A's paid seats onto a site in org B — raising a cap in an org
    // that never bought it, off a subscription that did.
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists || hostSnapshot.get('orgId') !== orgId) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }

    const pool = resolveCollaboratorSeatPool(org)
    const current = pool.byHost[hostId] ?? 0
    const wouldAllocate = pool.allocated - current + seats
    if (wouldAllocate > pool.purchased) {
      return Response.json(
        {
          error:
            `You have ${pool.purchased} purchased collaborator seat` +
            `${pool.purchased === 1 ? '' : 's'} and ` +
            `${pool.available} unassigned — buy another in Billing → Add-ons ` +
            'to assign more.',
          code: 'pool_exhausted',
          pool,
        },
        { status: 409 },
      )
    }

    const entries = await seatEntries()
    const collaborators = countCollaboratorSeats(entries, hostId)
    const newCap = resolveHostCollaboratorCap(
      { ...org, collaboratorAllocations: { ...(org.collaboratorAllocations ?? {}), [hostId]: seats } },
      hostId,
    )
    // Releasing a seat a site is USING leaves that site over its new cap. The
    // collaborators on it KEEP their access — nothing in this repo revokes for
    // being over a cap (AGL-2439's grandfather boundary) — and only the next
    // add is refused. Returned so the console can say it before the seat
    // moves, not as a reason to refuse the move.
    const strandedCollaborators = Math.max(0, collaborators - newCap)

    await orgRef.set(
      {
        collaboratorAllocations: {
          // A zero is a RELEASE, and it deletes the key rather than storing
          // `0`. The pool is `purchased - sum(allocations)`, so a stored zero
          // would be arithmetically identical but would leave the map growing
          // a permanent row for every site that ever held a seat.
          [hostId]: seats > 0 ? seats : FieldValue.delete(),
        },
      },
      { merge: true },
    )
    await firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        actorEmail: decoded.email ?? null,
        action: 'billing.collaboratorAllocation',
        target: `orgs/${orgId}/hosts/${hostId}`,
        before: { seats: current },
        after: { seats },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    const nextAllocations = { ...(org.collaboratorAllocations ?? {}) }
    if (seats > 0) nextAllocations[hostId] = seats
    else delete nextAllocations[hostId]
    const updated = resolveCollaboratorSeatPool({
      ...org,
      collaboratorAllocations: nextAllocations,
    })
    return Response.json(
      {
        ok: true,
        pool: updated,
        // Same wire contract as the `get` above: an UNLIMITED cap would
        // serialise as `null` here too.
        hostCap: Number.isFinite(newCap) ? newCap : 0,
        hostCapUnlimited: !Number.isFinite(newCap),
        strandedCollaborators,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: 'Collaborator allocation failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
