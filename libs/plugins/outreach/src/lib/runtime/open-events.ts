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
import { outreachOpenSourceOf, type OutreachOpenSource } from '../engine/open-source'
import {
  judgeOutreachOpen,
  outreachOpenAgentEvidence,
  OUTREACH_PROXY_OPEN_REASONS,
  type OutreachOpenJudgement,
} from '../engine/open-tracking'
import { outreachLoggedEngagementRows, readOutreachEngagement } from '../model/enrollment-engagement'
import { outreachHistoryEntryId, outreachOpenHistoryRow } from '../model/enrollment-history'
import {
  OUTREACH_ENROLLMENT_HISTORY,
  OUTREACH_ENROLLMENT_HISTORY_MAX,
  type OutreachEnrollment,
  type OutreachEnrollmentEngagement,
} from '../model/outreach.types'
import { outreachOrgCollection, readStoredOutreachEnrollment } from '../storage/outreach-records'
import { outreachStepSentAtMs } from './click-events'
import type { OutreachOpenTarget } from './click-link'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * RECORDING AN OPEN (AGL-3395).
 *
 * A fetch of a tracking image, written in the places a click is
 * (`./click-events.ts`) and for the same questions: the enrollment ("did
 * this person open it?"), its history ("when, and was it them?") and the
 * sequence ("what is its open rate?"). There is no per-destination rollup —
 * an image has no destination — and nothing is filed on the person's CRM
 * record: an open is too weak a signal to put in front of a rep as an act,
 * and a proxy's fetch would put one there for nobody.
 *
 * Every write happens after the image has been answered, and a failure costs
 * a number rather than a broken image.
 */

/** What one recorded open turned out to be. */
export interface OutreachOpenOutcome extends OutreachOpenJudgement {
  /** The network the fetch came from (AGL-3488); `null` when no address was read. */
  source: OutreachOpenSource | null
  /** Whether it was this person's first human open — the sequence's `uniqueOpens`. */
  first: boolean
  /** The enrollment it was recorded against, or `null` when there is none. */
  enrollment: OutreachEnrollment | null
}

const nothing = (): OutreachOpenOutcome => ({
  human: false,
  machineReason: null,
  source: null,
  first: false,
  enrollment: null,
})

/**
 * Records one fetch of a tracking image.
 *
 * In a transaction over the enrollment, as a click is: two fetches at once
 * must not both read `opens` of nought, and whether this is the person's
 * FIRST open is decided from the read that writes it. An enrollment that no
 * longer exists belongs to a person or a workspace already erased, and
 * nothing is recorded for them anywhere.
 */
export async function recordOutreachOpen(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'now'>,
  input: {
    target: OutreachOpenTarget
    method: string
    userAgent: string | null | undefined
    /**
     * The fetch's address (AGL-3488), read for the network it belongs to and
     * dropped: the row keeps the network, never the address.
     */
    address?: string | null
  },
): Promise<OutreachOpenOutcome> {
  // A test's image (AGL-3325) names no enrollment and counts on nothing.
  if (input.target.test) return nothing()
  const firestore = deps.firestore()
  const { orgId, enrollmentId, stepIndex } = input.target
  const nowMs = deps.now()
  const source = outreachOpenSourceOf(input.address)
  const ref = outreachOrgCollection(firestore, orgId, 'enrollments').doc(enrollmentId)

  const outcome = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const enrollment = readStoredOutreachEnrollment(enrollmentId, snapshot.exists ? snapshot.data() : undefined)
    if (!enrollment) return nothing()
    const sent = outreachStepSentAtMs(enrollment, stepIndex)
    const judgement = judgeOutreachOpen({
      method: input.method,
      userAgent: input.userAgent,
      sinceSentMs: sent === null ? null : nowMs - sent,
      source,
    })
    const held = readOutreachEngagement(enrollment.engagement)
    const first = judgement.human && held.firstOpenAtMs === null
    const logged = outreachLoggedEngagementRows(held) < OUTREACH_ENROLLMENT_HISTORY_MAX
    const engagement: OutreachEnrollmentEngagement = judgement.human
      ? {
          ...held,
          opens: held.opens + 1,
          firstOpenAtMs: held.firstOpenAtMs ?? nowMs,
          lastOpenAtMs: nowMs,
          loggedOpens: held.loggedOpens + (logged ? 1 : 0),
        }
      : {
          ...held,
          machineOpens: held.machineOpens + 1,
          loggedOpens: held.loggedOpens + (logged ? 1 : 0),
        }
    // `updatedAtMs` is left alone, as a click leaves it: a proxy fetching an
    // image is not something that happened to the enrollment.
    transaction.update(ref, { engagement })
    if (logged) {
      transaction.set(
        ref.collection(OUTREACH_ENROLLMENT_HISTORY).doc(outreachHistoryEntryId(nowMs)),
        outreachOpenHistoryRow({
          atMs: nowMs,
          stepIndex,
          human: judgement.human,
          machineReason: judgement.machineReason,
          userAgent: outreachOpenAgentEvidence(input.userAgent),
          source,
        }),
      )
    }
    return { ...judgement, source, first, enrollment: { ...enrollment, engagement } } as OutreachOpenOutcome
  })

  if (outcome.enrollment?.sequenceId) {
    await bumpSequenceOpenStats(firestore, outcome, { orgId, sequenceId: outcome.enrollment.sequenceId, nowMs })
  }
  return outcome
}

/**
 * The sequence's open counters: blind increments outside the enrollment's
 * transaction, for the reason the click counters are — one sequence holds
 * every recipient, and a transaction over it would serialise them all.
 */
async function bumpSequenceOpenStats(
  firestore: FirebaseFirestore.Firestore,
  outcome: OutreachOpenOutcome,
  input: { orgId: string; sequenceId: string; nowMs: number },
): Promise<void> {
  const proxy = outcome.machineReason !== null && OUTREACH_PROXY_OPEN_REASONS.includes(outcome.machineReason)
  const patch: Record<string, unknown> = outcome.human
    ? {
        'stats.opens': FieldValue.increment(1),
        'stats.lastOpenAtMs': input.nowMs,
        ...(outcome.first ? { 'stats.uniqueOpens': FieldValue.increment(1) } : {}),
      }
    : {
        'stats.machineOpens': FieldValue.increment(1),
        ...(proxy ? { 'stats.proxyOpens': FieldValue.increment(1) } : {}),
      }
  await outreachOrgCollection(firestore, input.orgId, 'sequences')
    .doc(input.sequenceId)
    .update(patch)
    .catch((error: unknown) => {
      // A sequence deleted while its mail is still out there: the open is
      // on the enrollment, and the aggregate has nowhere to go.
      console.warn('[outreach] an open could not be counted on its sequence', error)
    })
}
