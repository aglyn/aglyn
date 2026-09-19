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
import { applyOutreachEnrollmentEvent } from '../engine/enrollment-state'
import {
  validateOutreachSequence,
  validateOutreachSequenceActivation,
} from '../engine/sequence-validation'
import type {
  OutreachSequenceAction,
  OutreachSequenceSaveResponse,
  OutreachSequenceStatusResponse,
} from '../model/outreach-api'
import { OUTREACH_OPEN_ENROLLMENT_STATUSES } from '../engine/gates'
import type { OutreachSequence, OutreachSequenceStatus } from '../model/outreach.types'
import {
  outreachEnrolledSequenceIssues,
  readOutreachSequenceDraft,
  type OutreachSequenceDraft,
  type OutreachSequenceIssue,
} from '../model/sequence-draft'
import { readOutreachComplianceSettingsDoc } from '../storage/compliance-settings-store'
import {
  outreachOrgCollection,
  readStoredOutreachEnrollment,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../storage/outreach-records'
import type { OutreachRouteDeps } from './route-deps'
import { outreachRouteGate, type OutreachRouteCaller } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachDocumentId,
  readOutreachJsonBody,
} from './route-http'

/**
 * THE SEQUENCE ROUTES (AGL-2980): save, activate, pause, archive, delete.
 *
 * ## Who may change a sequence
 *
 * A sequence sends as the member whose mailbox it names, so it is theirs to
 * change: the member who connected the mailbox, or an organization owner or
 * admin, may save it, activate it and send from it — the same two the
 * mailbox's own routes let manage the mailbox. Anyone with `outreach.use`
 * may pause or archive any sequence, because stopping mail is never the act
 * that needs guarding.
 *
 * ## Saving
 *
 * The draft is read with the editor's reader and judged by the engine's
 * validator, so the save refuses exactly what the editor showed beside a
 * field. On top of that, the site must be one of the organization's, the
 * mailbox one of its connected mailboxes, the countries ones the
 * organization allows, and — once anyone is enrolled — the steps, site and
 * mailbox fixed (`outreachEnrolledSequenceIssues`). A new sequence is a
 * draft; an edit keeps the status it had, and an active sequence stays
 * active only because the edit passed the same validator activation does.
 *
 * ## Activating
 *
 * `validateOutreachSequenceActivation`: everything a save refuses on, and an
 * organization whose footer cannot be written — no legal name, or no postal
 * address. Its mailbox must still be connected.
 *
 * ## Archiving
 *
 * Final. Every person still active or paused in the sequence is stopped
 * with `sequence_archived`, in batches, so no archived sequence goes on
 * sending.
 */

/** A batch holds 500 writes; a page of enrollments stops this many. */
const ARCHIVE_PAGE = 400

/** The activity line each lifecycle act writes. */
export const OUTREACH_SEQUENCE_ACTIVITY = {
  create: 'Created an Outreach sequence',
  activate: 'Activated an Outreach sequence',
  pause: 'Paused an Outreach sequence',
  archive: 'Archived an Outreach sequence',
  delete: 'Deleted an Outreach sequence',
} as const

/** Where each action may start, and where it ends. */
const TRANSITIONS: Record<
  OutreachSequenceAction,
  { from: readonly OutreachSequenceStatus[]; to: OutreachSequenceStatus }
