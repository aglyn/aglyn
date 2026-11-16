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
 * Which invitation is the newest, for the one place that has to choose
 * between several: a person who signs up with two invitations waiting lands
 * in ONE workspace, and it is the one they were invited to most recently
 * (AGL-4047). Shared by `GET /api/orgs/invites?mine=1`, which answers newest
 * first, and the console's automatic join, which opens only the newest.
 */

/** The fields the ordering reads. */
export interface DatedInvite {
  $id: string
  /** When the invitation was sent, in ms; absent from an older answer. */
  createdAtMs?: number | null
}

/**
 * A Firestore `Timestamp` (or anything with `toMillis`) as milliseconds, or
 * `null` for an invitation whose server timestamp has not resolved.
 */
export function inviteSentAtMs(value: unknown): number | null {
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  if (typeof toMillis !== 'function') return null
  const ms = Number(toMillis.call(value))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Newest first. Undated invitations keep their order after every dated one,
 * so an answer without dates reads exactly as it did before.
 */
export function newestInvitesFirst<T extends DatedInvite>(
  invites: readonly T[],
): T[] {
  return invites
    .map((invite, index) => ({ invite, index }))
    .sort((a, b) => {
      const aMs = a.invite.createdAtMs ?? null
      const bMs = b.invite.createdAtMs ?? null
      if (aMs !== null && bMs !== null && aMs !== bMs) return bMs - aMs
      if (aMs === null && bMs !== null) return 1
      if (aMs !== null && bMs === null) return -1
      return a.index - b.index
    })
    .map(({ invite }) => invite)
}

/** The newest invitation, or null for none. */
export function latestInvite<T extends DatedInvite>(
  invites: readonly T[],
): T | null {
  return newestInvitesFirst(invites)[0] ?? null
}
