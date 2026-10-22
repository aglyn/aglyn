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
  checkRefundAuthority,
  STAFF_REFUND_WINDOW_MAX_ENTRIES,
  STAFF_REFUND_WINDOW_MS,
  type RefundAuthorityVerdict,
} from '../../constants/refund-authority'
import { createHash } from 'crypto'

/**
 * What one staff actor has refunded inside the rolling window (AGL-2486).
 *
 * ## Why this is not `checkRateLimit` / `rate-limit-store`
 *
 * The durable limiter counts CALLS in a fixed window and FAILS SOFT — on a
 * Firestore blip it falls back to a per-instance counter and lets the request
 * through, which is the right trade for a password unlock and the wrong one
 * for a money ceiling. Two things differ here and both are load-bearing:
 *
 *  - The quantity is a SUM OF CENTS, not a count. Sixty $1 refunds and one
 *    $60 refund are the same exposure and a call counter cannot see that.
 *  - It FAILS CLOSED. There is no second approver on a refund, so the cap is
 *    the only control on the largest staff action there is; a store outage that
 *    silently lifted it would be an unbounded window nobody could see. A
 *    refused refund during a Firestore outage costs one escalation. The
 *    inverse costs whatever someone refunds.
 *
 * ## Why it lives in `rateLimits`
 *
 * A new collection would need its own deny-all rule, its own entry in
 * `TTL_POLICIES` and `FIRESTORE_MANUAL_CONFIG.md`, and a `gcloud` run on
 * every project before its documents started expiring. `rateLimits` already
 * denies all client reads and writes and already has an ACTIVE TTL policy on
 * `expiresAt`. `rate-limit-store.ts` makes exactly this argument for its own
 * second document shape (`degraded_*`), which is the precedent followed here
 * rather than invented: a second shape in a collection that no client can
 * read is cheaper and safer than a second collection nobody remembers to
 * configure.
 *
 * Document ids are `staffRefundWindow_<sha256(uid)>` — hashed for the reason
 * the limiter hashes its keys, so a collection listing is not a roster of
 * which staff have been issuing refunds.
 */

const COLLECTION = 'rateLimits'
const DOC_PREFIX = 'staffRefundWindow_'

/**
 * How long a ledger document survives after its last entry. Twice the window,
 * so the TTL sweep can never remove entries that are still inside it — the
 * document is the enforcement state, and an early delete would hand the actor
 * a fresh ceiling.
 */
const LEDGER_RETENTION_MS = 2 * STAFF_REFUND_WINDOW_MS

/** One settled or in-flight refund inside the window. */
interface LedgerEntry {
  /** Server clock at reservation. */
  atMs: number
  /** Integer cents reserved. */
  cents: number
  /** Reservation id, so a Stripe refusal can release exactly this one. */
  entryId: string
}

export interface RefundWindowUsage {
  cents: number
  count: number
}

/** Minimal Firestore surface, so specs can double it without the Admin SDK. */
export interface LedgerStore {
  collection(name: string): {
    doc(id: string): unknown
  }
  runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T>
}

function docId(actorUid: string): string {
  return `${DOC_PREFIX}${createHash('sha256').update(String(actorUid)).digest('hex')}`
}

/**
 * Entries still inside the window, newest-first order preserved.
 *
 * Pruning on READ rather than on a schedule is what makes the window rolling:
 * nothing has to run for an entry to age out, so a ceiling can never be held
 * down by a sweep that did not happen.
 */
function liveEntries(raw: unknown, nowMs: number): LedgerEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry: any) => {
      const atMs = Number(entry?.atMs)
      // A malformed row is KEPT, not dropped, when its age cannot be read:
      // dropping it would be a way to lose reserved cents, and the entry cap
      // bounds how many can accumulate.
      if (!Number.isFinite(atMs)) return true
      return nowMs - atMs < STAFF_REFUND_WINDOW_MS
    })
    .map((entry: any) => ({
      atMs: Number(entry?.atMs) || 0,
      cents: Math.max(0, Math.round(Number(entry?.cents) || 0)),
      entryId: String(entry?.entryId ?? ''),
    }))
}

function usageOf(entries: LedgerEntry[]): RefundWindowUsage {
  return {
    cents: entries.reduce((total, entry) => total + entry.cents, 0),
    count: entries.length,
  }
}

