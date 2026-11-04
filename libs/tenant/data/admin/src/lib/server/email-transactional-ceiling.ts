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
 * The durable half of the daily transactional ceiling (AGL-4145): the
 * counter a site's non-campaign mail is claimed against, and the record a
 * refusal leaves for staff.
 *
 * Which messages are governed, and what the send seam does with a refusal,
 * is `transactional-send-ceiling.ts` in `@aglyn/shared-util-email`. The
 * figures are `transactional-email-ceiling.ts` in `@aglyn/aglyn`, and the one
 * for a workspace is stamped on its sending identity by `hostSendingIdentity`
 * from the org document it already read, so the count below is the only
 * thing this costs a send.
 *
 * ## The counter
 *
 * `orgs/{orgId}/counters/transactionalEmailSends`, one field per UTC day
 * (`YYYY-MM-DD`) holding a count — the shape `campaignEmailSends` beside it
 * has per month, and ORG-scoped for the reason that one became org-scoped in
 * AGL-2267: the ceiling is the organization's, and a per-site count would
 * hand an org with N sites N ceilings. Each day is its own field, so the
 * ceiling starts again at 00:00 UTC with nobody doing anything.
 *
 * It is the CEILING's count, not the cost meter. `emailSends` still counts
 * every delivered message for COGS through `recordEmailSends`, exactly as
 * before; this counts claims, and a claim whose message did not leave is
 * handed back.
 *
 * ## A claim, not a check
 *
 * The transaction reads the day's figure and writes an ABSOLUTE value
 * derived from that read, the campaign reservation's and the governor's
 * shape: a read-then-increment would let two concurrent sends both pass the
 * last slot. A refused claim writes nothing to the counter.
 *
 * ## A refusal is never silent
 *
 * Every refusal is logged and counted on
 * `orgs/{orgId}/counters/transactionalEmailsRefused` (per day, with the
 * ceiling it met and when) — the counters-document shape the form abuse
 * ceiling's `formSubmissionsRefused` uses. The first refusal of the day
 * raises the `deliverability.transactionalCeilingReached` operator alert,
 * which is the staff console notification, the operator email and the
 * webhook. Nothing goes to the workspace: the ceiling is not something its
 * plan names, and no customer-facing surface changes.
 *
 * ## Fails open
 *
 * A counter that cannot be read or written allows the message, the posture
 * of every control on the send path: an outage on the ceiling must not
 * become an outage on every store's receipts.
 */

import {
  setTransactionalSendCeilingGate,
  transactionalCeilingDayKey,
  transactionalCeilingResetMs,
  type TransactionalSendCeilingClaim,
  type TransactionalSendCeilingRequest,
  type TransactionalSendCeilingVerdict,
} from '@aglyn/shared-util-email'
import { checkTransactionalEmailCeiling } from '@aglyn/aglyn/app-utils/transactional-email-ceiling'
import { firebaseAdmin } from './firebase-admin'

/** The ceiling's count, per organization per UTC day. */
export const TRANSACTIONAL_EMAIL_SENDS_COUNTER = 'transactionalEmailSends'

/** Refusals past the ceiling, per organization per UTC day. */
export const TRANSACTIONAL_EMAILS_REFUSED_COUNTER = 'transactionalEmailsRefused'

/** The operator alert the first refusal of a day raises. */
export const TRANSACTIONAL_CEILING_ALERT_TYPE = 'deliverability.transactionalCeilingReached'

/** `orgs/{orgId}/counters/{counter}`. */
function orgCounterRef(firestore: any, orgId: string, counter: string): any {
  return firestore.collection('orgs').doc(orgId).collection('counters').doc(counter)
}

/** A day field off a counter snapshot, clamped like every other counter read. */
function readDayField(snapshot: any, dayKey: string): number {
  const used = Number((snapshot?.exists ? snapshot.get(dayKey) : 0) ?? 0)
  return Number.isFinite(used) && used > 0 ? Math.floor(used) : 0
}

/**
 * Claims `count` messages against the organization's day, atomically.
 *
 * Allowed: the day's figure is raised by `count` and the claim comes back to
 * be released if the message does not leave. Refused: nothing is written to
 * the counter and `retryAtMs` is the next UTC midnight. The refusal's record
 * is {@link recordTransactionalCeilingRefusal}, which the send seam asks for
 * separately, outside the time budget it gives this claim.
 */
export async function claimTransactionalEmailSends(
  request: TransactionalSendCeilingRequest & { firestore?: any },
): Promise<TransactionalSendCeilingVerdict> {
  const orgId = String(request.orgId ?? '').trim()
  const nowMs = Number.isFinite(request.nowMs) ? request.nowMs : Date.now()
  const count = Math.max(1, Math.floor(Number(request.count) || 0))
  if (!orgId) return { allowed: true, claim: null }
  const dayKey = transactionalCeilingDayKey(nowMs)
  try {
    const db = request.firestore ?? firebaseAdmin.app().firestore()
    const ref = orgCounterRef(db, orgId, TRANSACTIONAL_EMAIL_SENDS_COUNTER)
    const verdict = await db.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const used = readDayField(snapshot, dayKey)
      const decision = checkTransactionalEmailCeiling(used, count, request.ceiling)
      if (decision.allowed) {
        tx.set(ref, { [dayKey]: used + count }, { merge: true })
      }
      return decision
    })
    if (verdict.allowed) {
      return {
        allowed: true,
        ceiling: verdict.ceiling,
        used: verdict.used,
        claim: { orgId, dayKey, count },
      }
    }
    return {
      allowed: false,
      ceiling: verdict.ceiling,
      used: verdict.used,
      retryAtMs: transactionalCeilingResetMs(nowMs),
    }
  } catch (error) {
    console.error('[transactional-ceiling] counter unavailable — allowing', error)
    return { allowed: true, claim: null }
  }
}

