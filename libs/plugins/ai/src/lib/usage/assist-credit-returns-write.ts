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

import { FieldValue } from 'firebase-admin/firestore'
import { assistCreditsFromUsd, assistUsdFromCredits } from './assist-credits'
import {
  ASSIST_CREDIT_RETURNS_FIELD,
  ASSIST_RETURNED_USD_FIELD,
  assistSpendAfterReturnsUsd,
  type AssistCreditMeter,
} from './assist-credit-returns'
import { freeAccountUsageRef } from './assist-free-taste'

/**
 * GIVING CREDITS BACK (AGL-3595): the one writer of `returnedUsd`.
 *
 * Staff compensate a customer for a fault of ours through
 * `/api/ai/admin/credits`; anything else that hands credits back for a
 * failed turn (a refused plan, say) calls this same function with its own
 * `source`, so every give-back lands the same way and is bounded the same
 * way. See `assist-credit-returns.ts` for what readers do with the field.
 *
 * ## Bounded, idempotent, and history-preserving
 *
 * - Read and written in ONE transaction, so two give-backs racing cannot
 *   each read "227 used" and together return 454.
 * - A give-back can return at most what the meter reads as used after
 *   earlier give-backs — never more. Refused as `over` naming what each
 *   meter could take.
 * - Keyed: the act is recorded under `creditReturns.{key}` on every meter it
 *   touched, and a second call with a key any of them already holds writes
 *   nothing and answers `duplicate`. A double-click returns once.
 * - Nothing is deleted or overwritten: `estCostUsd` stays the month's spend,
 *   `returnedUsd` only grows, and the map keeps each act.
 */

/** The shape of a key: a client-made UUID, or a caller's own stable id. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/

/** Whether `key` may name a give-back (it becomes a Firestore map key). */
export function isAssistCreditReturnKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

/** Where one meter's month lives. */
export interface AssistCreditMeterTarget {
  meter: AssistCreditMeter
  ref: FirebaseFirestore.DocumentReference
}

/** The month document of the workspace's band. */
export function workspaceCreditMeter(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
): AssistCreditMeterTarget {
  return {
    meter: 'workspace',
    ref: firestore.collection('orgs').doc(orgId).collection('assistUsage').doc(month),
  }
}

/** The month document of a Free owner's account allowance. */
export function accountCreditMeter(
  firestore: FirebaseFirestore.Firestore,
  accountUid: string,
  month: string,
): AssistCreditMeterTarget {
  return { meter: 'account', ref: freeAccountUsageRef(firestore, accountUid, month) }
}

export interface AssistCreditReturnRequest {
  month: string
  meters: AssistCreditMeterTarget[]
  /**
   * Credits to return to EACH meter, or `'all'` to return everything each
   * meter reads as used this month (a reset — each meter its own figure).
   */
  credits: number | 'all'
  key: string
  reason: string
  /** Who gave it back — a staff uid, or `system:<source>`. */
  actorUid: string
  /** What asked: `staff`, or an automatic path's own name. */
  source: string
  jobId?: string | null
}

/** One meter's line in the outcome. */
export interface AssistCreditReturnLine {
  meter: AssistCreditMeter
  path: string
  /** Credits the meter read as used before this give-back. */
  usedBefore: number
  /** Credits this give-back returned to it (0 on a refusal or duplicate). */
  credits: number
}

export type AssistCreditReturnOutcome =
  | { status: 'returned'; lines: AssistCreditReturnLine[] }
  | { status: 'duplicate'; lines: AssistCreditReturnLine[] }
  | { status: 'over'; lines: AssistCreditReturnLine[] }
  | { status: 'nothing'; lines: AssistCreditReturnLine[] }

/**
 * Return credits to one or more meters, atomically.
 *
 * `inTransaction` runs inside the same transaction after the writes are
 * queued and only when something is returned — the staff route writes its
 * audit row there, so the row and the give-back commit together or not at
 * all.
 */
export async function returnAssistCredits(
  firestore: FirebaseFirestore.Firestore,
  request: AssistCreditReturnRequest,
  inTransaction?: (
    tx: FirebaseFirestore.Transaction,
    lines: AssistCreditReturnLine[],
  ) => void,
): Promise<AssistCreditReturnOutcome> {
  if (!isAssistCreditReturnKey(request.key)) {
    throw new Error('A give-back needs an idempotency key')
  }
  if (!request.meters.length) throw new Error('A give-back needs a meter')
  const all = request.credits === 'all'
  const asked = all ? 0 : Math.floor(Number(request.credits))
  if (!all && !(Number.isInteger(Number(request.credits)) && asked > 0)) {
    throw new Error('A give-back is a positive whole number of credits')
  }

  return firestore.runTransaction(async (tx) => {
    const snapshots = await Promise.all(request.meters.map(({ ref }) => tx.get(ref)))
    const measured = request.meters.map((target, index) => {
      const snapshot = snapshots[index]
      const spentUsd = assistSpendAfterReturnsUsd(
        snapshot?.get('estCostUsd'),
        snapshot?.get(ASSIST_RETURNED_USD_FIELD),
      )
      const returns = (snapshot?.get(ASSIST_CREDIT_RETURNS_FIELD) ?? {}) as Record<
        string,
        unknown
      >
      return {
        target,
        spentUsd,
        usedBefore: assistCreditsFromUsd(spentUsd),
        seen: Boolean(returns && typeof returns === 'object' && request.key in returns),
      }
    })
    const lines = (credits: (usedBefore: number) => number): AssistCreditReturnLine[] =>
      measured.map((entry) => ({
        meter: entry.target.meter,
        path: entry.target.ref.path,
        usedBefore: entry.usedBefore,
        credits: credits(entry.usedBefore),
      }))

    if (measured.some((entry) => entry.seen)) {
      return { status: 'duplicate', lines: lines(() => 0) }
    }
    if (!all && measured.some((entry) => asked > entry.usedBefore)) {
      return { status: 'over', lines: lines(() => 0) }
    }
    const returned = lines((usedBefore) => (all ? usedBefore : asked))
    if (returned.every((line) => line.credits === 0)) {
      return { status: 'nothing', lines: returned }
    }

    const at = FieldValue.serverTimestamp()
    measured.forEach((entry, index) => {
      const credits = returned[index]?.credits ?? 0
      if (credits <= 0) return
      // Never more dollars than the meter reads as spent: the whole of a
      // meter is `ceil` credits, and returning the rounded-up figure in
      // full would bank the fraction against next month's first turn.
      const usd = Math.min(assistUsdFromCredits(credits), entry.spentUsd)
      tx.set(
        entry.target.ref,
        {
          month: request.month,
          [ASSIST_RETURNED_USD_FIELD]: FieldValue.increment(usd),
          [ASSIST_CREDIT_RETURNS_FIELD]: {
            [request.key]: {
              credits,
              usd,
              reason: request.reason,
              actorUid: request.actorUid,
              source: request.source,
              jobId: request.jobId ?? null,
              at,
            },
          },
          updatedAt: at,
        },
        { merge: true },
      )
    })
    inTransaction?.(tx, returned)
    return { status: 'returned', lines: returned }
  })
}
