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

import { randomUUID } from 'crypto'
import {
  LoyaltyVendorError,
  type LoyaltyVendorAdapter,
  type LoyaltyVendorMember,
} from '../connectors/types'
import {
  LOYALTY_SYNC_MAX_ATTEMPTS,
  LOYALTY_SYNC_OPEN,
  type LoyaltyConnectorCredentials,
  type LoyaltySyncRowView,
  type LoyaltySyncStatus,
} from '../model/loyalty-connectors'
import type { StoredLoyaltyMember } from '../model/loyalty-member'
import { loyaltyVendorFor } from './connector-config'
import {
  noteLoyaltyConnection,
  openLoyaltyConnection,
  type OpenLoyaltyConnection,
} from './connection-store'
import { keyId, loyaltyDb, loyaltyRefs } from './db'
import { normalizeStoredMember, type LoyaltyScope } from './members'

/**
 * Points on their way to a merchant's own Smile.io or Yotpo account
 * (AGL-3677).
 *
 * THE OUTBOX. Every points movement of a connected program — a sale's earn, a
 * refund's reversal, a redemption, a void, a give-back, a hand adjustment — is
 * written as a ledger row by the transaction that caused it, and its twin in
 * `loyaltySync` under the same id. Nothing calls a vendor inside a
 * transaction: the vendor is asked afterwards, row by row, from here.
 *
 * ONCE. A row is claimed in a transaction (`sending`, with a claim id) before
 * its call, and marked `synced` after. Two senders never send one row: the
 * second sees the claim. A sender that died mid-call leaves `sending` behind;
 * the next pass, once the claim is stale, LOOKS at the member's history at the
 * vendor for the row's reference before it sends again. Neither vendor takes
 * an idempotency key, so the reference in the vendor's own history is the
 * proof.
 *
 * THE BALANCE. The vendor keeps it. Loyalty's member document carries a
 * mirror — what the vendor said, plus what is still on its way — refreshed
 * whenever a buyer or a cashier names the member, so the seller's checkout
 * transaction can stage a redemption without a call out. The mirror errs
 * low: a spend in flight counts against it, an earn in flight does not.
 *
 * SHORT. A refund that takes back points the member already spent, or a spend
 * that the vendor's balance can no longer cover, takes what is there and
 * records the rest as `shortfallPoints` for the merchant to see. A vendor
 * balance never goes below zero.
 */

/** A claim older than this is a sender that died mid-call. */
export const LOYALTY_SYNC_CLAIM_STALE_MS = 5 * 60 * 1000

/** How long a refused row waits before an automatic pass sends it again. */
export const LOYALTY_SYNC_RETRY_BACKOFF_MS = 60 * 1000

export interface StoredLoyaltySyncRow {
  orgId: string
  hostId: string
  provider: string
  memberKey: string
  email: string
  kind: string
  points: number
  earned: boolean
  title: string
  orderId: string | null
  live: boolean
  status: LoyaltySyncStatus
  attempts: number
  error: string | null
  shortfallPoints: number
  vendorId: string | null
  claimId: string | null
  claimedAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
}

export function normalizeSyncRow(
  data: Record<string, unknown> | undefined,
): StoredLoyaltySyncRow {
  const source = data ?? {}
  const status = String(source['status'] ?? 'pending') as LoyaltySyncStatus
  return {
    orgId: String(source['orgId'] ?? ''),
    hostId: String(source['hostId'] ?? ''),
    provider: String(source['provider'] ?? ''),
    memberKey: String(source['memberKey'] ?? ''),
    email: String(source['email'] ?? ''),
    kind: String(source['kind'] ?? ''),
    points: Math.trunc(Number(source['points']) || 0),
    earned: source['earned'] === true,
    title: String(source['title'] ?? 'Rewards'),
    orderId:
      typeof source['orderId'] === 'string' && source['orderId']
        ? (source['orderId'] as string)
        : null,
    live: source['live'] !== false,
    status,
    attempts: Math.max(0, Math.trunc(Number(source['attempts']) || 0)),
    error:
      typeof source['error'] === 'string' && source['error']
        ? (source['error'] as string)
        : null,
    shortfallPoints: Math.max(
      0,
      Math.trunc(Number(source['shortfallPoints']) || 0),
    ),
    vendorId:
      typeof source['vendorId'] === 'string' && source['vendorId']
        ? (source['vendorId'] as string)
        : null,
    claimId:
      typeof source['claimId'] === 'string' && source['claimId']
        ? (source['claimId'] as string)
        : null,
    claimedAtMs: Number(source['claimedAtMs']) || null,
    createdAtMs: Number(source['createdAtMs']) || 0,
    updatedAtMs: Number(source['updatedAtMs']) || 0,
  }
}