/**
 * This actor's usage inside the window, for DISPLAY only.
 *
 * Returns null when the ledger cannot be read. A null is rendered as "could
 * not read your remaining allowance", never as a full one — the card's whole
 * job is to state the boundary before an operator types, and a fabricated
 * ceiling would be worse than no ceiling shown at all (AGL-940's lesson,
 * applied to a number rather than a list).
 */
export async function readRefundWindowUsage(
  firestore: any,
  actorUid: string,
): Promise<RefundWindowUsage | null> {
  try {
    const snapshot = await firestore
      .collection(COLLECTION)
      .doc(docId(actorUid))
      .get()
    return usageOf(liveEntries(snapshot?.get?.('entries'), Date.now()))
  } catch (error) {
    console.error('[refund-window] read failed', error)
    return null
  }
}

export interface RefundReservation {
  verdict: RefundAuthorityVerdict
  /** Usage BEFORE this attempt, for the error copy and the audit row. */
  priorUsage: RefundWindowUsage
}

/**
 * Reserve `amountCents` against this actor's window, atomically.
 *
 * THE CHECK AND THE WRITE ARE ONE TRANSACTION, which is the entire reason
 * this is not a read followed by `checkRefundAuthority` at the call site.
 * Two refunds submitted together would each read the same prior total, each
 * find room, and each proceed — the read-then-write race that AGL-1544
 * recorded as the way a create-time quota gets laundered. The ceiling has to
 * be evaluated where the increment happens.
 *
 * A `super` actor is not reserved against and not counted: the role is
 * uncapped, so a ledger entry for it would be enforcement state that enforces
 * nothing while making every super refund a transaction.
 *
 * THROWS when the store is unreachable. The caller turns that into a refusal;
 * see the fail-closed note above.
 */
export async function reserveRefundWindow(
  firestore: any,
  options: {
    actorUid: string
    role: unknown
    amountCents: number
    entryId: string
  },
): Promise<RefundReservation> {
  const { actorUid, role, amountCents, entryId } = options
  const nowMs = Date.now()

  const uncapped = checkRefundAuthority({ role, amountCents, windowCents: 0 })
  if (uncapped.authority === 'super') {
    return { verdict: uncapped, priorUsage: { cents: 0, count: 0 } }
  }

  const reference = firestore.collection(COLLECTION).doc(docId(actorUid))
  return firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(reference)
    const entries = liveEntries(snapshot?.get?.('entries'), nowMs)
    const priorUsage = usageOf(entries)
    const verdict = checkRefundAuthority({
      role,
      amountCents,
      windowCents: priorUsage.cents,
      windowCount: priorUsage.count,
    })
    if (!verdict.allowed) return { verdict, priorUsage }

    const next = [
      ...entries,
      {
        atMs: nowMs,
        cents: Math.round(Number(amountCents)),
        entryId: String(entryId),
      },
      // Bounded on write as well as refused on read: the entry ceiling is
      // what keeps this array from being an unbounded document, and a guard
      // that only lived in the predicate would be one refactor from gone.
    ].slice(-STAFF_REFUND_WINDOW_MAX_ENTRIES)

    transaction.set(
      reference,
      {
        entries: next,
        // Inherited TTL field — see the header. Refreshed on every write, so
        // an active actor's ledger never expires under them.
        expiresAt: new Date(nowMs + LEDGER_RETENTION_MS),
        updatedAtMs: nowMs,
      },
      { merge: true },
    )
    return { verdict, priorUsage }
  })
}

/**
 * Give back a reservation whose refund never happened.
 *
 * Called only when Stripe REFUSED, where we know no money moved — the same
 * release-don't-burn rule the idempotency claim follows. Best-effort by
 * design: a failed release costs the actor part of one day's ceiling and
 * costs Aglyn nothing, whereas surfacing it would report a refund that was
 * correctly refused as a second, different failure.
 */
export async function releaseRefundWindow(
  firestore: any,
  actorUid: string,
  entryId: string,
): Promise<void> {
  try {
    const reference = firestore.collection(COLLECTION).doc(docId(actorUid))
    await firestore.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(reference)
      const entries = liveEntries(snapshot?.get?.('entries'), Date.now())
      transaction.set(
        reference,
        { entries: entries.filter((entry) => entry.entryId !== entryId) },
        { merge: true },
      )
    })
  } catch (error) {
    console.error('[refund-window] release failed', { entryId }, error)
  }
}

/** Exposed for the specs that assert the document is not client-readable. */
export const STAFF_REFUND_LEDGER_COLLECTION = COLLECTION
export const staffRefundLedgerDocId = docId
