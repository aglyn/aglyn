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

/**
 * The org- and host-scope lockdown CORE (AGL-1501), shared by the staff
 * panic button (/api/admin/lockdown) and the env-gated billing auto-lock
 * sweep — one implementation, so the two callers cannot drift.
 *
 * An org lockdown is FIVE effects, not a flag write, and this module is the
 * only writer so all five always happen together:
 *
 *  1. the org doc's `suspendedAt` family — what every shipped AGL-202
 *     reader (tenant loader, console APIs, rules) already enforces on;
 *  2. the `orgSuspended` member projection — which the rules (:59) and
 *     three API routes read but, before this module, NOTHING wrote (found
 *     while building AGL-1501: the client-side staff toggle only ever wrote
 *     the org doc, so the projection-based write blocks never engaged);
 *  3. refresh-token revocation for the members (security/manual reasons) —
 *     "logged out" must mean logged out, pool-aware for SSO orgs;
 *  4. tenant ISR revalidation for every host — a taken-down site must stop
 *     serving cached pages now, not when `revalidate = 60` gets around
 *     to it;
 *  5. raw Firebase Storage download-token rotation on a `security` lock
 *     (AGL-1526) — effects 1-4 all run on origins we control, and the
 *     `firebasestorage.googleapis.com/...?alt=media&token=` URL is not one
 *     of them. See `media-download-tokens.ts` for why this is `security`-
 *     only, why it is awaited rather than fired async, and what it cannot
 *     do (AGL-1615: it kills the URL, never the bytes already fetched).
 */

import {
  authForPool,
  findUserByUidAcrossPools,
  invalidateTokenRevocationCache,
  listOrgMembers,
  lockRotatesDownloadTokens,
  rotateScopeDownloadTokens,
  type DownloadTokenRotationResult,
} from '@aglyn/tenant-data-admin'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { revalidateEntireHost } from './tenant-revalidate'

/**
 * Revocation fan-out bound. An org roster larger than this still locks —
 * the enforcement is server-side — but tail members keep their tokens for
 * up to an hour instead of being cut immediately; the response reports it.
 */
const MAX_REVOKE_MEMBERS = 200

export interface LockdownWriteOptions {
  reason: string
  /** Customer/visitor-facing notice body; already validated/bounded. */
  message?: string
  untilMs?: number
  /**
   * How hard the lock bites (AGL-1511). Written to `suspendedMode` ONLY for
   * `read-only`; a full lock deletes the key, so the carrier of a full lock
   * is identical to one written before this field existed and every reader
   * that has never heard of it stays correct.
   */
  mode?: 'full' | 'read-only'
  /**
   * What happens if the carrier cannot be READ (AGL-1621). Written to
   * `suspendedEnforcement` ONLY for `takedown`; a standard lock deletes the
   * key, so its carrier is identical to one written before this field
   * existed and absent keeps meaning fail-open — the shipped behaviour and
   * the safe default.
   */
  enforcement?: 'standard' | 'takedown'
}

/**
 * Ask the tenant runtime to drop EVERY routed page of a host.
 *
 * DELEGATES to `revalidateEntireHost` (AGL-1152). This was a hand-rolled copy
 * of the same request, and it carried the bug AGL-2195 exists to prevent: it
 * re-derived the apex from `NEXT_PUBLIC_TENANT_DOMAIN` with OUR domain as the
 * literal default, so a self-hoster's lockdown posted its cache drop at
 * `aglyn.app` — a drop that never lands on their pages, and an unsolicited
 * request to a host they do not own. `revalidateEntireHost` reads `TENANT_APEX`,
 * which is the one sanctioned reader of that variable.
 *
 * The return shape is unchanged, so `OrgLockdownResult` and the routes that
 * report it are untouched.
 *
 * BEST EFFORT: enforcement does not depend on it (the tenant middleware verdict
 * is request-level); this only shrinks the stale window of any cached HTML.
 */
export async function revalidateHostAfterLockdown(
  firestore: Firestore,
  hostId: string,
): Promise<{ hostId: string; ok: boolean; reason: string }> {
  const result = await revalidateEntireHost(firestore, hostId)
  return { hostId, ok: result.reason === 'ok', reason: result.reason }
}

