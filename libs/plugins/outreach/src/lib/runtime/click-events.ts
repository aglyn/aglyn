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
  CAMPAIGN_LINK_ROLLUP_MAX,
  campaignLinkKey,
} from '@aglyn/shared-ui-email-campaigns/model'
import { FieldValue } from 'firebase-admin/firestore'
import { OUTREACH_PLUGIN_ID } from '../constants/bundle-common'
import {
  judgeOutreachClick,
  type OutreachClickJudgement,
} from '../engine/click-tracking'
import { readOutreachEngagement } from '../model/enrollment-engagement'
import {
  OUTREACH_LINK_ROLLUP_PATH,
  type OutreachEnrollment,
  type OutreachEnrollmentEngagement,
} from '../model/outreach.types'
import {
  outreachEnrollmentLink,
  outreachOrgCollection,
  readStoredOutreachEnrollment,
} from '../storage/outreach-records'
import type { OutreachClickTarget } from './click-link'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * RECORDING A CLICK (AGL-3239).
 *
 * Every write here happens AFTER the recipient has been sent on their way.
 * A click is bookkeeping beside the act, in the same order `timeline.ts`
 * puts an email and its filing: the destination is in the token, so the
 * redirect needs nothing from Firestore to answer it, and a failure here
 * costs a number rather than a visit.
 *
 * Three places are written, because three different questions are asked of
 * them and no one document answers all three:
 *
 * 1. **The enrollment** — "did THIS person act?", which the enrollments
 *    table shows per row and a rep reads before calling someone.
 * 2. **The sequence** — "is this sequence working?", which is the report
 *    card, and which cannot be derived from the enrollments because the
 *    console lists them a page at a time.
 * 3. **The link rollup** — "which of our links did they follow?", one
 *    document holding a bounded map, keyed and capped by the campaign
 *    rollup's own rules so a link means the same thing in both reports.
 */

/** What one recorded click turned out to be. */
export interface OutreachClickOutcome extends OutreachClickJudgement {
  /** Whether it was this person's first human click — the sequence's `uniqueClicks`. */
  first: boolean
  /** The enrollment it was recorded against, or `null` when there is none. */
  enrollment: OutreachEnrollment | null
}

/** When the step that carried the link was sent, or `null` when it cannot be found. */
function sentAtMs(enrollment: OutreachEnrollment, stepIndex: number): number | null {
  const records = enrollment.stepRecords ?? []
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record?.stepIndex === stepIndex && record.kind === 'email') {
      return typeof record.atMs === 'number' && Number.isFinite(record.atMs) ? record.atMs : null
    }
  }
  return null
}

/**
 * Records one visit to a tracking link.
 *
 * The enrollment is read and written in a transaction, because two links
 * followed at once must not both read a `clicks` of nought and both write a
 * one — and because whether this is the person's FIRST click is decided from
 * the same read that writes it, which is what keeps `uniqueClicks` from
 * counting one person twice.
 *
 * An enrollment that no longer exists belongs to a person or a workspace
 * already erased. Nothing is recorded for them, anywhere — a deleted record
 * must not be reconstructed from a click on an old email — and the caller
 * has already answered the redirect either way.
 */
export async function recordOutreachClick(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'now' | 'timeline'>,
  input: {
    target: OutreachClickTarget
    method: string
    userAgent: string | null | undefined
  },
): Promise<OutreachClickOutcome> {
  const firestore = deps.firestore()
  const { orgId, enrollmentId, stepIndex, url } = input.target
  const nowMs = deps.now()
  const ref = outreachOrgCollection(firestore, orgId, 'enrollments').doc(enrollmentId)

  const outcome = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const enrollment = readStoredOutreachEnrollment(
      enrollmentId,
      snapshot.exists ? snapshot.data() : undefined,
    )
    if (!enrollment) {
      return { human: false, machineReason: null, first: false, enrollment: null } as OutreachClickOutcome
    }
    const sent = sentAtMs(enrollment, stepIndex)
    const judgement = judgeOutreachClick({
      method: input.method,
      userAgent: input.userAgent,
      sinceSentMs: sent === null ? null : nowMs - sent,
    })
    const held = readOutreachEngagement(enrollment.engagement)
    const first = judgement.human && held.firstClickAtMs === null
    const engagement: OutreachEnrollmentEngagement = judgement.human
      ? {
          clicks: held.clicks + 1,
          firstClickAtMs: held.firstClickAtMs ?? nowMs,
          lastClickAtMs: nowMs,
          lastClickUrl: campaignLinkKey(url) ?? held.lastClickUrl,
          machineClicks: held.machineClicks,
        }
      : { ...held, machineClicks: held.machineClicks + 1 }
    /*
     * `updatedAtMs` is deliberately NOT touched. It is what the enrollments
     * table sorts "last activity" by and what a member reads as "something
     * happened to this enrollment", and a scanner's fetch of a link is not
     * that. The engagement carries its own timestamps for what a click is.
     */
    transaction.update(ref, { engagement })
    return { ...judgement, first, enrollment: { ...enrollment, engagement } } as OutreachClickOutcome
  })

  if (!outcome.enrollment) return outcome

  await Promise.all([
    bumpSequenceStats(firestore, outcome, {
      orgId,
      sequenceId: outcome.enrollment.sequenceId,
      nowMs,
    }),
    outcome.human ? bumpLinkRollup(firestore, { orgId, sequenceId: outcome.enrollment.sequenceId, url }) : null,
    outcome.first ? fileFirstClick(deps, { orgId, enrollment: outcome.enrollment, url, nowMs }) : null,
  ])
  return outcome
}

