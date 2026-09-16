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

// Straight from the SDK, not the admin barrel, for the reason `assist-usage.ts`
// gives at its head: the statics need no app, and the barrel would drag the
// default-app initialization into every unit test that touches a counter.
import { FieldValue } from 'firebase-admin/firestore'
import type { AiRefusedBy } from '../model/ai-allotments'

/**
 * THE PER-ORG REFUSAL COUNTER (AGL-2930).
 *
 * `reserveAssistMessage` refuses for four reasons and, until now, recorded
 * none of them: a refusal moved no counter by design, so the month document
 * could say how much an org spent and nothing about how often it was turned
 * away. Staff monitoring needs the second figure — a workspace refused at its
 * band forty times this month is a sales conversation, and one refused at the
 * operator's backstop is an incident — and neither is derivable from spend.
 *
 * The count lives on the SAME document the spend does, as a map:
 *
 *   orgs/{orgId}/assistUsage/{YYYY-MM}.refusals.{reason}
 *
 * with `reason` one of the four `AssistRefusedBy` values. A map rather than
 * four top-level fields so a reader can take the whole thing in one `get`,
 * and so a fifth reason lands without a schema change.
 *
 * ## Fire-and-forget, and never throws
 *
 * The write is deliberately OUTSIDE the reservation transaction and off its
 * await path. A refusal is the cheap, no-token exit of the gate, and a
 * counter that could fail the refusal — or slow it, or retry the transaction
 * it was called from — would make the observation more expensive than the
 * thing observed. So this returns synchronously, swallows every error
 * including a double that has no `set`, and the only cost of a lost increment
 * is an undercount on a staff card.
 */

/** A reason that actually refused — the `null` (admitted) case has no count. */
export type AssistRefusalReason = NonNullable<AiRefusedBy>

/**
 * Every reason, in the order the card and the leaderboard list them: the
 * workspace's own four first, then an allotment a manager set (AGL-2942),
 * then the Free taste's (AGL-2925), which only a Free workspace can be
 * refused by.
 */
export const ASSIST_REFUSAL_REASONS: readonly AssistRefusalReason[] = [
  'band',
  'cap',
  'messages',
  'budget',
  'allotment',
  'account',
  'requests',
  'refusals',
  'platform',
]

export function recordAssistRefusal(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
  reason: AssistRefusalReason,
): void {
  try {
    const ref = firestore
      .collection('orgs')
      .doc(orgId)
      .collection('assistUsage')
      .doc(month)
    // `set(…, { merge: true })`, never `update()`: the month document does
    // not exist before the org's first admitted message, and a refusal can
    // come first — a Free workspace at its daily cap on a fresh month.
    void Promise.resolve(
      ref.set(
        { month, refusals: { [reason]: FieldValue.increment(1) } },
        { merge: true },
      ),
    ).catch(() => undefined)
  } catch {
    // A double without `set`, a ref that could not be built — the refusal
    // has already been decided and this must not change that.
  }
}

/** Every reason's count, zero-filled, as the card and the leaderboard read them. */
export type AssistRefusalCounts = Record<AssistRefusalReason, number> & {
  total: number
}

/**
 * The `refusals` map off a month document as a complete, zero-filled record.
 *
 * Zero-filled rather than sparse because the readers render every reason:
 * "band 0" beside "cap 12" is the finding, and a sparse map would make the
 * reader guess whether an absent key meant none or not yet counted. A
 * non-numeric or negative value reads as 0 — the counter is only ever
 * incremented, so anything else is a hand edit.
 */
export function assistRefusalCounts(raw: unknown): AssistRefusalCounts {
  const map = (raw ?? {}) as Record<string, unknown>
  const counts = Object.fromEntries(
    ASSIST_REFUSAL_REASONS.map((reason) => {
      const value = Number(map[reason] ?? 0)
      return [reason, Number.isFinite(value) && value > 0 ? Math.floor(value) : 0]
    }),
  ) as Record<AssistRefusalReason, number>
  return {
    ...counts,
    total: ASSIST_REFUSAL_REASONS.reduce((sum, reason) => sum + counts[reason], 0),
  }
}
