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
  collection,
  count,
  getAggregateFromServer,
  query,
  where,
  type Firestore,
} from 'firebase/firestore'

/**
 * What a reason means to a merchant, and how much it should worry them.
 *
 * An ABSENT reason reads as "Unsubscribed", and that is a compatibility rule
 * rather than a guess: until AGL-2408 the unsubscribe handler wrote
 * `{ email, createdAt }` and nothing else, while the Resend webhook has
 * stamped `'bounce'`/`'complaint'` since AGL-1918 — so an entry with no reason
 * can only have come from somebody clicking the link. New unsubscribes write
 * the reason explicitly, so this fallback covers history and nothing else.
 */
export const SUPPRESSION_REASONS: Record<
  string,
  { label: string; color: 'default' | 'warning' | 'error' }
> = {
  unsubscribe: { label: 'Unsubscribed', color: 'default' },
  bounce: { label: 'Bounced', color: 'warning' },
  complaint: { label: 'Marked as spam', color: 'error' },
  /*
   * Recorded by a person, through the Add control.
   *
   * Its OWN value rather than a reuse of `unsubscribe`: an opt-out arriving
   * by reply, phone or in person is not somebody clicking a link, and the
   * difference is exactly what a merchant asked to prove the request was
   * honored has to be able to show.
   */
  manual: { label: 'Added by hand', color: 'default' },
}

/** One stored reason, as {@link SUPPRESSION_REASONS} describes it. */
export const describeSuppressionReason = (reason: unknown) =>
  SUPPRESSION_REASONS[String(reason ?? 'unsubscribe')] ?? {
    label: String(reason),
    color: 'default' as const,
  }

/** One site's suppression list, broken down by why each address is on it. */
export interface SuppressionTotals {
  unsubscribe: number
  bounce: number
  complaint: number
  manual: number
}

/**
 * THE BREAKDOWN OF ONE SITE'S SUPPRESSION LIST, as server aggregates.
 *
 * One reader for both the site's own suppression card and the organization's
 * summary of every site's, so the two can never count differently.
 *
 * Four reads, not one per reason. `where('reason','==','unsubscribe')` cannot
 * be asked, because an entry written before AGL-2408 carries no `reason` at
 * all and an equality filter excludes it — the field-presence trap the list's
 * ordering also avoids. Unsubscribes are therefore the REMAINDER: the total
 * minus every reason that is always written explicitly, which is exactly the
 * compatibility rule the card's `describeReason` applies row by row. A reason
 * counted explicitly and left out of the subtraction would be reported as
 * somebody who clicked unsubscribe.
 *
 * Rejects when any read fails; a caller holds its figure at "unknown" rather
 * than zeroing it, because "Bounced: 0" is a confident wrong number in the
 * reassuring direction.
 */
export async function readSuppressionTotals(
  firestore: Firestore,
  hostId: string,
): Promise<SuppressionTotals> {
  const suppressionsRef = collection(firestore, 'hosts', hostId, 'suppressions')
  const [all, bounced, complained, added] = await Promise.all([
    getAggregateFromServer(suppressionsRef, { total: count() }),
    getAggregateFromServer(
      query(suppressionsRef, where('reason', '==', 'bounce')),
      { total: count() },
    ),
    getAggregateFromServer(
      query(suppressionsRef, where('reason', '==', 'complaint')),
      { total: count() },
    ),
    getAggregateFromServer(
      query(suppressionsRef, where('reason', '==', 'manual')),
      { total: count() },
    ),
  ])
  const total = Number(all.data().total ?? 0)
  const bounce = Number(bounced.data().total ?? 0)
  const complaint = Number(complained.data().total ?? 0)
  const manual = Number(added.data().total ?? 0)
  return {
    unsubscribe: Math.max(0, total - bounce - complaint - manual),
    bounce,
    complaint,
    manual,
  }
}
