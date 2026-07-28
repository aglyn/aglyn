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
'use client'

/**
 * Re-fan a host's `users/{uid}/hostMemberships` rows after a CLIENT write to
 * the host doc (AGL-844, AGL-1071).
 *
 * The projection is Admin-SDK-maintained beside `memberRoles`, so anything
 * written straight from the console — `displayName`, `seo.favicon` — bypasses
 * the funnel that would normally update it, and the site switcher goes stale
 * while the sites list (which reads real host docs) looks fine. That
 * disagreement is the whole of AGL-1071.
 *
 * Deliberately fire-and-forget. A miss self-heals on the next membership
 * change or backfill, and the alternative — blocking a Save on a projection
 * refresh, or surfacing an error for a cosmetic mirror — costs the user more
 * than a briefly stale icon does.
 *
 * Centralised because this is the third caller: the setup page copied it for
 * `displayName`, the favicon card needs it for both set AND clear, and the
 * next denormalized field will need it too. A copy-pasted `fetch` is how one
 * of these paths ends up quietly missing the header.
 */
export function resyncHostMemberships(
  hostId: string,
  user: { getIdToken?: () => Promise<string> } | null | undefined,
): void {
  void (async () => {
    try {
      const idToken = await user?.getIdToken?.()
      await fetch('/api/hosts/sync-memberships', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId }),
      })
    } catch {
      // Swallowed on purpose — see the fire-and-forget note above.
    }
  })()
}

export default resyncHostMemberships
