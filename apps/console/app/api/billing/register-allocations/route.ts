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
  pluginRequestFromWeb,
  resolveHostRegisterCap,
  resolveOrgEntitlements,
  resolveRegisterSeatPool,
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
 * Assign purchased POS register seats to sites (AGL-1775).
 *
 * `seatAddons.posRegisters` is an org-level POOL since Zach's 2026-08-17
 * decision: $89/mo buys one register's worth of entitlement, not one per site.
 * This route is the ONLY thing that writes `org.registerAllocations`, which
 * says which site holds each seat.
 *
 *   `get` → the pool (purchased / allocated / available) and, per site, the
 *           seats it holds, the registers it is running, and its effective cap
 *   `set` → assign `seats` to `hostId` (0 releases them back to the pool)
 *
 * `billing.manage`-gated: this is capacity that costs money, so it is the same
 * permission that buys it. Admin-SDK-only by construction — the rules deny
 * `registerAllocations` to every client, staff included, because a client that
 * could write it would assign itself the whole pool on every site, which is
 * the exact defect the pool exists to close.
 *
 * THE INVARIANT, enforced here rather than trusted: the sum of allocations
 * never exceeds the purchased pool. The resolver clamps too — a stale map can
 * outlive a reduced purchase — but a write path that let the sum run over
 * would leave the console showing capacity that enforcement then refuses,
 * which reads as a bug in the register rather than in the allocation.
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

    if (action === 'get') {
      const pool = resolveRegisterSeatPool(org)
      const hosts = await firestore
        .collection('hosts')
        .where('orgId', '==', orgId)
        .limit(200)
        .get()
      const sites = await Promise.all(
        hosts.docs.map(async (host) => ({
          hostId: host.id,
          displayName: host.get('displayName') ?? null,
          // The live register count, from a server aggregate — the number a
          // console listener holds is a LOWER bound (AGL-1738) and this one
          // decides whether releasing a seat would strand a running register.
          registers: Number(
            (await host.ref.collection('registers').count().get()).data()
              .count ?? 0,
          ),
          allocatedSeats: pool.byHost[host.id] ?? 0,
          cap: resolveHostRegisterCap(org, host.id),
        })),
      )
      return Response.json(
        {
          pool,
          planCapPerSite: resolveOrgEntitlements(org).posRegisters,
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

    const pool = resolveRegisterSeatPool(org)
    const current = pool.byHost[hostId] ?? 0
    const wouldAllocate = pool.allocated - current + seats
    if (wouldAllocate > pool.purchased) {
      return Response.json(
        {
          error:
            `You have ${pool.purchased} purchased register seat` +
            `${pool.purchased === 1 ? '' : 's'} and ` +
            `${pool.available} unassigned — buy another in Billing → Add-ons ` +
            'to assign more.',
          code: 'pool_exhausted',
          pool,
        },
        { status: 409 },
      )
    }

    // Releasing a seat a site is USING would leave a live register over its
    // cap: it keeps existing, and `pos-order.ts` refuses to sell through it by
    // creation rank. That is recoverable and reversible, so it is a warning
    // and not a refusal — but the count is returned so the console can say it
    // before the seat moves rather than after a cashier finds out.
    const registersInUse = Number(
      (await hostSnapshot.ref.collection('registers').count().get()).data()
        .count ?? 0,
    )
    const planCap = resolveOrgEntitlements(org).posRegisters
    const strandedRegisters = Math.max(0, registersInUse - (planCap + seats))

    await orgRef.set(
      {
        registerAllocations: {
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
        action: 'billing.registerAllocation',
        target: `orgs/${orgId}/hosts/${hostId}`,
        before: { seats: current },
        after: { seats },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    const updated = resolveRegisterSeatPool({
      ...org,
      registerAllocations: {
        ...(org.registerAllocations ?? {}),
        ...(seats > 0 ? { [hostId]: seats } : {}),
        ...(seats > 0 ? {} : { [hostId]: 0 }),
      },
    })
    return Response.json(
      {
        ok: true,
        pool: updated,
        hostCap: planCap + seats,
        strandedRegisters,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Register allocation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