/**
 * The sequence's counters, incremented outside the enrollment's transaction.
 *
 * One sequence holds every enrollment's clicks, so a transaction over it
 * would serialise every recipient of a sequence against every other.
 * `FieldValue.increment` is a blind write with no read to contend on, which
 * is exactly what a counter wants.
 */
async function bumpSequenceStats(
  firestore: FirebaseFirestore.Firestore,
  outcome: OutreachClickOutcome,
  input: { orgId: string; sequenceId: string; nowMs: number },
): Promise<void> {
  if (!input.sequenceId) return
  const patch: Record<string, unknown> = outcome.human
    ? {
        'stats.clicks': FieldValue.increment(1),
        'stats.lastClickAtMs': input.nowMs,
        ...(outcome.first ? { 'stats.uniqueClicks': FieldValue.increment(1) } : {}),
      }
    : { 'stats.machineClicks': FieldValue.increment(1) }
  await outreachOrgCollection(firestore, input.orgId, 'sequences')
    .doc(input.sequenceId)
    .update(patch)
    .catch((error: unknown) => {
      // A sequence deleted while its mail is still out there. The click is
      // already on the enrollment; the aggregate has nowhere to go.
      console.warn('[outreach] a click could not be counted on its sequence', error)
    })
}

/**
 * The per-destination rollup for one sequence.
 *
 * Keyed by `campaignLinkKey`, which drops the query string — a step body
 * goes through the merge resolver per recipient, so keying on the full URL
 * would mint one row per PERSON and turn the aggregate into the
 * per-recipient list it exists to summarise. Capped at
 * `CAMPAIGN_LINK_ROLLUP_MAX` for the same reason the campaign rollup is: it
 * is one document with a size ceiling. Past the cap a click is counted in
 * `overflowClicks` rather than dropped, so the table still reconciles.
 */
async function bumpLinkRollup(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; sequenceId: string; url: string },
): Promise<void> {
  if (!input.sequenceId) return
  const key = campaignLinkKey(input.url)
  const ref = outreachOrgCollection(firestore, input.orgId, 'sequences')
    .doc(input.sequenceId)
    .collection(OUTREACH_LINK_ROLLUP_PATH[0])
    .doc(OUTREACH_LINK_ROLLUP_PATH[1])
  if (!key) {
    await ref
      .set({ unattributedClicks: FieldValue.increment(1) }, { merge: true })
      .catch(() => undefined)
    return
  }
  try {
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const links = (snapshot.exists ? snapshot.data()?.['links'] : null) as
        | Record<string, { url?: string; clicks?: number }>
        | undefined
      const held = links?.[campaignRollupField(key)]
      if (!held && Object.keys(links ?? {}).length >= CAMPAIGN_LINK_ROLLUP_MAX) {
        transaction.set(ref, { overflowClicks: FieldValue.increment(1) }, { merge: true })
        return
      }
      transaction.set(
        ref,
        {
          links: {
            [campaignRollupField(key)]: {
              url: key,
              clicks: (Number(held?.clicks) || 0) + 1,
            },
          },
        },
        { merge: true },
      )
    })
  } catch (error) {
    console.warn('[outreach] a click could not be added to the link rollup', error)
  }
}

/**
 * The map key one destination is held under.
 *
 * A Firestore map key may not contain `/`, `.` or `~`, and a URL contains
 * all three, so the URL itself cannot be the key. It is base64url of the
 * key, with the readable form kept in the row's own `url` — which is what
 * the report renders, so nothing downstream ever decodes this.
 */
function campaignRollupField(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url')
}

/**
 * A person's FIRST click on a sequence's link, on their record.
 *
 * Only the first. A note per click would bury the contact's timeline under
 * the same fact repeated, and the one a rep is reading for is that this
 * person went from ignoring the mail to acting on it.
 */
async function fileFirstClick(
  deps: Pick<OutreachRuntimeDeps, 'timeline'>,
  input: { orgId: string; enrollment: OutreachEnrollment; url: string; nowMs: number },
): Promise<void> {
  const writer = deps.timeline()
  if (!writer) return
  try {
    const written = await writer.logActivity({
      orgId: input.orgId,
      hostId: input.enrollment.hostId,
      link: outreachEnrollmentLink(input.enrollment),
      sourcePluginId: OUTREACH_PLUGIN_ID,
      kind: 'note',
      atMs: input.nowMs,
      body: `Followed a link in a sequence email: ${campaignLinkKey(input.url) ?? input.url}`,
      byUid: '',
      byName: null,
    })
    if (written.ok === false) {
      console.warn(`[outreach] the record system did not file a click: ${written.error}`)
    }
  } catch (error) {
    console.error('[outreach] filing a click on the record failed', error)
  }
}