> = {
  activate: { from: ['draft', 'paused'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  archive: { from: ['draft', 'active', 'paused'], to: 'archived' },
}

const ACTION_REFUSALS: Record<OutreachSequenceAction, string> = {
  activate: 'Only a draft or paused sequence can be activated.',
  pause: 'Only an active sequence can be paused.',
  archive: 'This sequence is already archived.',
}

export interface OutreachSequenceRoutes {
  save: PluginWebApiHandler
  status: PluginWebApiHandler
  remove: PluginWebApiHandler
}

type Firestore = FirebaseFirestore.Firestore

async function loadSequence(
  firestore: Firestore,
  orgId: string,
  sequenceId: string,
): Promise<OutreachSequence | null> {
  const snapshot = await outreachOrgCollection(firestore, orgId, 'sequences').doc(sequenceId).get()
  return readStoredOutreachSequence(sequenceId, snapshot.exists ? snapshot.data() : undefined)
}

/** Whether anyone was ever enrolled in the sequence. */
async function hasEnrollments(firestore: Firestore, orgId: string, sequenceId: string): Promise<boolean> {
  const found = await outreachOrgCollection(firestore, orgId, 'enrollments')
    .where('sequenceId', '==', sequenceId)
    .limit(1)
    .get()
  return !found.empty
}

const issue = (
  path: string,
  code: OutreachSequenceIssue['code'],
  message: string,
): OutreachSequenceIssue => ({ path, code, message, severity: 'error' })

/**
 * The organization-level facts a draft has to agree with: its site is the
 * organization's, its mailbox is connected and the caller may send from it,
 * and its countries are ones the organization allows.
 */
async function draftPlacementIssues(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  draft: OutreachSequenceDraft,
): Promise<OutreachSequenceIssue[]> {
  const issues: OutreachSequenceIssue[] = []
  if (draft.hostId) {
    const host = readOutreachDocumentId(draft.hostId)
      ? await firestore.collection('hosts').doc(draft.hostId).get()
      : null
    if (!host?.exists || host.get('orgId') !== caller.orgId) {
      issues.push(issue('hostId', 'host_unknown', "Choose one of this organization's sites."))
    }
  } else {
    issues.push(issue('hostId', 'host_unknown', "Choose the site whose contacts this sequence emails."))
  }
  if (draft.mailboxId) {
    issues.push(...(await mailboxIssues(firestore, caller, draft.mailboxId)))
  }
  const settings = await readOutreachComplianceSettingsDoc(firestore, caller.orgId)
  const outside = draft.settings.allowedCountries.filter(
    (code) => !settings.allowedCountries.includes(code),
  )
  if (outside.length) {
    issues.push(
      issue(
        'settings.allowedCountries',
        'country_not_in_org',
        `${outside.join(', ')} ${outside.length === 1 ? "isn't" : "aren't"} among the countries your organization allows. Add ${outside.length === 1 ? 'it' : 'them'} in Outreach compliance settings first.`,
      ),
    )
  }
  return issues
}

/** Whether the mailbox is connected here, and the caller may send from it. */
async function mailboxIssues(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  mailboxId: string,
): Promise<OutreachSequenceIssue[]> {
  const snapshot = readOutreachDocumentId(mailboxId)
    ? await outreachOrgCollection(firestore, caller.orgId, 'mailboxes').doc(mailboxId).get()
    : null
  const mailbox = readStoredOutreachMailbox(mailboxId, snapshot?.exists ? snapshot.data() : undefined)
  if (!mailbox || mailbox.status === 'disconnected') {
    return [issue('mailboxId', 'mailbox_unknown', 'That mailbox is not connected to this organization.')]
  }
  if (mailbox.connectedByUid !== caller.uid && !caller.isOrgAdmin) {
    return [
      issue(
        'mailboxId',
        'mailbox_not_yours',
        'Only the member who connected this mailbox, or an organization owner or admin, can send from it.',
      ),
    ]
  }
  return []
}

export function createOutreachSequenceRoutes(deps: OutreachRouteDeps): OutreachSequenceRoutes {
  const activity = (caller: OutreachRouteCaller, action: string, sequence: Pick<OutreachSequence, 'id' | 'name'>) =>
    deps.logOrgActivity(caller.orgId, { uid: caller.uid, email: caller.email }, action, {
      type: 'sequence',
      id: sequence.id,
      name: sequence.name,
    })

  const save: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (caller instanceof Response) return caller
    const firestore = deps.firestore()

    const rawId = body['sequenceId']
    const sequenceId = rawId === undefined || rawId === null || rawId === '' ? null : readOutreachDocumentId(rawId)
    if (rawId && !sequenceId) return outreachRefusal(400, 'invalid-request', 'Name the sequence to save.')
    const existing = sequenceId ? await loadSequence(firestore, caller.orgId, sequenceId) : null
    if (sequenceId && !existing) {
      return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')
    }
    if (existing?.status === 'archived') {
      return outreachRefusal(409, 'sequence-archived', "An archived sequence can't be edited.")
    }

    const draft = readOutreachSequenceDraft(body['sequence'])
    // A sequence sends as its mailbox's member, so it is theirs (or an
    // admin's) to change — the stored mailbox as well as a new one: moving
    // a colleague's sequence onto your own mailbox is still changing theirs.
    if (existing?.mailboxId && existing.mailboxId !== draft.mailboxId) {
      const stored = await mailboxIssues(firestore, caller, existing.mailboxId)
      const refused = stored.find((entry) => entry.code === 'mailbox_not_yours')
      if (refused) return outreachRefusal(403, 'permission', refused.message)
    }
    const judged: OutreachSequenceIssue[] = [
      ...validateOutreachSequence(draft),
      ...(await draftPlacementIssues(firestore, caller, draft)),
    ]
    const ownership = judged.find((entry) => entry.code === 'mailbox_not_yours')
    if (ownership) return outreachRefusal(403, 'permission', ownership.message)
    if (existing && (await hasEnrollments(firestore, caller.orgId, existing.id))) {
      judged.push(...outreachEnrolledSequenceIssues(existing, draft))
    }
    const errors = judged.filter((entry) => entry.severity === 'error')
    if (errors.length) {
      return outreachRefusal(400, 'invalid-sequence', errors[0].message, { issues: judged })
    }

    const nowMs = deps.now()
    const ref = existing
      ? outreachOrgCollection(firestore, caller.orgId, 'sequences').doc(existing.id)
      : outreachOrgCollection(firestore, caller.orgId, 'sequences').doc()
    const sequence: OutreachSequence = {
      id: ref.id,
      ...draft,
      status: existing?.status ?? 'draft',
      createdAtMs: existing?.createdAtMs || nowMs,
      updatedAtMs: nowMs,
    }
    await ref.set(sequence)
    if (!existing) await activity(caller, OUTREACH_SEQUENCE_ACTIVITY.create, sequence)
    return outreachOk({
      ok: true,
      sequence,
      created: !existing,
      warnings: judged.filter((entry) => entry.severity === 'warning'),
    } satisfies OutreachSequenceSaveResponse)
  }

  const status: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (caller instanceof Response) return caller
    const action = body['action'] as OutreachSequenceAction
    const sequenceId = readOutreachDocumentId(body['sequenceId'])
    if (!sequenceId || !Object.prototype.hasOwnProperty.call(TRANSITIONS, action)) {
      return outreachRefusal(400, 'invalid-request', 'Name the sequence, and activate, pause or archive.')
    }
    const firestore = deps.firestore()
    const sequence = await loadSequence(firestore, caller.orgId, sequenceId)
    if (!sequence) return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')
    const transition = TRANSITIONS[action]
    if (sequence.status === transition.to) {
      return outreachOk({ ok: true, sequence, stoppedEnrollments: 0 } satisfies OutreachSequenceStatusResponse)
    }
    if (!transition.from.includes(sequence.status)) {
      return outreachRefusal(409, 'transition-refused', ACTION_REFUSALS[action])
    }

    if (action === 'activate') {
      const orgSettings = await readOutreachComplianceSettingsDoc(firestore, caller.orgId)
      const judged: OutreachSequenceIssue[] = [
        ...validateOutreachSequenceActivation(sequence, orgSettings),
        ...(await draftPlacementIssues(firestore, caller, sequence)),
      ].filter((entry) => entry.severity === 'error')
      if (judged.length) {
        const ownership = judged.find((entry) => entry.code === 'mailbox_not_yours')
        return ownership
          ? outreachRefusal(403, 'permission', ownership.message)
          : outreachRefusal(409, 'activation-refused', judged[0].message, { issues: judged })
      }
    }

    const nowMs = deps.now()
    const next: OutreachSequence = { ...sequence, status: transition.to, updatedAtMs: nowMs }
    await outreachOrgCollection(firestore, caller.orgId, 'sequences')
      .doc(sequence.id)
      .update({ status: next.status, updatedAtMs: nowMs })
    const stoppedEnrollments =
      action === 'archive' ? await stopOpenEnrollments(firestore, caller, sequence.id, nowMs) : 0
    await activity(caller, OUTREACH_SEQUENCE_ACTIVITY[action], sequence)
    return outreachOk({ ok: true, sequence: next, stoppedEnrollments } satisfies OutreachSequenceStatusResponse)
  }

  const remove: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (caller instanceof Response) return caller
    const sequenceId = readOutreachDocumentId(body['sequenceId'])
    if (!sequenceId) return outreachRefusal(400, 'invalid-request', 'Name the sequence to delete.')
    const firestore = deps.firestore()
    const sequence = await loadSequence(firestore, caller.orgId, sequenceId)
    if (!sequence) return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')
    if (sequence.status !== 'draft' || (await hasEnrollments(firestore, caller.orgId, sequence.id))) {
      // What people were sent, and why they stopped, is the record of what
      // this organization did; only a draft nobody was enrolled in has none.
      return outreachRefusal(
        409,
        'delete-refused',
        'Only a draft nobody was enrolled in can be deleted. Archive this sequence instead.',
      )
    }
    await outreachOrgCollection(firestore, caller.orgId, 'sequences').doc(sequence.id).delete()
    await activity(caller, OUTREACH_SEQUENCE_ACTIVITY.delete, sequence)
    return outreachOk({ ok: true })
  }

  return { save, status, remove }
}