/** The short reference written beside a movement at the vendor. */
export function loyaltySyncRef(rowId: string): string {
  return keyId(rowId).slice(0, 12).toUpperCase()
}

export function toLoyaltySyncRowView(
  id: string,
  row: StoredLoyaltySyncRow,
): LoyaltySyncRowView {
  return {
    id,
    status: row.status,
    points: row.points,
    shortfallPoints: row.shortfallPoints,
    kind: row.kind,
    orderId: row.orderId,
    email: row.email,
    error: row.error,
    attempts: row.attempts,
    atMs: row.createdAtMs,
  }
}

/** What a mirror adds to the vendor's balance for movements not there yet: spends in flight count, earns in flight do not. */
export function pendingMirrorPoints(rows: StoredLoyaltySyncRow[]): number {
  let total = 0
  for (const row of rows) {
    if (!row.live) continue
    if (row.status === 'pending' || row.status === 'retry') total += row.points
    else if (row.status === 'sending') total += Math.min(0, row.points)
  }
  return total
}

function openRowsQuery(
  scope: LoyaltyScope,
  field: 'memberKey' | 'orderId',
  value: string,
) {
  return loyaltyRefs
    .syncCollection(scope.orgId)
    .where('hostId', '==', scope.hostId)
    .where(field, '==', value)
    .where('status', 'in', [...LOYALTY_SYNC_OPEN])
    .limit(100)
}

type Outcome =
  | { status: 'synced'; vendorId: string | null; shortfallPoints: number }
  | { status: 'unmatched' | 'skipped'; error: string }
  | { status: 'retry'; error: string; auth: boolean }

async function vendorMemberFor(
  adapter: LoyaltyVendorAdapter,
  credentials: LoyaltyConnectorCredentials,
  row: StoredLoyaltySyncRow,
  name: string | null,
): Promise<LoyaltyVendorMember | null> {
  const found = await adapter.findMember(credentials, row.email)
  if (found) return found
  // Only a positive movement enrolls: there is nothing to take from someone the vendor never knew.
  return row.points > 0
    ? adapter.enrollMember(credentials, { email: row.email, name })
    : null
}

async function sendRow(
  open: OpenLoyaltyConnection,
  rowId: string,
  row: StoredLoyaltySyncRow,
  wasSending: boolean,
): Promise<Outcome> {
  const adapter = loyaltyVendorFor(open.connection.provider)
  const ref = loyaltySyncRef(rowId)
  try {
    const member = await vendorMemberFor(adapter, open.credentials, row, null)
    if (!member) {
      return {
        status: 'unmatched',
        error: `${row.email} is not a member of the store’s ${adapter.id === 'smile' ? 'Smile.io' : 'Yotpo'} program yet.`,
      }
    }
    if (
      wasSending &&
      (await adapter.hasAdjustment(open.credentials, {
        member,
        email: row.email,
        ref,
      }))
    ) {
      return { status: 'synced', vendorId: null, shortfallPoints: 0 }
    }
    let points = row.points
    let shortfallPoints = 0
    if (points < 0 && member.points + points < 0) {
      const take = Math.max(0, member.points)
      shortfallPoints = -points - take
      points = -take
    }
    if (!points) return { status: 'synced', vendorId: null, shortfallPoints }
    const result = await adapter.adjust(open.credentials, {
      member,
      email: row.email,
      points,
      earned: row.earned,
      title: row.title,
      ref,
    })
    return { status: 'synced', vendorId: result.id, shortfallPoints }
  } catch (error) {
    if (error instanceof LoyaltyVendorError) {
      return {
        status: 'retry',
        error: error.message,
        auth: error.kind === 'auth',
      }
    }
    console.error('[loyalty] a points movement failed to send', rowId, error)
    return {
      status: 'retry',
      error: 'The movement could not be sent; it will be tried again.',
      auth: false,
    }
  }
}

