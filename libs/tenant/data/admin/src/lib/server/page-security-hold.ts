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

/*==========================================
 * THE AUTOMATIC SECURITY HOLD (AGL-3450).
 *
 * The page screen (`hosted-page-review.ts`) holds a phishing page: the
 * version is not served and an urgent `phishing` row lands in the abuse
 * queue. When the workspace is in its first fortnight
 * ({@link isYoungWorkspaceAge}), a hold is also the moment to stop the
 * ACCOUNT: the two document-share harvesters found on 2026-10-01 were each
 * one page in a days-old workspace, and nothing stopped the same account
 * publishing the next one. So a held page from a young workspace places a
 * `security` lock on the workspace, on the site (`takedown`, so it stays down
 * through an outage) and on the account that published it.
 *
 * `security`, never `abuse`: `abuse` is a permanent ban, and a screen is not
 * a person. The hold is reversible and precautionary; staff confirm it and
 * re-place it as `abuse` by hand, or lift it on Staff → Lockdown, so a false
 * positive costs a support email rather than an account.
 *
 * ## Split by where each half can run
 *
 * The review runs wherever a page is composed — the published-site runtime
 * on every render, and the console's link re-check. The lock does not: it is
 * the staff lockdown path (`apps/console/utils/server/org-lockdown.ts` and
 * its neighbours), which revokes sessions, evicts the tenant cache, emails
 * the owners and writes the audit trail, and which only the console holds.
 * So this module is the DURABLE half: a `securityHolds/{orgId}` document,
 * created once, that says "this workspace is to be held, and why". The
 * console applies every pending one on its fifteen-minute tick and at the
 * end of any console sweep that held a page.
 *
 * ## Idempotent by construction
 *
 * One document per WORKSPACE, created in a transaction only when absent. A
 * second held page from the same workspace finds it and does nothing: no
 * second lock, notice or alert. Once staff have looked at a workspace and
 * lifted its hold, its next held page is held and queued for them as usual,
 * and is not locked again automatically — staff are the ones who know it now.
 *
 * ## Never the house
 *
 * A workspace that owns the platform's own marketing site
 * (`PLATFORM_MARKETING_HOST_ID`) is never held here; the console re-checks
 * that and refuses a workspace owned by a staff account before it locks
 * anything.
 *=========================================*/

import {
  describePhishingScreenSignals,
  isYoungWorkspaceAge,
  type PhishingScreenSignal,
} from '@aglyn/shared-util-email/outbound-phishing-screen'
import firebaseAdmin from './firebase-admin'
import { platformMarketingHostId } from './platform-marketing-consent'

/** Where a workspace's automatic hold is recorded: one document per workspace. */
export const SECURITY_HOLD_COLLECTION = 'securityHolds'

/** The actor every automatic hold's audit rows name. */
export const SECURITY_HOLD_ACTOR_UID = 'system:page-screen'

/** How long one console run may hold a claim before another may take it over. */
export const SECURITY_HOLD_CLAIM_LEASE_MS = 10 * 60_000

/** The lock reason a hold places. Never `abuse`: see the module header. */
export const SECURITY_HOLD_LOCK_REASON = 'security'

/**
 * - `pending` — requested; the console has not applied it yet.
 * - `applying` — a console run claimed it.
 * - `applied` — the locks were placed (see `outcome` for each).
 * - `skipped` — nothing was locked, and `outcome.skipped` says why: the house,
 *   a staff-owned workspace, a workspace already gone.
 */
export type SecurityHoldState = 'pending' | 'applying' | 'applied' | 'skipped'

/** What a held page asks the console to hold. */
export interface SecurityHoldRequest {
  orgId: string
  hostId: string
  screenId: string
  versionId: string
  /** The abuse row the page hold filed, and its `HS-…` reference. */
  reviewId: string
  reference: string
  signals: readonly PhishingScreenSignal[]
  ageDays: number | null
  /** The page, in the words the review row names it. */
  pageLabel: string
  pageUrl: string | null
  siteName: string | null
}

/** The stored document. */
export interface SecurityHoldRecord extends SecurityHoldRequest {
  state: SecurityHoldState
  /** The signals, in the words staff read on the abuse row. */
  evidence: string
  requestedAtMs: number
  claimedAtMs?: number | null
  settledAtMs?: number | null
  /** What the console did, step by step. */
  outcome?: Record<string, unknown> | null
}

export type SecurityHoldRequestOutcome =
  | 'requested'
  | 'exists'
  | 'not-young'
  | 'no-workspace'
  | 'house'
  | 'failed'

