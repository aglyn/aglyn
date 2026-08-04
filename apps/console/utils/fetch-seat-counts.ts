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

/** What the org roster totals to, counted server-side. */
export interface SeatCounts {
  /** Manager seats — owners, admins and any org-wide member (AGL-1113). */
  managerSeats: number
  /** Every roster row, managers and site-scoped collaborators alike. */
  memberCount: number
}

/**
 * Seat totals for an org, from the server (AGL-1253/AGL-1255).
 *
 * Four surfaces counted seats by listing `orgs/{orgId}/members` from the
 * client. That list is evaluated against the QUERY, so the rule's
 * `memberUid == request.auth.uid` clause can never satisfy it — it resolves
 * only through `isStaff()` or the rules' `isOrgWideMember()`, and the CLIENT's
 * predicate of the same name disagrees about legacy member docs. So the read
 * was denied for readers every one of those surfaces had already decided was
 * org-wide. Measured on production 2026-08-04.
 *
 * Shared rather than repeated because the four call sites had already drifted:
 * two counted managers, one counted every member against a MANAGER limit, and
 * they disagreed about what a failure means. A fifth caller should not get to
 * invent a fifth answer.
 *
 * **Returns `null` when the count cannot be had, and never a number.** Every
 * caller here feeds a limit comparison, and the failure that matters is the
 * reassuring one: `catch(() => 0)` on the downgrade check reported "0 team
 * members", which is under every plan's limit, so the warning that a downgrade
 * would strand the org simply did not appear. A count nobody could read is not
 * zero.
 */
export async function fetchSeatCounts(
  user: { getIdToken?: () => Promise<string> } | undefined | null,
  orgId: string | undefined | null,
): Promise<SeatCounts | null> {
  if (!orgId) return null
  try {
    const idToken = await user?.getIdToken?.()
    if (!idToken) return null
    const response = await fetch(
      `/api/orgs/members?orgId=${encodeURIComponent(orgId)}&counts=1`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    )
    if (!response.ok) return null
    const payload = (await response.json().catch(() => null)) as {
      managerSeats?: unknown
      memberCount?: unknown
    } | null
    const managerSeats = Number(payload?.managerSeats)
    const memberCount = Number(payload?.memberCount)
    if (!Number.isFinite(managerSeats) || !Number.isFinite(memberCount)) {
      return null
    }
    return { managerSeats, memberCount }
  } catch {
    return null
  }
}

export default fetchSeatCounts
