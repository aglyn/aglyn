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

import type { OutreachMailboxStatus, OutreachSequence } from '../model/outreach.types'

/*==========================================
 * MAILBOX ROTATION (AGL-3489).
 *
 * A sequence sends from its own mailbox and, when it names more, from those
 * too: each person enrolled is given ONE of them, and every step of theirs —
 * the first email and each follow-up in its thread — goes from that one.
 * Several cold-email inboxes can so share one sequence, each sending its own
 * daily cap in its own window, pausing itself on its own bounces.
 *
 * A new enrollment goes to the connected mailbox with the fewest active
 * enrollments, the earliest in the sequence's order when two are level. The
 * count is the mailbox's across every sequence, since it is the mailbox's
 * day the enrollments share. A mailbox that is paused, waiting to be
 * reconnected or disconnected is passed over; when none of the rotation is
 * connected, the person goes to the sequence's own mailbox, to wait there as
 * they always have.
 *==========================================*/

/** The most mailboxes one sequence sends from, its own included. */
export const OUTREACH_SEQUENCE_MAX_MAILBOXES = 20

/**
 * The mailboxes a sequence sends from: its own first, then the ones it
 * rotates through, each once, `''` dropped.
 */
export function outreachSequenceMailboxIds(
  sequence: Pick<OutreachSequence, 'mailboxId'> & { mailboxIds?: readonly string[] | null },
): string[] {
  const ids: string[] = []
  for (const id of [sequence.mailboxId, ...(sequence.mailboxIds ?? [])]) {
    const clean = String(id ?? '').trim()
    if (clean && !ids.includes(clean)) ids.push(clean)
  }
  return ids.slice(0, OUTREACH_SEQUENCE_MAX_MAILBOXES)
}

/** One mailbox of a rotation, as the enroll door read it. */
export interface OutreachRotationCandidate {
  id: string
  status: OutreachMailboxStatus
  /** Active enrollments on it now, across every sequence. */
  activeEnrollments: number
  /** Whether the sequence's hours ever open in the mailbox's timezone. */
  schedulable: boolean
}

/**
 * Assigns mailboxes to new enrollments one at a time, each call the next
 * person's, counting the ones it has handed out. `null` when no candidate
 * is connected and schedulable — the caller then uses the sequence's own.
 */
export function createOutreachMailboxRotation(
  candidates: readonly OutreachRotationCandidate[],
): () => string | null {
  const open = candidates
    .map((candidate, order) => ({ ...candidate, order, load: Math.max(0, candidate.activeEnrollments || 0) }))
    .filter((candidate) => candidate.status === 'connected' && candidate.schedulable)
  return () => {
    let best: (typeof open)[number] | null = null
    for (const candidate of open) {
      if (!best || candidate.load < best.load || (candidate.load === best.load && candidate.order < best.order)) {
        best = candidate
      }
    }
    if (!best) return null
    best.load += 1
    return best.id
  }
}