/** Claims one row for this sender, or says why not. */
async function claimRow(
  scope: LoyaltyScope,
  ref: any,
  input: { provider: string; force: boolean; nowMs: number; claimId: string },
): Promise<{ row: StoredLoyaltySyncRow; wasSending: boolean } | null> {
  return loyaltyDb().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const row = normalizeSyncRow(snapshot.data())
    // The merchant's Send again also reopens a buyer the vendor did not know.
    const open = LOYALTY_SYNC_OPEN.includes(row.status) || (input.force && row.status === 'unmatched')
    if (!open) return null
    const wasSending = row.status === 'sending'
    if (wasSending && row.claimedAtMs && input.nowMs - row.claimedAtMs < LOYALTY_SYNC_CLAIM_STALE_MS) return null
    if (!input.force && row.attempts >= LOYALTY_SYNC_MAX_ATTEMPTS) return null
    // A row the vendor just refused waits out a short backoff before an automatic pass tries it again.
    if (!input.force && row.status === 'retry' && input.nowMs - row.updatedAtMs < LOYALTY_SYNC_RETRY_BACKOFF_MS) {
      return null
    }
    if (!row.live) {
      transaction.set(ref, {
        ...snapshot.data(),
        status: 'skipped',
        error: 'A test-mode sale: no real points moved.',
        updatedAtMs: input.nowMs,
      })
      return null
    }
    if (row.provider !== input.provider) {
      transaction.set(ref, {
        ...snapshot.data(),
        status: 'skipped',
        error: 'The store connected a different account before this was sent.',
        updatedAtMs: input.nowMs,
      })
      return null
    }
    transaction.set(ref, {
      ...snapshot.data(),
      status: 'sending',
      claimId: input.claimId,
      claimedAtMs: input.nowMs,
      attempts: row.attempts + 1,
      updatedAtMs: input.nowMs,
    })
    return { row, wasSending }
  })
}

async function settleRow(
  ref: any,
  claimId: string,
  outcome: Outcome,
  nowMs: number,
): Promise<void> {
  await loyaltyDb().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists || snapshot.get('claimId') !== claimId) return
    const fields =
      outcome.status === 'synced'
        ? {
            status: 'synced',
            error: null,
            vendorId: outcome.vendorId,
            shortfallPoints: outcome.shortfallPoints,
          }
        : { status: outcome.status, error: outcome.error.slice(0, 200) }
    transaction.set(ref, {
      ...snapshot.data(),
      ...fields,
      claimedAtMs: null,
      updatedAtMs: nowMs,
    })
  })
}

export interface LoyaltySyncPassResult {
  sent: number
  failed: number
}

/**
 * Sends a store's open movements to its connected account: one order's, one
 * member's, the rows named, or — with none of those — the oldest open ones.
 * `force` sends a row that has used its attempts (the merchant's Send again).
 * Never throws.
 */
export async function sendLoyaltySync(input: {
  orgId: string
  hostId: string
  orderId?: string
  memberKey?: string
  rowIds?: string[]
  force?: boolean
  limit?: number
}): Promise<LoyaltySyncPassResult> {
  const result: LoyaltySyncPassResult = { sent: 0, failed: 0 }
  try {
    const scope = { orgId: input.orgId, hostId: input.hostId }
    const open = await openLoyaltyConnection(scope.orgId, scope.hostId)
    if (!open) return result
    let refs: any[]
    if (input.rowIds) {
      refs = input.rowIds
        .slice(0, 50)
        .map((id) => loyaltyRefs.syncCollection(scope.orgId).doc(id))
    } else {
      const query = input.orderId
        ? openRowsQuery(scope, 'orderId', input.orderId)
        : input.memberKey
          ? openRowsQuery(scope, 'memberKey', input.memberKey)
          : loyaltyRefs
              .syncCollection(scope.orgId)
              .where('hostId', '==', scope.hostId)
              .where('status', 'in', input.force ? [...LOYALTY_SYNC_OPEN, 'unmatched'] : [...LOYALTY_SYNC_OPEN])
              .orderBy('createdAtMs', 'asc')
              .limit(Math.max(1, Math.min(50, input.limit ?? 20)))
      refs = (await query.get()).docs.map((doc: any) => doc.ref)
    }
    let authError: string | null = null
    for (const ref of refs) {
      const claimId = randomUUID()
      const claimed = await claimRow(scope, ref, {
        provider: open.connection.provider,
        force: input.force === true,
        nowMs: Date.now(),
        claimId,
      })
      if (!claimed) continue
      const outcome: Outcome = authError
        ? { status: 'retry', error: authError, auth: true }
        : await sendRow(open, ref.id, claimed.row, claimed.wasSending)
      await settleRow(ref, claimId, outcome, Date.now())
      if (outcome.status === 'synced') result.sent += 1
      else result.failed += 1
      // Refused credentials refuse every row: stop asking until the merchant reconnects.
      if (outcome.status === 'retry' && outcome.auth) authError = outcome.error
    }
    if (result.sent || authError) {
      await noteLoyaltyConnection(
        scope.orgId,
        scope.hostId,
        authError
          ? { ok: false, error: authError, nowMs: Date.now() }
          : { ok: true, nowMs: Date.now() },
      )
    }
  } catch (error) {
    console.error(
      '[loyalty] the connected program could not be sent to',
      input.hostId,
      error,
    )
  }
  return result
}

