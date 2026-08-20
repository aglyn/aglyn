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
  checkQuota,
  createResourceUid,
  suggestSubdomains,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, registerOrgHost } from '@aglyn/tenant-data-admin'

/**
 * The two steps that actually provision a site, shared by the console's
 * `POST /api/hosts/create` and `POST /v1/sites` (AGL-2465).
 *
 * Extracted rather than copied for the reason AGL-2463 gave when `createMedia`
 * reused the console ingress helpers: a second implementation of a create-time
 * quota is a second place for the quota to be wrong, and this particular quota
 * has already been got wrong once (AGL-2063 — a `count()` followed by an
 * unconditional `set()` on a fresh id, which N concurrent POSTs all pass).
 *
 * Deliberately TWO functions rather than one `provisionHost`, so the console
 * route keeps its exact refusal ORDER. It interleaves the lockdown verdict and
 * the rate limiter between the uniqueness check and the quota claim, and that
 * order is load-bearing: 401/403/423 win, so a refused request never burns a
 * rate-limit token. Folding both steps into one call would move the 409 below
 * the limiter and quietly change which refusals cost a token.
 */

export interface SubdomainConflict {
  /** Alternatives that are themselves free — `name-2`, `name-<year>`, … */
  suggestions: string[]
}

/**
 * Is this subdomain already taken, and if so what is free instead?
 *
 * `*.aglyn.app` is ONE global namespace shared by every customer, so this is a
 * platform-wide uniqueness question and cannot be scoped to the org.
 */
export async function findSubdomainConflict(
  firestore: FirebaseFirestore.Firestore,
  subdomain: string,
): Promise<SubdomainConflict | null> {
  const taken = await firestore
    .collection('hosts')
    .where('subdomain', '==', subdomain)
    .limit(1)
    .get()
  if (taken.empty) return null
  const suggestions: string[] = []
  for (const candidate of suggestSubdomains(subdomain)) {
    const candidateTaken = await firestore
      .collection('hosts')
      .where('subdomain', '==', candidate)
      .limit(1)
      .get()
    if (candidateTaken.empty) suggestions.push(candidate)
  }
  return { suggestions }
}

export interface ClaimHostInput {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  displayName: string
  subdomain: string
  /**
   * The org document, if the caller has already read it. Only used as the
   * fallback for the quota check; the transaction re-reads the org itself,
   * because a stale copy is exactly what makes a create-time quota racy.
   */
  org?: FirebaseFirestore.DocumentData | undefined
}

/**
 * Deliberately one interface with optional fields rather than a discriminated
 * union on `allowed`. `strictNullChecks` is off repo-wide, and a `true | false`
 * discriminant does not narrow reliably for consumers in other files under
 * that setting — the union shape compiled here and failed at the call site.
 * `hostId` is set exactly when `allowed`, `limit` exactly when not.
 */
export interface ClaimHostResult {
  allowed: boolean
  /** The id of the site created. Present only when `allowed`. */
  hostId?: string
  /** The `hostLimit` that refused it. Present only when not `allowed`. */
  limit?: number
}

/**
 * Counts, claims and creates, in one transaction (AGL-2063).
 *
 * The count is the LARGER of the `orgs/{id}.hosts` directory map and a
 * pre-read aggregation, and each is here for a different reason:
 *
 * - the aggregation is authoritative for HISTORY — an org whose sites predate
 *   the directory map would otherwise read as zero and get a free extra site;
 * - the map is authoritative for CONCURRENCY, because it is written inside
 *   this same transaction, so the loser of a race re-reads it on retry, sees
 *   the winner's id and is refused. The aggregation, read before the
 *   transaction opened, can never do that.
 *
 * Returns the `hostId` it minted. Callers that need replay-safety record that
 * id in their idempotency claim, so a retry replays the original id rather
 * than provisioning a second site (AGL-2465).
 */
export async function claimHostForOrg(
  input: ClaimHostInput,
): Promise<ClaimHostResult> {
  const { firestore, orgId, displayName, subdomain, org } = input
  const hostId = createResourceUid()
  const preCount = (
    await firestore.collection('hosts').where('orgId', '==', orgId).count().get()
  ).data().count
  const orgRef = firestore.collection('orgs').doc(orgId)
  const hostRef = firestore.collection('hosts').doc(hostId)
  const claim = await firestore.runTransaction(async (tx) => {
    const fresh = await tx.get(orgRef)
    const directory = fresh.get('hosts')
    const mapped =
      directory && typeof directory === 'object'
        ? Object.values(directory as Record<string, unknown>).filter(Boolean)
            .length
        : 0
    const quota = checkQuota(
      (fresh.data() ?? org) as never,
      'hostLimit',
      Math.max(preCount, mapped),
    )
    if (!quota.allowed) return { allowed: false as const, limit: quota.limit }
    tx.set(hostRef, {
      displayName,
      subdomain,
      orgId,
      screens: {},
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    // The claim itself. `set(…, { merge: true })` deep-merges the map, so this
    // adds one key without disturbing the org's other fields — and it is what
    // makes a concurrent create see this site on its retry. `registerOrgHost`
    // writes the same key again, idempotently.
    tx.set(
      orgRef,
      {
        hosts: { [hostId]: true },
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return { allowed: true as const, limit: quota.limit }
  })
  if (!claim.allowed) return { allowed: false, limit: claim.limit }
  // Org directory + hostIndex mirror + memberRoles projection (AGL-233).
  await registerOrgHost(orgId, hostId, subdomain)
  return { allowed: true, hostId }
}