/**
 * Gives back a claim whose message did not leave. Also a transaction, and
 * also an absolute write from its own read, so a release computed from a
 * stale figure cannot undo a claim another send took in the meantime. Never
 * drives the day below zero and never throws: the cost of a failed release
 * is a day counted a little high, which is the safe direction.
 */
export async function releaseTransactionalEmailSends(
  claim: TransactionalSendCeilingClaim | null | undefined,
  firestore?: any,
): Promise<void> {
  const orgId = String(claim?.orgId ?? '').trim()
  const count = Math.max(0, Math.floor(Number(claim?.count) || 0))
  if (!orgId || !claim?.dayKey || count <= 0) return
  try {
    const db = firestore ?? firebaseAdmin.app().firestore()
    const ref = orgCounterRef(db, orgId, TRANSACTIONAL_EMAIL_SENDS_COUNTER)
    await db.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const used = readDayField(snapshot, claim.dayKey)
      tx.set(ref, { [claim.dayKey]: Math.max(0, used - count) }, { merge: true })
    })
  } catch (error) {
    console.error('[transactional-ceiling] release failed', error)
  }
}

/**
 * Makes a refusal observable: a log line, the day's refusal count, and — on
 * the first refusal of the day only — the operator alert. An alert per
 * refused message would be the flood again, delivered to staff.
 *
 * Best-effort throughout, like the form ceiling's bookkeeping: a failure here
 * must not turn a contained refusal into a send failure of another kind.
 */
export async function recordTransactionalCeilingRefusal(input: {
  orgId: string
  hostId: string | null
  dayKey: string
  count: number
  used: number
  ceiling: number
  context: string | null
  nowMs: number
  firestore?: any
}): Promise<void> {
  console.warn(
    `[transactional-ceiling] refused ${input.count} message(s) for workspace ` +
      `${input.orgId}${input.hostId ? ` (site ${input.hostId})` : ''} from ` +
      `${input.context ?? 'an unnamed sender'}: ${input.used}/${input.ceiling} ` +
      `on ${input.dayKey}`,
  )
  try {
    const db = input.firestore ?? firebaseAdmin.app().firestore()
    const refusedRef = orgCounterRef(db, input.orgId, TRANSACTIONAL_EMAILS_REFUSED_COUNTER)
    const before = readDayField(await refusedRef.get(), input.dayKey)
    await refusedRef.set(
      {
        [input.dayKey]: firebaseAdmin.firestore.FieldValue.increment(input.count),
        // Explicit values only — Firestore rejects `undefined`.
        ceiling: input.ceiling,
        lastRefusedAtMs: input.nowMs,
        lastContext: input.context ?? '',
      },
      { merge: true },
    )
    if (before > 0) return
    const orgSnapshot = await db
      .collection('orgs')
      .doc(input.orgId)
      .get()
      .catch(() => null)
    const name = orgSnapshot?.exists ? orgSnapshot.get('name') : null
    const orgName = typeof name === 'string' && name.trim() ? name.trim() : input.orgId
    const { raiseOperatorAlert } = await import('./operator-alerts')
    await raiseOperatorAlert(TRANSACTIONAL_CEILING_ALERT_TYPE, {
      dedupeKey: `${input.orgId}:${input.dayKey}`,
      orgId: input.orgId,
      ...(input.hostId ? { hostId: input.hostId } : {}),
      context: {
        orgId: input.orgId,
        orgName,
        used: input.used.toLocaleString('en-US'),
        ceiling: input.ceiling.toLocaleString('en-US'),
        context: input.context ?? 'an unnamed sender',
      },
    })
  } catch (error) {
    console.error('[transactional-ceiling] refusal bookkeeping failed', error)
  }
}

/**
 * Puts the durable ceiling on `sendEmail`'s path.
 *
 * Called at module load, from the bottom of this file, for the reason the
 * governor's installer is: every server surface imports the
 * `@aglyn/tenant-data-admin` barrel, so importing it is enough, and there is
 * no installer for an entrypoint to forget. Idempotent; the state is the
 * Firestore document.
 */
export function installTransactionalSendCeiling(): void {
  setTransactionalSendCeilingGate({
    claim: (request) => claimTransactionalEmailSends(request),
    release: (claim) => releaseTransactionalEmailSends(claim),
    refused: (request, verdict) =>
      recordTransactionalCeilingRefusal({
        orgId: request.orgId,
        hostId: request.hostId ?? null,
        dayKey: transactionalCeilingDayKey(request.nowMs),
        count: Math.max(1, Math.floor(Number(request.count) || 0)),
        used: Number(verdict.used ?? 0),
        ceiling: Number(verdict.ceiling ?? request.ceiling),
        context: request.context ?? null,
        nowMs: request.nowMs,
      }),
  })
}

installTransactionalSendCeiling()