/**
 * Does this workspace own the platform's own marketing site? Read from the
 * org document the caller already holds, so asking costs nothing. `false` on
 * an install that names no marketing host.
 */
export function isHouseWorkspace(input: {
  hostId?: string | null
  org?: Record<string, unknown> | null
}): boolean {
  const house = platformMarketingHostId()
  if (!house) return false
  if (input.hostId === house) return true
  const hosts = input.org?.['hosts']
  return Boolean(hosts && typeof hosts === 'object' && house in (hosts as Record<string, unknown>))
}

/** Workspaces this process already asked about, so a busy held page asks once. */
const requestedMemo = new Set<string>()

/** Test seam: forget what this process asked. */
export function resetPageSecurityHoldMemoForTests(): void {
  requestedMemo.clear()
}

function holdsCollection(firestore?: FirebaseFirestore.Firestore) {
  return (firestore ?? firebaseAdmin.app().firestore()).collection(SECURITY_HOLD_COLLECTION)
}

/**
 * Ask for a held page's workspace to be held. Creates the workspace's hold
 * document when there is none; answers `exists` when there is. A workspace
 * that is not young, has no id or is the house is never held.
 *
 * Never throws: the page hold it rides on has already happened.
 */
export async function requestPageSecurityHold(
  request: SecurityHoldRequest & {
    org?: Record<string, unknown> | null
    nowMs?: number
  },
): Promise<SecurityHoldRequestOutcome> {
  if (!isYoungWorkspaceAge(request.ageDays)) return 'not-young'
  if (!request.orgId) return 'no-workspace'
  if (isHouseWorkspace({ hostId: request.hostId, org: request.org })) return 'house'
  if (requestedMemo.has(request.orgId)) return 'exists'
  try {
    const firestore = firebaseAdmin.app().firestore()
    const ref = holdsCollection(firestore).doc(request.orgId)
    const record: SecurityHoldRecord = {
      orgId: request.orgId,
      hostId: request.hostId,
      screenId: request.screenId,
      versionId: request.versionId,
      reviewId: request.reviewId,
      reference: request.reference,
      signals: [...request.signals],
      ageDays: request.ageDays,
      pageLabel: String(request.pageLabel ?? '').slice(0, 300),
      pageUrl: request.pageUrl ? String(request.pageUrl).slice(0, 500) : null,
      siteName: request.siteName ? String(request.siteName).slice(0, 200) : null,
      evidence: describePhishingScreenSignals(request.signals).join(' ').slice(0, 2000),
      state: 'pending',
      requestedAtMs: request.nowMs ?? Date.now(),
      claimedAtMs: null,
      settledAtMs: null,
      outcome: null,
    }
    const created = await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref)
      if (existing.exists) return false
      transaction.set(ref, record)
      return true
    })
    requestedMemo.add(request.orgId)
    return created ? 'requested' : 'exists'
  } catch (error) {
    console.error('[security-hold] the hold could not be requested', request.orgId, error)
    return 'failed'
  }
}

/** The pending holds, oldest first by nothing more than the store's order. */
export async function listPendingSecurityHolds(
  firestore: FirebaseFirestore.Firestore,
  limit = 20,
): Promise<SecurityHoldRecord[]> {
  const snapshot = await holdsCollection(firestore)
    .where('state', 'in', ['pending', 'applying'])
    .limit(limit)
    .get()
  return snapshot.docs.map((doc) => doc.data() as SecurityHoldRecord)
}

/**
 * Claim one hold for this run. A hold another run claimed inside the lease
 * is left to it; one whose claim lapsed (that run died) is taken over.
 * Answers the claimed record, or null.
 */
export async function claimSecurityHold(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  nowMs: number = Date.now(),
): Promise<SecurityHoldRecord | null> {
  const ref = holdsCollection(firestore).doc(orgId)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const record = snapshot.data() as SecurityHoldRecord
    const claimLive =
      record.state === 'applying' &&
      typeof record.claimedAtMs === 'number' &&
      nowMs - record.claimedAtMs < SECURITY_HOLD_CLAIM_LEASE_MS
    if (record.state !== 'pending' && !(record.state === 'applying' && !claimLive)) return null
    transaction.set(ref, { state: 'applying', claimedAtMs: nowMs }, { merge: true })
    return { ...record, state: 'applying', claimedAtMs: nowMs }
  })
}

/** Record what the console did with a claimed hold. */
export async function settleSecurityHold(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  state: 'applied' | 'skipped',
  outcome: Record<string, unknown>,
  nowMs: number = Date.now(),
): Promise<void> {
  await holdsCollection(firestore)
    .doc(orgId)
    .set({ state, outcome, settledAtMs: nowMs }, { merge: true })
}
