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

import { normalizeCampaignIds } from '@aglyn/aglyn/app-utils/campaign-membership'
import type { OutreachEnrollment } from '../model/outreach.types'
import { outreachOrgCollection, readStoredOutreachEnrollment } from '../storage/outreach-records'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * WHAT A SEQUENCE PRODUCED, CREDITED TO ITS CAMPAIGNS (AGL-3254).
 *
 * A sequence joins a campaign the way a form does, and every person
 * enrolled carries the sequence's campaigns as they stood at enrollment.
 * From then on each outcome of the enrollment is credited to those
 * campaigns through the platform's campaign attribution — the runtime's
 * `campaignCredit` seam — and never by writing the marketing plugin's
 * documents or importing it:
 *
 *  - `enrolled`, by the enroll route, when the enrollment is created;
 *  - `sent`, here, when the enrollment's FIRST email leaves — which is also
 *    when the person's own record gains the sequence's campaign as "where
 *    this came from", because a first email is the touch;
 *  - `replied`, here, when the reply stops the sequence;
 *  - `converted`, here, when a lead in a sequence becomes a contact;
 *  - `meetings`, by the booking door, from the touch the click route stamps.
 *
 * Every credit happens once per enrollment because each is tied to a state
 * change that happens once: there is one first email, a reply moves the
 * status to `replied` and nothing sends after, a lead converts once. An
 * enrollment naming no campaign credits nothing, silently — a sequence
 * outside every campaign is the ordinary case, not an error.
 */

/** The campaigns an enrollment credits: what it carries, cleaned. */
export function outreachEnrollmentCampaignIds(
  enrollment: Pick<OutreachEnrollment, 'campaignIds'>,
): string[] {
  return normalizeCampaignIds(enrollment.campaignIds)
}

/** Whether the email about to be recorded is the enrollment's first. */
export function isOutreachFirstEmail(enrollment: Pick<OutreachEnrollment, 'stepRecords'>): boolean {
  return !(enrollment.stepRecords ?? []).some((record) => record.kind === 'email')
}

/**
 * The first email of an enrollment left: `sent` on every campaign, and the
 * person's record credited to the first of them. One campaign on the
 * record, because the record's "where this came from" names one touch; the
 * sequence's first campaign is the one the rep listed first.
 */
export async function creditOutreachFirstSend(
  deps: Pick<OutreachRuntimeDeps, 'campaignCredit'>,
  input: { enrollment: OutreachEnrollment; atMs: number },
): Promise<void> {
  const { enrollment, atMs } = input
  const campaignIds = outreachEnrollmentCampaignIds(enrollment)
  if (!campaignIds.length || !isOutreachFirstEmail(enrollment)) return
  await deps.campaignCredit.credit({ hostId: enrollment.hostId, campaignIds, outcome: 'sent', atMs })
  const record =
    enrollment.target === 'lead' && enrollment.leadId
      ? { kind: 'lead' as const, refId: enrollment.leadId }
      : enrollment.contactId
        ? { kind: 'contact' as const, refId: enrollment.contactId }
        : null
  if (!record) return
  await deps.campaignCredit.attributeRecord({
    hostId: enrollment.hostId,
    ...record,
    campaignId: campaignIds[0],
    sequenceId: enrollment.sequenceId,
    enrollmentId: enrollment.id,
    atMs,
  })
}

/** A reply stopped the sequence: `replied` on every campaign. */
export async function creditOutreachReply(
  deps: Pick<OutreachRuntimeDeps, 'campaignCredit'>,
  input: { enrollment: OutreachEnrollment; atMs: number },
): Promise<void> {
  const campaignIds = outreachEnrollmentCampaignIds(input.enrollment)
  if (!campaignIds.length) return
  await deps.campaignCredit.credit({
    hostId: input.enrollment.hostId,
    campaignIds,
    outcome: 'replied',
    atMs: input.atMs,
  })
}

/**
 * A person clicked a link in a sequence email: the sequence's campaign
 * becomes their last campaign touch on the site, so what they go on to do
 * there — book, submit a form — is credited to it by the platform's own
 * doors. The first campaign, for the record-side reason above.
 */
export async function recordOutreachSequenceTouch(
  deps: Pick<OutreachRuntimeDeps, 'campaignCredit'>,
  input: { enrollment: OutreachEnrollment; atMs: number },
): Promise<void> {
  const { enrollment } = input
  const campaignIds = outreachEnrollmentCampaignIds(enrollment)
  if (!campaignIds.length || !enrollment.email) return
  await deps.campaignCredit.recordTouch({
    hostId: enrollment.hostId,
    email: enrollment.email,
    campaignId: campaignIds[0],
    sequenceId: enrollment.sequenceId,
    enrollmentId: enrollment.id,
    atMs: input.atMs,
  })
}

/**
 * A lead in a sequence became a contact: `converted` on every campaign of
 * every enrollment made on the lead. Run from the lead-conversion seam,
 * which fires once per conversion. Answers how many enrollments credited.
 */
export async function creditOutreachLeadConversion(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'now' | 'campaignCredit'>,
  input: { orgId: string; hostId: string; leadId: string },
): Promise<number> {
  const rows = await outreachOrgCollection(deps.firestore(), input.orgId, 'enrollments')
    .where('leadId', '==', input.leadId)
    .get()
  const atMs = deps.now()
  let credited = 0
  for (const row of rows.docs) {
    const enrollment = readStoredOutreachEnrollment(row.id, row.data())
    if (!enrollment || enrollment.hostId !== input.hostId) continue
    const campaignIds = outreachEnrollmentCampaignIds(enrollment)
    if (!campaignIds.length) continue
    await deps.campaignCredit.credit({ hostId: input.hostId, campaignIds, outcome: 'converted', atMs })
    credited += 1
  }
  return credited
}
