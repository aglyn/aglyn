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
 * A stored Outreach document read back into its model shape (AGL-2980),
 * for the server's routes and the console's listeners alike. Client-safe.
 *
 * Read DEFENSIVELY, a field at a time, because the readers act on what they
 * read: a sequence's steps are what gets sent, and an enrollment's status is
 * what decides whether it is sent at all.
 */

import { normalizeCampaignIds } from '@aglyn/aglyn/app-utils/campaign-membership'
import { readOutreachSequenceDraft } from './sequence-draft'
import {
  OUTREACH_ENROLLMENT_STATUSES,
  OUTREACH_SEQUENCE_STATUSES,
  OUTREACH_STEP_OVERRIDE_SOURCES,
  OUTREACH_STOP_REASONS,
  type OutreachEnrollment,
  type OutreachEnrollmentStatus,
  type OutreachEnrollmentTarget,
  type OutreachMailbox,
  type OutreachSequence,
  type OutreachSequenceStats,
  type OutreachSequenceStatus,
  type OutreachStepOverride,
  type OutreachStepOverrides,
  type OutreachStopReason,
} from './outreach.types'

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''
const ms = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []

/** A stored sequence in its model shape, or `null` for no document. */
export function readStoredOutreachSequence(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachSequence | null {
  if (!data) return null
  const draft = readOutreachSequenceDraft(data)
  const status = data['status']
  const stats = readOutreachSequenceStats(data['stats'])
  return {
    id,
    ...draft,
    status: (OUTREACH_SEQUENCE_STATUSES as readonly unknown[]).includes(status)
      ? (status as OutreachSequenceStatus)
      : 'draft',
    // Absent rather than an empty object for a sequence that has none
    // (AGL-3239): the report reads an absent counter as "not recorded" and
    // a present one as a number, and `{}` would be neither.
    ...(stats ? { stats } : {}),
    createdAtMs: ms(data['createdAtMs']) ?? 0,
    updatedAtMs: ms(data['updatedAtMs']) ?? 0,
  }
}

/**
 * A sequence's stored counters (AGL-3239), or `null` when it has none.
 *
 * Every field is carried through only when it is READABLE, so an absence
 * survives the round trip as an absence: the whole of the report's honesty
 * is that a counter nobody wrote is not a zero, and a normalizer that
 * defaulted these to `0` would destroy the distinction here, before any
 * reader could make it.
 */
export function readOutreachSequenceStats(
  raw: unknown,
): OutreachSequenceStats | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const stats: OutreachSequenceStats = {}
  for (const key of ['sent', 'people', 'clicks', 'uniqueClicks', 'machineClicks'] as const) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      stats[key] = Math.floor(value)
    }
  }
  if (data['clickTracked'] === true) stats.clickTracked = true
  const last = data['lastClickAtMs']
  if (typeof last === 'number' && Number.isFinite(last)) stats.lastClickAtMs = last
  return Object.keys(stats).length ? stats : null
}

/**
 * A stored enrollment's curated steps (AGL-3324), or `undefined` when it
 * carries none worth reading. Read a field at a time, because what is read
 * here is what gets SENT in place of the step: an entry with neither a
 * subject nor a body, or one keyed by something that is not a step index,
 * is dropped rather than sent as an empty email.
 */
export function readOutreachStepOverrides(raw: unknown): OutreachStepOverrides | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const overrides: OutreachStepOverrides = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || !value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const subject = typeof entry['subject'] === 'string' ? entry['subject'] : undefined
    const body = typeof entry['body'] === 'string' ? entry['body'] : undefined
    if (subject === undefined && body === undefined) continue
    const source = entry['source']
    const override: OutreachStepOverride = {
      ...(subject !== undefined ? { subject } : {}),
      ...(body !== undefined ? { body } : {}),
      // Words nobody can say the source of are read as the member's: the
      // audit line then claims no AI wrote them.
      source: (OUTREACH_STEP_OVERRIDE_SOURCES as readonly unknown[]).includes(source)
        ? (source as OutreachStepOverride['source'])
        : 'member',
      draftedAtMs: ms(entry['draftedAtMs']) ?? 0,
      ...(typeof entry['draftedByUid'] === 'string' ? { draftedByUid: entry['draftedByUid'] } : {}),
      ...(entry['edited'] === true ? { edited: true } : {}),
      ...(typeof entry['prompt'] === 'string' ? { prompt: entry['prompt'] } : {}),
      ...(typeof entry['model'] === 'string' ? { model: entry['model'] } : {}),
    }
    overrides[key] = override
  }
  return Object.keys(overrides).length ? overrides : undefined
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
  // An enrollment written before leads could be sequenced (AGL-3234) names
  // no target and is a contact's; one that names a lead and no target is a
  // lead's, whatever else it says.
  const leadId = text(data['leadId']) || null
  const target: OutreachEnrollmentTarget =
    data['target'] === 'lead' || (data['target'] === undefined && leadId && !text(data['contactId']))
      ? 'lead'
      : 'contact'
  const enrollment: OutreachEnrollment = {
    ...(data as unknown as OutreachEnrollment),
    id,
    sequenceId: text(data['sequenceId']),
    target,
    contactId: text(data['contactId']),
    leadId,
    contactName: text(data['contactName']),
    email: text(data['email']),
    hostId: text(data['hostId']),
    mailboxId: text(data['mailboxId']),
    stepIndex: Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0,
    nextDueAtMs: ms(data['nextDueAtMs']),
    // A status the model does not name is read as stopped: nothing sends
    // from a document nobody can say the state of.
    status: (OUTREACH_ENROLLMENT_STATUSES as readonly unknown[]).includes(
      status,
    )
      ? (status as OutreachEnrollmentStatus)
      : 'stopped',
    stopReason: (OUTREACH_STOP_REASONS as readonly unknown[]).includes(
      stopReason,
    )
      ? (stopReason as OutreachStopReason)
      : null,
    stopDetail:
      typeof data['stopDetail'] === 'string' ? data['stopDetail'] : null,
    stoppedAtMs: ms(data['stoppedAtMs']),
    stoppedByUid:
      typeof data['stoppedByUid'] === 'string' ? data['stoppedByUid'] : null,
    personalLine: text(data['personalLine']),
    cold: data['cold'] === true,
    enrolledByUid: text(data['enrolledByUid']),
    gmailThreadId:
      typeof data['gmailThreadId'] === 'string' ? data['gmailThreadId'] : null,
    gmailThreadIds: texts(data['gmailThreadIds']),
    threadSubject:
      typeof data['threadSubject'] === 'string' ? data['threadSubject'] : null,
    messageIds: texts(data['messageIds']),
    lastSentAtMs: ms(data['lastSentAtMs']),
    // Absent on an enrollment made before a sequence could join a campaign
    // (AGL-3254), and read as none: nothing is credited to a campaign the
    // enrollment does not name.
    campaignIds: normalizeCampaignIds(data['campaignIds']),
    createdAtMs: ms(data['createdAtMs']) ?? 0,
    updatedAtMs: ms(data['updatedAtMs']) ?? 0,
  }
  // Absent rather than an empty map for an enrollment nobody curated
  // (AGL-3324): the spread above would otherwise carry whatever was stored.
  const stepOverrides = readOutreachStepOverrides(data['stepOverrides'])
  if (stepOverrides) enrollment.stepOverrides = stepOverrides
  else delete enrollment.stepOverrides
  return enrollment
}

/** A stored mailbox with its id, or `null` for no document. */
export function readStoredOutreachMailbox(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachMailbox | null {
  if (!data) return null
  return { ...(data as unknown as OutreachMailbox), id }
}