/**
 * Stops everyone still active or paused in an archived sequence, a page at
 * a time, through the engine's own transition. Returns how many it stopped.
 */
async function stopOpenEnrollments(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  sequenceId: string,
  nowMs: number,
): Promise<number> {
  const enrollments = outreachOrgCollection(firestore, caller.orgId, 'enrollments')
  let stopped = 0
  let after: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let page = enrollments.where('sequenceId', '==', sequenceId).orderBy('__name__').limit(ARCHIVE_PAGE)
    if (after) page = page.startAfter(after)
    const snapshot = await page.get()
    if (snapshot.empty) break
    const batch = firestore.batch()
    let writes = 0
    for (const doc of snapshot.docs) {
      const enrollment = readStoredOutreachEnrollment(doc.id, doc.data())
      if (!enrollment || !OUTREACH_OPEN_ENROLLMENT_STATUSES.includes(enrollment.status)) continue
      const { patch } = applyOutreachEnrollmentEvent(enrollment, {
        type: 'stop',
        reason: 'sequence_archived',
        atMs: nowMs,
        byUid: caller.uid,
      })
      if (!patch) continue
      batch.update(doc.ref, { ...patch, updatedAtMs: nowMs })
      writes += 1
    }
    if (writes) await batch.commit()
    stopped += writes
    after = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < ARCHIVE_PAGE) break
  }
  return stopped
}
