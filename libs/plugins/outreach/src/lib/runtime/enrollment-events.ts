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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import {
  applyOutreachEnrollmentEvent,
  type OutreachEnrollmentEvent,
} from '../engine/enrollment-state'
import { OUTREACH_OPEN_ENROLLMENT_STATUSES } from '../engine/gates'
import type { OutreachDoNotContactReason, OutreachEnrollment } from '../model/outreach.types'
import { addOutreachDoNotContact } from '../storage/do-not-contact-store'
import { outreachOrgCollection, readStoredOutreachEnrollment } from '../storage/outreach-records'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * WHAT THE RUNTIME DOES TO ENROLLMENTS, AND TO THE LISTS BESIDE THEM
 * (AGL-2981).
 *
 * Every status change is the engine's (`applyOutreachEnrollmentEvent`),
 * written in a transaction over the one enrollment so a member's pause and a
 * run's step completion never interleave. The runtime's events name no
 * member: `stoppedByUid` stays `null`.
 */

type Firestore = FirebaseFirestore.Firestore

/** The enrollment after an event, and whether the event changed it. */
export interface OutreachEventOutcome {
  enrollment: OutreachEnrollment | null
  changed: boolean
}

/**
 * Applies one event to one enrollment, with any fields the caller writes
 * beside it — its handled message ids, a postponed due time. A transition
 * the engine refuses writes only the extra fields.
 */
export async function applyOutreachEvent(
  firestore: Firestore,
  input: {
    orgId: string
    enrollmentId: string
    event: OutreachEnrollmentEvent | null
    extra?: (enrollment: OutreachEnrollment) => Record<string, unknown> | null
    nowMs: number
  },
): Promise<OutreachEventOutcome> {
  const ref = outreachOrgCollection(firestore, input.orgId, 'enrollments').doc(input.enrollmentId)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const enrollment = readStoredOutreachEnrollment(input.enrollmentId, snapshot.exists ? snapshot.data() : undefined)
    if (!enrollment) return { enrollment: null, changed: false }
    const patch = input.event ? applyOutreachEnrollmentEvent(enrollment, input.event).patch : null
    const extra = input.extra?.(enrollment) ?? null
    if (!patch && !extra) return { enrollment, changed: false }
    const written = { ...(patch ?? {}), ...(extra ?? {}), updatedAtMs: input.nowMs }
    transaction.update(ref, written)
    return { enrollment: { ...enrollment, ...written } as OutreachEnrollment, changed: patch !== null }
  })
}

/**
 * Opts every OTHER open enrollment of an address in the organization out,
 * as `do_not_contact`: the person asked not to be emailed, so no sequence
 * is next. Answers how many moved.
 */
export async function optOutOtherOutreachEnrollments(
  firestore: Firestore,
  input: { orgId: string; email: string; exceptEnrollmentId: string | null; nowMs: number; detail: string },
): Promise<number> {
  const found = await outreachOrgCollection(firestore, input.orgId, 'enrollments')
    .where('email', '==', input.email)
    .get()
  let moved = 0
  for (const doc of found.docs) {
    if (doc.id === input.exceptEnrollmentId) continue
    if (!OUTREACH_OPEN_ENROLLMENT_STATUSES.includes(doc.get('status'))) continue
    const outcome = await applyOutreachEvent(firestore, {
      orgId: input.orgId,
      enrollmentId: doc.id,
      event: { type: 'opt_out', atMs: input.nowMs, reason: 'do_not_contact', detail: input.detail },
      nowMs: input.nowMs,
    })
    if (outcome.changed) moved += 1
  }
  return moved
}

/** Where an opt-out came from. */
export type OutreachOptOutSource = Extract<OutreachDoNotContactReason, 'opt_out_reply' | 'unsubscribe'>

/**
 * A person asked not to be emailed — by the unsubscribe link, the `mailto:`
 * or a reply — and every list that has to remember it does:
 *
 *  1. the organization's do-not-contact list, which every sequence checks
 *     before every send (its first entry for the address stands);
 *  2. the `sales` topic of each site named, which the site's own sales
 *     email reads too;
 *  3. every open enrollment of the address in the organization: the one it
 *     came from with the reason given, the others as `do_not_contact`.
 *
 * Each is idempotent, so a second request — the link used twice, a reply
 * read by two runs — changes nothing.
 */
export async function recordOutreachOptOut(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'optOutOfSalesTopic'>,
  input: {
    orgId: string
    email: string
    source: OutreachOptOutSource
    enrollment: Pick<OutreachEnrollment, 'id' | 'sequenceId' | 'hostId'> | null
    hostIds: readonly string[]
    detail: string | null
    nowMs: number
  },
): Promise<{ stopped: number }> {
  const email = normalizeContactEmail(input.email)
  if (!email) return { stopped: 0 }
  const firestore = deps.firestore()
  await addOutreachDoNotContact(firestore, {
    orgId: input.orgId,
    email,
    reason: input.source,
    source: 'runtime',
    nowMs: input.nowMs,
    enrollmentId: input.enrollment?.id ?? null,
    sequenceId: input.enrollment?.sequenceId ?? null,
    detail: input.detail,
  })
  for (const hostId of new Set(input.hostIds.filter(Boolean))) {
    await deps.optOutOfSalesTopic({ hostId, email })
  }
  let stopped = 0
  if (input.enrollment) {
    const own = await applyOutreachEvent(firestore, {
      orgId: input.orgId,
      enrollmentId: input.enrollment.id,
      event: { type: 'opt_out', atMs: input.nowMs, reason: input.source, detail: input.detail },
      nowMs: input.nowMs,
    })
    if (own.changed) stopped += 1
  }
  stopped += await optOutOtherOutreachEnrollments(firestore, {
    orgId: input.orgId,
    email,
    exceptEnrollmentId: input.enrollment?.id ?? null,
    nowMs: input.nowMs,
    detail:
      input.source === 'unsubscribe'
        ? 'Unsubscribed from another sequence.'
        : 'Asked not to be emailed in a reply to another sequence.',
  })
  return { stopped }
}