export interface OrgLockdownResult {
  orgId: string
  action: 'lock' | 'unlock'
  membersUpdated: number
  tokensRevoked: number
  revokeTruncated: boolean
  revalidated: Array<{ hostId: string; ok: boolean; reason: string }>
  /**
   * Raw download-URL revocation, one entry per Storage prefix. EMPTY for
   * every lock that does not qualify (see `lockRotatesDownloadTokens`) and
   * for every unlock — an empty array means "not attempted", which is not
   * the same as an entry reporting zero rotations.
   */
  downloadTokensRotated: DownloadTokenRotationResult[]
}

/**
 * Apply (or lift) an org lockdown — all four effects. The caller has
 * already authorized the action and writes the audit row (staff route) or
 * is the env-gated sweep (which audits as its system actor).
 */
export async function applyOrgLockdown(options: {
  firestore: Firestore
  orgId: string
  action: 'lock' | 'unlock'
  lock?: LockdownWriteOptions
  /**
   * Revoke members' refresh tokens. The staff route passes true for
   * `security`/`manual` locks — those want the operator's "everyone out
   * NOW". `billing`/`maintenance` keep sessions: members must be able to
   * reach console billing settings to fix the thing (the org's sites and
   * writes are locked either way, server-side).
   */
  revokeMemberTokens?: boolean
}): Promise<OrgLockdownResult> {
  const { firestore, orgId, action } = options
  const orgRef = firestore.collection('orgs').doc(orgId)

  // 1. The org doc: the carrier every shipped reader already enforces on.
  // Legacy `suspendedReason` gets the reason CODE so the pre-lockdown staff
  // list/detail chips keep rendering something truthful; the free-text staff
  // rationale belongs in the audit row, not on the doc.
  if (action === 'lock') {
    await orgRef.set(
      {
        suspendedAt: FieldValue.serverTimestamp(),
        suspendedReason: options.lock?.reason ?? 'manual',
        suspendedReasonCode: options.lock?.reason ?? 'manual',
        ...(options.lock?.message
          ? { suspendedMessage: options.lock.message }
          : { suspendedMessage: FieldValue.delete() }),
        ...(typeof options.lock?.untilMs === 'number'
          ? { suspendedUntilMs: options.lock.untilMs }
          : { suspendedUntilMs: FieldValue.delete() }),
        ...(options.lock?.mode === 'read-only'
          ? { suspendedMode: 'read-only' }
          : { suspendedMode: FieldValue.delete() }),
        ...(options.lock?.enforcement === 'takedown'
          ? { suspendedEnforcement: 'takedown' }
          : { suspendedEnforcement: FieldValue.delete() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  } else {
    await orgRef.set(
      {
        suspendedAt: FieldValue.delete(),
        suspendedReason: FieldValue.delete(),
        suspendedReasonCode: FieldValue.delete(),
        suspendedMessage: FieldValue.delete(),
        suspendedUntilMs: FieldValue.delete(),
        suspendedMode: FieldValue.delete(),
        suspendedEnforcement: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  // 2. The `orgSuspended` member projection (AGL-210's read side). Batched;
  // rosters are bounded by seat plans, well under a batch's 500 writes.
  const members = await listOrgMembers(orgId)
  const batch = firestore.batch()
  for (const member of members) {
    batch.set(
      orgRef.collection('members').doc(member.$id),
      { orgSuspended: action === 'lock' },
      { merge: true },
    )
  }
  await batch.commit()

  // 3. Real logout, pool-aware. Best-effort per member: one deleted auth
  // account must not leave the rest signed in.
  let tokensRevoked = 0
  const revokeTargets =
    action === 'lock' && options.revokeMemberTokens
      ? members.slice(0, MAX_REVOKE_MEMBERS)
      : []
  for (const member of revokeTargets) {
    try {
      const found = await findUserByUidAcrossPools(member.$id)
      if (!found) continue
      // Never revoke a staff session, even one that is somehow on the
      // roster of a locked org — the un-panic invariant extends to the
      // logout fan-out.
      if (found.record.customClaims?.['staff'] === true) continue
      await authForPool(found.tenantId).revokeRefreshTokens(member.$id)
      invalidateTokenRevocationCache(member.$id, found.tenantId ?? null)
      tokensRevoked += 1
    } catch (error) {
      console.error('[lockdown] token revoke failed', member.$id, error)
    }
  }

  // 4. Evict cached tenant pages for every host, on lock AND unlock — a
  // lifted lockdown should also stop serving the notice promptly.
  const orgSnapshot = await orgRef.get()
  const hostIds = Object.keys(
    (orgSnapshot.get('hosts') ?? {}) as Record<string, true>,
  )
  const revalidated = []
  for (const hostId of hostIds) {
    revalidated.push(await revalidateHostAfterLockdown(firestore, hostId))
  }

  // 5. Kill the raw `firebasestorage.googleapis.com?...&token=` URLs
  // (AGL-1526). Effects 1-4 are all enforced by code of ours; that URL is
  // served by Google's edge, so the ONLY way a lock reaches it is to
  // rewrite the token in the object's metadata.
  //
  // BOTH prefix families, deliberately: an org's media lives under
  // `orgs/{orgId}/` but each SITE's library is its own Storage tree under
  // `hosts/{hostId}/` (`MediaScope.base`), and those are most of the assets
  // a taken-down org is actually serving. Cleaning only the org tree would
  // be the recognisable half-wired control.
  //
  // Last, after the lock is already durable: rotation is the slowest effect
  // and the one most likely to be truncated, and no part of enforcement
  // depends on it having finished.
  let downloadTokensRotated: DownloadTokenRotationResult[] = []
  if (action === 'lock' && lockRotatesDownloadTokens(options.lock ?? {})) {
    downloadTokensRotated = await rotateScopeDownloadTokens({
      prefixes: [
        `orgs/${orgId}/`,
        ...hostIds.map((hostId) => `hosts/${hostId}/`),
      ],
    })
  }

  return {
    orgId,
    action,
    membersUpdated: members.length,
    tokensRevoked,
    downloadTokensRotated,
    revokeTruncated:
      action === 'lock' &&
      Boolean(options.revokeMemberTokens) &&
      members.length > MAX_REVOKE_MEMBERS,
    revalidated,
  }
}

/**
 * Apply (or lift) a HOST takedown: the staff `suspendedAt` family on the
 * host doc (NOT the customer's `maintenance` switch) plus cache eviction.
 * Plain epoch ms on purpose — Admin-SDK partial write, converter-free.
 */
export async function applyHostLockdown(options: {
  firestore: Firestore
  hostId: string
  action: 'lock' | 'unlock'
  lock?: LockdownWriteOptions
}): Promise<{
  hostId: string
  action: string
  revalidated: { ok: boolean; reason: string }
  downloadTokensRotated: DownloadTokenRotationResult[]
}> {
  const { firestore, hostId, action } = options
  const hostRef = firestore.collection('hosts').doc(hostId)
  if (action === 'lock') {
    await hostRef.set(
      {
        suspendedAt: Date.now(),
        suspendedReasonCode: options.lock?.reason ?? 'manual',
        ...(options.lock?.message
          ? { suspendedMessage: options.lock.message }
          : { suspendedMessage: FieldValue.delete() }),
        ...(typeof options.lock?.untilMs === 'number'
          ? { suspendedUntilMs: options.lock.untilMs }
          : { suspendedUntilMs: FieldValue.delete() }),
        ...(options.lock?.mode === 'read-only'
          ? { suspendedMode: 'read-only' }
          : { suspendedMode: FieldValue.delete() }),
        ...(options.lock?.enforcement === 'takedown'
          ? { suspendedEnforcement: 'takedown' }
          : { suspendedEnforcement: FieldValue.delete() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  } else {
    await hostRef.set(
      {
        suspendedAt: FieldValue.delete(),
        suspendedReasonCode: FieldValue.delete(),
        suspendedMessage: FieldValue.delete(),
        suspendedUntilMs: FieldValue.delete(),
        suspendedMode: FieldValue.delete(),
        suspendedEnforcement: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }
  const revalidated = await revalidateHostAfterLockdown(firestore, hostId)
  // The same AGL-1526 revocation at host scope: one site's Storage tree.
  // A host takedown is the scope a DMCA/abuse report usually lands on, so
  // it needs the raw-URL kill at least as much as the org scope does.
  const downloadTokensRotated =
    action === 'lock' && lockRotatesDownloadTokens(options.lock ?? {})
      ? await rotateScopeDownloadTokens({ prefixes: [`hosts/${hostId}/`] })
      : []
  return { hostId, action, revalidated, downloadTokensRotated }
}
