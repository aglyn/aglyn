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
 * The durable half of the visitor-record ceilings (AGL-1529) — the lead
 * writer that enforces `LEADS_MAX_PER_HOST`, and the bookkeeping that makes a
 * trip of EITHER ceiling something a site's owner can see.
 *
 * The policy is pure and lives in `@aglyn/aglyn/server`
 * (`visitor-record-ceiling.ts`); this is the part that needs Firestore. Same
 * split as `visitorWriteRateLimitRefusal`, and for the same reason.
 */

import {
  checkVisitorRecordCeiling,
  LEADS_MAX_PER_HOST,
  submissionMonthKey,
  visitorRecordRefusedCounterId,
  type VisitorRecordKind,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import { notifyHostManagers } from './notifications'

/**
 * Make a tripped ceiling OBSERVABLE rather than a silent drop — the * standing rule that a control which is not visible in the console does not
 * count as shipped.
 *
 * Two audiences, one call, in exactly `recordAbuseCeilingTrip`'s shape
 * (`apps/tenant/app/api/forms/submit/route.ts`, AGL-1655):
 *
 *  - A durable per-month refusal count at
 *    `hosts/{id}/counters/{siteMembers|leads}Refused`. Counters are excluded
 *    from every client write in `cloud/firebase-firestore.rules` (AGL-1367),
 *    so the record cannot be edited away by the site it describes, and host
 *    admins can already READ it — which is what lets the inbox console page
 *    render it with no rules change.
 *  - One in-app notification to the site's managers, on the FIRST refusal of
 *    the month only. A notification per refused bot request would be the
 *    flood again, delivered.
 *
 * The counter is month-keyed even though the CEILING is a total, because the
 * two facts are different: the ceiling is "how many records exist" and this is
 * "how many were turned away recently". Only the second is worth a notice.
 *
 * Best-effort throughout: bookkeeping that failed must never turn a contained
 * refusal into a 500, because a 500 is an invitation to retry.
 */
export async function recordVisitorRecordCeilingTrip(options: {
  hostRef: FirebaseFirestore.DocumentReference
  hostId: string
  kind: VisitorRecordKind
  ceiling: number
  monthKey?: string
}): Promise<void> {
  const { hostRef, hostId, kind, ceiling } = options
  const monthKey = options.monthKey ?? submissionMonthKey()
  try {
    const refusedRef = hostRef
      .collection('counters')
      .doc(visitorRecordRefusedCounterId(kind))
    const refusedSnapshot = await refusedRef.get()
    const alreadyRefused = Number(refusedSnapshot.get(monthKey) ?? 0)
    await refusedRef.set(
      {
        [monthKey]: FieldValue.increment(1),
        // Explicit values only — Firestore rejects `undefined`.
        ceiling,
        lastRefusedAtMs: Date.now(),
      },
      { merge: true },
    )
    if (alreadyRefused === 0) {
      const leads = kind === 'leads'
      await notifyHostManagers(hostId, {
        type: 'system.visitorRecordsPaused',
        title: leads
          ? 'Lead capture paused — this site is at the platform limit'
          : 'Sign-ups paused — this site is at the platform limit',
        body:
          `This site holds ${ceiling.toLocaleString()} ` +
          `${leads ? 'leads' : 'member accounts'}, which is the platform ` +
          `safety limit, so further ${leads ? 'leads' : 'sign-ups'} are ` +
          'being refused. This is not part of your plan — every plan ' +
          `includes unlimited ${leads ? 'leads' : 'member accounts'}. ` +
          `Remove some ${leads ? 'leads' : 'members'}, or contact support ` +
          'if this is real traffic.',
        link: `/${hostId}/inbox`,
      })
    }
  } catch (error) {
    console.error('visitor record ceiling bookkeeping failed', error)
  }
}

/** What a caller wants stored on the lead. `createdAt` is stamped here. */
export interface HostLeadInput {
  email: string
  /** The name the person typed, when they typed one (AGL-2303). */
  name?: string
  /** `signup`, `booking`, … — the surface that produced it. */
  source: string
  /**
   * Explicit marketing opt-in, with a consent timestamp — the same shape
   * `upsertHostContact` already carries (AGL-301). Omitted or `false` writes
   * nothing: a lead is a side effect of an action the visitor DID take
   * (sign up, book), which is not by itself consent to be emailed
   * marketing, so this is only set when the caller captured an explicit
   * checkbox.
   */
  marketingConsent?: boolean
}

/**
 * Append one lead to `hosts/{hostId}/leads`, bounded by
 * `LEADS_MAX_PER_HOST` (AGL-1529).
 *
 * ## Why every lead writer goes through here
 *
 * There are three lead writes in the repo — the sign-up handler and the two
 * bookings paths — and all three were `hostRef.collection('leads').add(…)`
 * with a `.catch()` on the end. A cap enforced at two of three call sites is
 * not a cap, and the fourth writer somebody adds next month would not have
 * one either. One function is the only shape that survives that.
 *
 * ## The count is evaluated INSIDE the transaction that writes
 *
 * A create-time quota can be laundered by WHEN it is evaluated, not by the
 * counting rule (AGL-2231/2265/2266). Read-then-decide-then-`add()` lets N
 * concurrent visitors each read the same pre-count, each find room, and each
 * land — and nothing re-counts afterwards, so the extra rows are permanent.
 * `Transaction.get(AggregateQuery)` serialises the count against a concurrent
 * create into the same collection: the loser retries, re-reads the higher
 * count, and is refused. The count is of LIVE documents, so triaging leads in
 * the inbox frees the slots.
 *
 * ## Refusing a lead never fails the visitor's action
 *
 * A lead is a SIDE EFFECT — of a sign-up, or of a booking. The visitor did
 * not ask for it and cannot see it, so refusing one must not refuse the thing
 * they did ask for. This returns a boolean and never throws; the trip is
 * recorded and the caller carries on. That is the honest split, and it is why
 * `SITE_MEMBERS_MAX_PER_HOST` (which governs an action a visitor DID take) is
 * enforced with a 429 in the sign-up handler and this is not.
 */
export async function addHostLead(options: {
  hostRef: FirebaseFirestore.DocumentReference
  hostId: string
  lead: HostLeadInput
  /**
   * The ceiling to compare against. Defaults to `LEADS_MAX_PER_HOST` and is
   * passed by NOTHING in production — it exists so the suite can re-drive the
   * same count against a ceiling one higher and require the write to succeed.
   * A refusal that survives its own ceiling being raised was never that
   * ceiling's refusal, and there is exactly ONE comparison below, so knifing
   * it cannot be absorbed by a fallback branch.
   */
  ceiling?: number
}): Promise<boolean> {
  const { hostRef, hostId, lead } = options
  const maxPerHost = options.ceiling ?? LEADS_MAX_PER_HOST
  try {
    const leadsRef = hostRef.collection('leads')
    const firestore = hostRef.firestore
    const document = {
      email: lead.email,
      ...(lead.name ? { name: lead.name } : {}),
      source: lead.source,
      ...(lead.marketingConsent
        ? { marketingConsent: true, marketingConsentAtMs: Date.now() }
        : {}),
      createdAt: FieldValue.serverTimestamp(),
    }
    const refused = await firestore.runTransaction(async (tx) => {
      // ALL READS BEFORE THE WRITE, which Firestore requires — and which is
      // why the document is assembled above rather than in here.
      const used = (await tx.get(leadsRef.count())).data().count
      if (checkVisitorRecordCeiling(used, maxPerHost).exceeded) return true
      tx.create(leadsRef.doc(), document)
      return false
    })
    if (refused) {
      await recordVisitorRecordCeilingTrip({
        hostRef,
        hostId,
        kind: 'leads',
        ceiling: maxPerHost,
      })
      return false
    }
    return true
  } catch (error) {
    // Same posture the three original call sites had (`.catch(() => undefined)`
    // / `.catch(console.error)`): a lead that failed to store must not fail
    // the sign-up or the booking that produced it.
    console.error('lead write failed', error)
    return false
  }
}
