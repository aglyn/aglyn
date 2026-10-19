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

/*==========================================
 * EVERY SITE IMPORT IS LOGGED FOR TRUST & SAFETY (AGL-3976).
 *
 * A site import is a one-click copy of a website, which is exactly what a
 * phishing clone is. Proving ownership is the control; this row is how a
 * person checks the control held. Every import job files ONE row in the
 * abuse queue (`abuseReports`), in the shape the outbound screen files a
 * hold (`fileOutboundHold`): the same fields the admin page and the daily
 * review already read, `source: 'site-import'`, the proved domain as text
 * (the queue never renders a reported address as a link), and the proof.
 *
 * The row is written when the site is read and rewritten as each wave
 * starts and finishes, its `reportCount` counting the waves, so the queue
 * shows one import as one row however long it runs. It holds nothing: the
 * import goes on while the row is open. Staff look at the old site and the
 * new one; a workspace bringing in a site that is not its own is locked,
 * and the row closed with what was done.
 *
 * Never throws: a log that cannot be written must not stop a person's
 * import, and the failure is a log line staff alerts read.
 *=========================================*/

import { ABUSE_REPORT_COLLECTION, ABUSE_REPORT_MAX_DETAILS } from '@aglyn/aglyn/app-utils/abuse-report'
import { FieldValue } from 'firebase-admin/firestore'
import {
  AI_SITE_IMPORT_LEFT_OUT_REASONS,
  aiSiteImportPagesText,
  type AiSiteImportState,
} from '../model/ai-site-import'
import type { AiJobItemLedger } from '../model/ai-jobs.types'

/** The abuse queue's `source` for a site import's row. */
export const SITE_IMPORT_REVIEW_SOURCE = 'site-import'

/** One row per import job. */
export function siteImportReviewId(jobId: string): string {
  return `site-import-${jobId}`
}

/** The reference staff quote: `SI-` and the job's id. */
export function siteImportReviewReference(jobId: string): string {
  return `SI-${jobId.slice(0, 10).toUpperCase()}`
}

const PROOF_WORDS: Record<string, string> = {
  dns: 'a DNS TXT record',
  meta: 'a meta tag on its home page',
  email: 'a code emailed to an address at the domain',
}

export type SiteImportReviewEvent = 'read' | 'wave-started' | 'wave-finished'

export interface SiteImportReviewInput {
  orgId: string
  hostId: string
  jobId: string
  state: AiSiteImportState
  items: readonly AiJobItemLedger[]
  event: SiteImportReviewEvent
  /** The wave the event is about; absent on `read`. */
  wave?: number
  nowMs: number
}

/** The row's details: what was proved, read, kept, left out and brought in, rebuilt whole each time. */
export function siteImportReviewDetails(input: SiteImportReviewInput): string {
  const { state, items } = input
  const proof = state.ownership.method ? (PROOF_WORDS[state.ownership.method] ?? state.ownership.method) : 'an unknown method'
  const provenOn = state.ownership.provenAt ? new Date(state.ownership.provenAt).toISOString().slice(0, 10) : 'an unknown day'
  const leftOut = AI_SITE_IMPORT_LEFT_OUT_REASONS.filter((reason) => (state.leftOutCount[reason] ?? 0) > 0)
    .map((reason) => `${reason} ${state.leftOutCount[reason]}`)
    .join(', ')
  const built = items.filter((row) => row.op === 'page' && (row.status === 'succeeded' || row.status === 'degraded')).length
  const started = state.waves.filter((wave) => wave.status !== 'waiting').length
  const photos = state.pages.reduce((total, page) => total + (page.photos?.brought ?? 0), 0)
  const lines = [
    `Site import: ${state.domain} into site ${input.hostId} (AI job ${input.jobId}).`,
    `Ownership proven by ${proof}${state.ownership.detail ? ` (${state.ownership.detail})` : ''} on ${provenOn}.`,
    `Read ${aiSiteImportPagesText(state.found)}; bringing in ${aiSiteImportPagesText(state.pages.length)} in ${state.waves.length} ${state.waves.length === 1 ? 'wave' : 'waves'}` +
      `${state.pageLimit === null ? '' : ` (plan page count ${state.pageLimit}, ${state.existingPages} already on the site)`}.`,
    ...(leftOut ? [`Left out: ${leftOut}.`] : []),
    ...((state.leftOutCount['login-form'] ?? 0) > 0
      ? [`Sign-in pages refused: ${state.leftOutCount['login-form']}. A site with sign-in pages is worth a closer look.`]
      : []),
    `Waves started: ${started} of ${state.waves.length}. Pages brought in so far: ${built}. Photos copied into the media library: ${photos}.`,
    'Nothing is published by the import: its pages are drafts until a member publishes them.',
    'Look at the old site and the new one. If this copies a site the workspace does not own, lock the workspace, then close this row with what you did; otherwise dismiss it.',
  ]
  return lines.join('\n').slice(0, ABUSE_REPORT_MAX_DETAILS)
}

/** Writes (or rewrites) the import's row in the abuse queue. Never throws. */
export async function fileSiteImportReview(
  firestore: FirebaseFirestore.Firestore,
  input: SiteImportReviewInput,
): Promise<string | null> {
  const reviewId = siteImportReviewId(input.jobId)
  try {
    const ref = firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
    const first = !(await ref.get()).exists
    const built = input.items.filter((row) => row.op === 'page' && (row.status === 'succeeded' || row.status === 'degraded')).length
    await ref.set(
      {
        reference: siteImportReviewReference(input.jobId),
        // "Impersonation or trademark": the harm a copied site does is
        // wearing a business it is not. Normal severity: the proof already
        // held, and this row is the check that it did.
        category: 'impersonation',
        severity: 'normal',
        source: SITE_IMPORT_REVIEW_SOURCE,
        // The proved site as TEXT: the queue never renders it as a link.
        url: `https://${input.state.domain}/`,
        reportedHostname: input.state.domain,
        hostId: input.hostId,
        orgId: input.orgId,
        details: siteImportReviewDetails(input),
        reporterEmail: null,
        reporterName: null,
        dmca: null,
        // One a wave started, so a long import reads as the volume it is.
        ...(input.event === 'wave-started' ? { reportCount: FieldValue.increment(1) } : first ? { reportCount: 0 } : {}),
        siteImport: {
          jobId: input.jobId,
          domain: input.state.domain,
          method: input.state.ownership.method,
          provenAt: input.state.ownership.provenAt,
          detail: input.state.ownership.detail,
          found: input.state.found,
          kept: input.state.pages.length,
          waves: input.state.waves.length,
          wavesStarted: input.state.waves.filter((wave) => wave.status !== 'waiting').length,
          pagesBrought: built,
          loginPagesRefused: input.state.leftOutCount['login-form'] ?? 0,
          lastEvent: input.event,
          ...(input.wave !== undefined ? { lastWave: input.wave } : {}),
          atMs: input.nowMs,
        },
        updatedAt: FieldValue.serverTimestamp(),
        ...(first ? { status: 'open', createdAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    )
    return reviewId
  } catch (error) {
    console.error('[site-import] trust and safety row failed', { orgId: input.orgId, jobId: input.jobId, error })
    return null
  }
}
