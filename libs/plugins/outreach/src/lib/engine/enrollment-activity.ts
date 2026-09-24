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
 * WHAT A SEQUENCE SAYS ON THE PERSON'S TIMELINE ABOUT ITSELF (AGL-3274).
 *
 * The sends and the replies were already there (AGL-2981); the two facts
 * that frame them were not. A reader of a lead's Activity saw an email go
 * out with no line saying the person had been put in a sequence, and saw
 * the sequence's last email with no line saying why there was no next one.
 * Two entries close that: "Enrolled in <sequence>" when the enroll route
 * takes the person, with the campaigns the enrollment carried them into,
 * and "<sequence> stopped" when a reply or an opt-out ends it. A bounce
 * files nothing here — the send's own entry already reads Bounced with
 * the server's words (AGL-3245), and a second line would say it twice.
 * A third entry (AGL-3324) says a member curated one step for the person,
 * and who wrote the words, so the send that follows can be read for what
 * it was.
 *
 * Pure, so the route and the runtime compose the same words and the
 * backfill (`tools/scripts/lib/enrollment-activity-backfill.mjs`) can
 * restate them and be pinned against this file. Each entry has ONE key
 * per enrollment, so a run that files again finds what it wrote.
 */

/** The author every entry the runtime files is signed with. */
export const OUTREACH_TIMELINE_BY_NAME = 'Sequences'

/** An entry as the timeline seam takes it: the caller's key, the words. */
export interface OutreachTimelineEntry {
  dedupeKey: string
  body: string
}

/** The key the enrollment's own entry is filed under, restated by the backfill. */
export function outreachEnrolledEntryKey(enrollmentId: string): string {
  return `enrolled:${enrollmentId}`
}

/**
 * "Enrolled in <sequence>", and the campaigns it carried the person into
 * when the sequence was in any, named. A sequence with no name — never
 * stored, but a document can lose one — reads "a sequence".
 */
export function outreachEnrolledEntry(input: {
  enrollmentId: string
  sequenceName: string
  campaignNames: readonly string[]
}): OutreachTimelineEntry {
  const sequence = input.sequenceName.trim() || 'a sequence'
  const campaigns = input.campaignNames.map((name) => name.trim()).filter(Boolean)
  return {
    dedupeKey: outreachEnrolledEntryKey(input.enrollmentId),
    body: campaigns.length
      ? `Enrolled in ${sequence}\nFiled under ${campaigns.join(', ')}`
      : `Enrolled in ${sequence}`,
  }
}

/**
 * The key one curated step's entry is filed under (AGL-3324): once per
 * confirmation, so a step curated again after a reply files again — each is
 * a fact about what went out, and a second line is a second fact.
 */
export function outreachCuratedEntryKey(enrollmentId: string, stepIndex: number, atMs: number): string {
  return `curated:${enrollmentId}:${stepIndex}:${atMs}`
}

/**
 * "Curated step 2 — AI draft, edited by Casey" (AGL-3324): who wrote this
 * person's copy of the step. An AI draft the member kept as it came reads
 * "AI draft, confirmed by"; words the member wrote themselves read "written
 * by". A member with no name is named by their address, and one with
 * neither is "a member".
 */
export function outreachCuratedEntry(input: {
  enrollmentId: string
  stepIndex: number
  source: 'ai' | 'member'
  edited: boolean
  memberName: string | null | undefined
  atMs: number
}): OutreachTimelineEntry {
  const member = String(input.memberName ?? '').trim() || 'a member'
  const how =
    input.source === 'ai'
      ? input.edited
        ? `AI draft, edited by ${member}`
        : `AI draft, confirmed by ${member}`
      : `written by ${member}`
  return {
    dedupeKey: outreachCuratedEntryKey(input.enrollmentId, input.stepIndex, input.atMs),
    body: `Curated step ${input.stepIndex + 1} — ${how}`,
  }
}

/** Why a sequence stopped, in the two ways a person ends one. */
export type OutreachStoppedReason = 'replied' | 'opted_out'

/** "<sequence> stopped: they replied" — the line under the last send. */
export function outreachStoppedEntry(input: {
  enrollmentId: string
  sequenceName: string
  reason: OutreachStoppedReason
}): OutreachTimelineEntry {
  const sequence = input.sequenceName.trim() || 'The sequence'
  return {
    dedupeKey: `stopped:${input.enrollmentId}`,
    body: `${sequence} stopped: ${input.reason === 'replied' ? 'they replied' : 'they opted out'}`,
  }
}
