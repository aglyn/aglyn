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
 * The org-scoped Outreach documents as the server reads them (AGL-2980):
 * where each lives, and each read back into its model shape. Server only —
 * the references are the Admin SDK's.
 *
 * A stored document is read DEFENSIVELY, a field at a time, because the
 * readers act on what they read: a sequence's steps are what gets sent, and
 * an enrollment's status is what decides whether it is sent at all.
 */

import { readOutreachSequenceDraft } from '../model/sequence-draft'
import {
  OUTREACH_COLLECTIONS,
  OUTREACH_ENROLLMENT_STATUSES,
  OUTREACH_SEQUENCE_STATUSES,
  OUTREACH_STOP_REASONS,
  type OutreachEnrollment,
  type OutreachEnrollmentStatus,
  type OutreachMailbox,
  type OutreachOrgCollection,
  type OutreachSequence,
  type OutreachSequenceStatus,
  type OutreachStopReason,
} from '../model/outreach.types'

/** `orgs/{orgId}/<collection>` for one of Outreach's org-scoped collections. */
export function outreachOrgCollection(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  collection: OutreachOrgCollection,
): FirebaseFirestore.CollectionReference {
  return firestore.collection('orgs').doc(orgId).collection(OUTREACH_COLLECTIONS[collection])
}

/**
 * The id of one person's enrollment in one sequence. Deterministic, so a
 * person is enrolled in a sequence once, ever: a second enroll finds the
 * first document where a random id would have made a second, and a second
 * run through the same emails is exactly what must not happen.
 */
export function outreachEnrollmentId(sequenceId: string, contactId: string): string {
  return `${sequenceId}_${contactId}`
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const ms = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

/** A stored sequence in its model shape, or `null` for no document. */
export function readStoredOutreachSequence(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachSequence | null {
  if (!data) return null
  const draft = readOutreachSequenceDraft(data)
  const status = data['status']
  return {
    id,
    ...draft,
    status: (OUTREACH_SEQUENCE_STATUSES as readonly unknown[]).includes(status)
      ? (status as OutreachSequenceStatus)
      : 'draft',
    createdAtMs: ms(data['createdAtMs']) ?? 0,
    updatedAtMs: ms(data['updatedAtMs']) ?? 0,
  }
}

/** A stored enrollment in its model shape, or `null` for no document. */
export function readStoredOutreachEnrollment(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachEnrollment | null {
  if (!data) return null
  const status = data['status']
  const stopReason = data['stopReason']
  const stepIndex = Number(data['stepIndex'])
  return {
    ...(data as unknown as OutreachEnrollment),
    id,
    sequenceId: text(data['sequenceId']),
    contactId: text(data['contactId']),
    contactName: text(data['contactName']),
    email: text(data['email']),
    hostId: text(data['hostId']),
    mailboxId: text(data['mailboxId']),
    stepIndex: Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0,
    nextDueAtMs: ms(data['nextDueAtMs']),
    // A status the model does not name is read as stopped: nothing sends
    // from a document nobody can say the state of.
    status: (OUTREACH_ENROLLMENT_STATUSES as readonly unknown[]).includes(status)
      ? (status as OutreachEnrollmentStatus)
      : 'stopped',
    stopReason: (OUTREACH_STOP_REASONS as readonly unknown[]).includes(stopReason)
      ? (stopReason as OutreachStopReason)
      : null,
    stopDetail: typeof data['stopDetail'] === 'string' ? data['stopDetail'] : null,
    stoppedAtMs: ms(data['stoppedAtMs']),
    stoppedByUid: typeof data['stoppedByUid'] === 'string' ? data['stoppedByUid'] : null,
    personalLine: text(data['personalLine']),
    cold: data['cold'] === true,
    enrolledByUid: text(data['enrolledByUid']),
    gmailThreadId: typeof data['gmailThreadId'] === 'string' ? data['gmailThreadId'] : null,
    gmailThreadIds: texts(data['gmailThreadIds']),
    threadSubject: typeof data['threadSubject'] === 'string' ? data['threadSubject'] : null,
    messageIds: texts(data['messageIds']),
    lastSentAtMs: ms(data['lastSentAtMs']),
    createdAtMs: ms(data['createdAtMs']) ?? 0,
    updatedAtMs: ms(data['updatedAtMs']) ?? 0,
  }
}

/** A stored mailbox with its id, or `null` for no document. */
export function readStoredOutreachMailbox(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachMailbox | null {
  if (!data) return null
  return { ...(data as unknown as OutreachMailbox), id }
}