/**
 * The member's mirror refreshed from the vendor, inside a transaction of its
 * own: the vendor's balance plus what is on its way. Throws a
 * {@link LoyaltyVendorError} when the vendor cannot answer — a caller refuses
 * the redemption rather than spend a balance it cannot see.
 */
export async function refreshConnectedMember(
  scope: LoyaltyScope,
  memberKey: string,
  nowMs = Date.now(),
): Promise<StoredLoyaltyMember | null> {
  const memberRef = loyaltyRefs.member(scope.orgId, scope.hostId, memberKey)
  const current = await memberRef.get()
  if (!current.exists) return null
  const email = String(current.get('email') ?? '')
  const open = await openLoyaltyConnection(scope.orgId, scope.hostId)
  if (!open || !email)
    throw new LoyaltyVendorError(
      'transient',
      'The store’s rewards account cannot be reached right now.',
    )
  const vendor = await loyaltyVendorFor(open.connection.provider).findMember(
    open.credentials,
    email,
  )
  return loyaltyDb().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(memberRef)
    if (!snapshot.exists) return null
    const rows = await transaction.get(
      openRowsQuery(scope, 'memberKey', memberKey),
    )
    const pending = pendingMirrorPoints(
      rows.docs.map((doc: any) => normalizeSyncRow(doc.data())),
    )
    const member = normalizeStoredMember(scope, memberKey, snapshot.data())
    // Someone the vendor does not know has nothing to spend there.
    const points = vendor ? vendor.points + pending : Math.min(0, pending)
    if (points === member.points) return member
    const next: StoredLoyaltyMember = { ...member, points, updatedAtMs: nowMs }
    transaction.set(memberRef, next)
    return next
  })
}

/** Movements the merchant should see: those still on their way, and those the vendor refused. Newest first. */
export async function loyaltySyncAttention(
  scope: LoyaltyScope,
  limit = 20,
): Promise<LoyaltySyncRowView[]> {
  const snapshot = await loyaltyRefs
    .syncCollection(scope.orgId)
    .where('hostId', '==', scope.hostId)
    .where('status', 'in', ['pending', 'sending', 'retry', 'unmatched'])
    .orderBy('createdAtMs', 'desc')
    .limit(limit)
    .get()
  return snapshot.docs.map((doc: any) =>
    toLoyaltySyncRowView(doc.id, normalizeSyncRow(doc.data())),
  )
}

/**
 * Closes every open movement when the store disconnects or connects another
 * account: they were promised to an account it no longer runs. Returns how
 * many were closed.
 */
export async function closeOpenLoyaltySync(
  scope: LoyaltyScope,
  reason: string,
  nowMs = Date.now(),
): Promise<number> {
  let closed = 0
  for (let page = 0; page < 20; page += 1) {
    const snapshot = await loyaltyRefs
      .syncCollection(scope.orgId)
      .where('hostId', '==', scope.hostId)
      .where('status', 'in', ['pending', 'sending', 'retry', 'unmatched'])
      .limit(200)
      .get()
    if (snapshot.empty) break
    const batch = loyaltyDb().batch()
    for (const doc of snapshot.docs) {
      batch.set(doc.ref, {
        ...doc.data(),
        status: 'skipped',
        error: reason,
        claimedAtMs: null,
        updatedAtMs: nowMs,
      })
      closed += 1
    }
    await batch.commit()
  }
  return closed
}
