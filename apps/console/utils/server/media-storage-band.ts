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

import { resolveOrgEntitlements, UNLIMITED } from '@aglyn/aglyn/server'
import type { AglynOrgBilling } from '@aglyn/aglyn/server'

/**
 * The org's media band, and everything already stored against it (AGL-2075).
 *
 * ## The second band nobody bought
 *
 * `resolveMediaScope` serves TWO libraries — `hosts/{hostId}` and the org's
 * shared `orgs/{orgId}` one — each with its own
 * `counters/media.bytes` document, and every ingress route checked its
 * scope's counter against the same `storagePerHostMb`. So the org library got
 * a full second band of its own: a free org's real media ceiling was
 * `250 MB (its one site) + 250 MB (the library) = 500 MB` against a published
 * 250 MB per site, and a downgraded org kept `(sites + 1) × storagePerHostMb`
 * whatever plan it landed on.
 *
 * ## Why the band is org-wide rather than per-scope
 *
 * Because that is the band the INVOICE already uses.
 * `meteredIncludedAllowance` sizes the included allowance as
 * `hostLimit × storagePerHostMb`, and `usage-alerts` checks org media —
 * "every site's library PLUS the org's shared one" — against exactly that
 * number. Enforcement was the only place asking a different question, and it
 * asked it once per scope, which is how one published figure became two
 * different ceilings and neither matched what would be billed.
 *
 * Pooling makes all three agree. Free (`hostLimit: 1`) lands on exactly the
 * published 250 MB across both libraries. A paid org keeps the same total it
 * always had and may now spend it wherever it likes, which is strictly more
 * useful and no more expensive.
 *
 * ## The order-dependence this closes
 *
 * A per-scope band cannot be fixed by capping the library alone: whichever
 * scope is filled first leaves the other its own full allowance, so the
 * effective total depends on upload order. One pooled figure has no order.
 */
export interface OrgMediaBand {
  /** Bytes already stored across every media scope the org owns. */
  usedBytes: number
  /**
   * The org-wide included band in MB, `Infinity` when the plan is unlimited.
   * Feed this to `mediaStorageGate` as `allowanceMb`.
   */
  allowanceMb: number
}

/**
 * `orgs/{id}.hosts` is the directory the site cap is claimed against
 * (AGL-2063), so it is the authoritative list — but it postdates some orgs,
 * and a host that predates it would silently contribute zero bytes to the
 * pool. The fallback query costs nothing in the normal case because it only
 * runs when the map is empty.
 */
async function orgHostIds(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  org: Partial<AglynOrgBilling>,
  currentHostId?: string | null,
): Promise<string[]> {
  const directory = (org as { hosts?: Record<string, unknown> }).hosts
  const ids = new Set<string>(
    directory && typeof directory === 'object'
      ? Object.entries(directory)
          .filter(([, value]) => Boolean(value))
          .map(([hostId]) => hostId)
      : [],
  )
  if (!ids.size) {
    const legacy = await firestore
      .collection('hosts')
      .where('orgId', '==', orgId)
      .select()
      .get()
    for (const doc of legacy.docs) ids.add(doc.id)
  }
  // The scope being written to, even if the directory has not caught up —
  // omitting it would let the very upload being gated go uncounted.
  if (currentHostId) ids.add(currentHostId)
  return [...ids]
}

/**
 * Reads the org's whole media pool in ONE round trip.
 *
 * Short-circuits to zero reads on an unlimited band: nothing the sum could
 * say would change the verdict, and enterprise is the plan with the most
 * sites to fan out over.
 */
export async function resolveOrgMediaBand(options: {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  org: Partial<AglynOrgBilling> | null | undefined
  /** The host whose library is being written to, when the scope is a site. */
  currentHostId?: string | null
}): Promise<OrgMediaBand> {
  const { firestore, orgId, org, currentHostId } = options
  const entitlements = resolveOrgEntitlements(org)
  const perScopeMb = entitlements.storagePerHostMb
  if (perScopeMb === UNLIMITED || !Number.isFinite(perScopeMb)) {
    return { usedBytes: 0, allowanceMb: Number.POSITIVE_INFINITY }
  }
  // `Math.max(1, …)` mirrors `meteredIncludedAllowance` exactly — the band
  // the invoice subtracts and the band ingress refuses at must be the same
  // arithmetic, not two expressions that happen to agree today.
  const hostLimit = Math.max(1, entitlements.hostLimit)
  const allowanceMb =
    hostLimit === UNLIMITED || !Number.isFinite(hostLimit)
      ? Number.POSITIVE_INFINITY
      : hostLimit * perScopeMb
  if (!Number.isFinite(allowanceMb)) {
    return { usedBytes: 0, allowanceMb }
  }
  const hostIds = await orgHostIds(firestore, orgId, org ?? {}, currentHostId)
  const refs = [
    ...hostIds.map((hostId) =>
      firestore.collection('hosts').doc(hostId).collection('counters').doc('media'),
    ),
    firestore.collection('orgs').doc(orgId).collection('counters').doc('media'),
  ]
  const snapshots = await firestore.getAll(...refs)
  let usedBytes = 0
  for (const snapshot of snapshots) {
    const bytes = Number(snapshot.get('bytes') ?? 0)
    // A corrupt or negative counter must not become free capacity.
    if (Number.isFinite(bytes) && bytes > 0) usedBytes += bytes
  }
  return { usedBytes, allowanceMb }
}
