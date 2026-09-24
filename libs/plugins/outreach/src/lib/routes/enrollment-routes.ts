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

import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import {
  applyOutreachEnrollmentEvent,
  type OutreachEnrollmentEvent,
} from '../engine/enrollment-state'
import { OUTREACH_OPEN_ENROLLMENT_STATUSES } from '../engine/gates'
import type {
  OutreachEnrollmentAction,
  OutreachEnrollmentActionResponse,
} from '../model/outreach-api'
import type { OutreachEnrollment } from '../model/outreach.types'
import { addOutreachDoNotContact } from '../storage/do-not-contact-store'
import { outreachOrgCollection, readStoredOutreachEnrollment } from '../storage/outreach-records'
import type { OutreachRouteDeps } from './route-deps'
import { outreachRouteGate } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachDocumentId,
  readOutreachJsonBody,
} from './route-http'

/**
 * WHAT A MEMBER DOES TO ONE ENROLLMENT (AGL-2980):
 * `outreach/enrollments/action` — pause, resume, stop, or mark the person
 * do-not-contact.
 *
 * Every transition is the engine's (`applyOutreachEnrollmentEvent`): the
 * route decides nothing about which status may follow which. Each write is
 * a transaction over the one document, so a member's pause and the sending
 * runtime's step completion cannot interleave and leave a paused enrollment
 * with a step it should not have run.
 *
 * MARK DO-NOT-CONTACT puts the address on the organization's list, with
 * the member as its author, and then opts out every enrollment that address
 * has in the organization — this one wherever it stood, and any other that
 * is still active or paused — so no sequence emails it again, whichever one
 * would have been next.
 *
 * RESUME on an enrollment the engine held for its gateway (AGL-3326) is the
 * member saying "send it anyway": the hold is stamped released with who and
 * when, and the gates do not hold that enrollment on the gateway again.
 */

const ACTIONS: readonly OutreachEnrollmentAction[] = ['pause', 'resume', 'stop', 'do_not_contact']

function eventFor(
  action: OutreachEnrollmentAction,
  atMs: number,
  byUid: string,
  detail: string | null,
): OutreachEnrollmentEvent {
  switch (action) {
    case 'pause':
      return { type: 'pause', atMs, byUid, detail }
    case 'resume':
      return { type: 'resume', atMs, byUid }
    case 'stop':
      return { type: 'stop', atMs, byUid, reason: 'manual', detail }
    case 'do_not_contact':
      return { type: 'opt_out', atMs, reason: 'do_not_contact', detail }
  }
}

export function createOutreachEnrollmentActionRoute(deps: OutreachRouteDeps): PluginWebApiHandler {
  return async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (caller instanceof Response) return caller
    const enrollmentId = readOutreachDocumentId(body['enrollmentId'])
    const action = body['action'] as OutreachEnrollmentAction
    if (!enrollmentId || !ACTIONS.includes(action)) {
      return outreachRefusal(400, 'invalid-request', 'Name the enrollment, and pause, resume, stop or mark it do-not-contact.')
    }
    const detail = typeof body['detail'] === 'string' ? body['detail'] : null
    const firestore = deps.firestore()
    const enrollments = outreachOrgCollection(firestore, caller.orgId, 'enrollments')
    const ref = enrollments.doc(enrollmentId)
    const nowMs = deps.now()

    const applied = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const enrollment = readStoredOutreachEnrollment(enrollmentId, snapshot.exists ? snapshot.data() : undefined)
      if (!enrollment) return null
      const { patch, error } = applyOutreachEnrollmentEvent(
        enrollment,
        eventFor(action, nowMs, caller.uid, detail),
      )
      if (!patch) return { enrollment, error, changed: false }
      // The opt-out event names no member; the person who marked it is
      // recorded here, beside the reason, and on the list entry.
      const released =
        action === 'resume' && enrollment.stopReason === 'gateway_blocked_here'
          ? {
              gatewayHold: {
                gateway: enrollment.gatewayHold?.gateway ?? 'other',
                heldAtMs: enrollment.gatewayHold?.heldAtMs ?? enrollment.stoppedAtMs,
                releasedByUid: caller.uid,
                releasedAtMs: nowMs,
              },
            }
          : {}
      const written = {
        ...patch,
        ...released,
        stoppedByUid: action === 'do_not_contact' ? caller.uid : patch.stoppedByUid,
        updatedAtMs: nowMs,
      }
      transaction.update(ref, written)
      return { enrollment: { ...enrollment, ...written } as OutreachEnrollment, error: null, changed: true }
    })
    if (!applied) return outreachRefusal(404, 'enrollment-not-found', 'That enrollment no longer exists.')
    // An address that bounced still goes on the list when a member asks:
    // the enrollment's own status stays final, the list entry is what they
    // asked for.
    if (applied.error && action !== 'do_not_contact') {
      return outreachRefusal(409, 'transition-refused', applied.error)
    }

    let stoppedOthers = 0
    if (action === 'do_not_contact') {
      await addOutreachDoNotContact(firestore, {
        orgId: caller.orgId,
        email: applied.enrollment.email,
        reason: 'manual',
        source: 'member',
        addedByUid: caller.uid,
        nowMs,
        enrollmentId,
        sequenceId: applied.enrollment.sequenceId,
        detail,
      })
      stoppedOthers = await optOutOtherEnrollments(firestore, enrollments, applied.enrollment, caller.uid, nowMs)
      // The mark on the record the person is (AGL-3245): the member's verdict
      // stands over every automatic one.
      await deps.stampRecordEmailState({
        orgId: caller.orgId,
        email: applied.enrollment.email,
        state: { status: 'do_not_contact', atMs: nowMs, source: 'member', detail, enrollmentId },
      })
    }
    return outreachOk({
      ok: true,
      changed: applied.changed,
      enrollment: applied.enrollment,
      stoppedOthers,
    } satisfies OutreachEnrollmentActionResponse)
  }
}

/** Opts out every OTHER open enrollment of the same address; returns how many. */
async function optOutOtherEnrollments(
  firestore: FirebaseFirestore.Firestore,
  enrollments: FirebaseFirestore.CollectionReference,
  marked: OutreachEnrollment,
  byUid: string,
  nowMs: number,
): Promise<number> {
  const found = await enrollments.where('email', '==', marked.email).get()
  const batch = firestore.batch()
  let writes = 0
  for (const doc of found.docs) {
    if (doc.id === marked.id) continue
    const other = readStoredOutreachEnrollment(doc.id, doc.data())
    if (!other || !OUTREACH_OPEN_ENROLLMENT_STATUSES.includes(other.status)) continue
    const { patch } = applyOutreachEnrollmentEvent(other, {
      type: 'opt_out',
      atMs: nowMs,
      reason: 'do_not_contact',
      detail: 'Marked do-not-contact from another sequence.',
    })
    if (!patch) continue
    batch.update(doc.ref, { ...patch, stoppedByUid: byUid, updatedAtMs: nowMs })
    writes += 1
  }
  if (writes) await batch.commit()
  return writes
}
