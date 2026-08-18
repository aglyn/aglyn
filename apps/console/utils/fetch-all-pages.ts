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
 * Follow a staff list route's cursor to the end, with a page ceiling
 * (AGL-2083).
 *
 * Three staff routes paginate and every caller outside `/admin/orgs` threw
 * the cursor away, so each list looked complete and was not:
 *
 * * `/api/admin/orgs` — `PAGE_SIZE = 25`. The email-test drawer's
 *   organization picker showed the first 25 orgs of the platform.
 * * `/api/admin/hosts` — `PAGE_SIZE = 200`, both callers truncating.
 * * `/api/admin/users` — 200 per page via a GCIP `nextPageToken`.
 *
 * The failure mode is the one that matters: nothing errors, nothing is
 * marked incomplete, and an operator who cannot find a host in the picker
 * concludes it does not exist. Which is why {@link PagedResult} reports
 * `truncated` rather than returning a bare array — a caller that hits the
 * ceiling must be able to SAY so. A helper that quietly stopped would be the
 * same bug with a shared implementation.
 *
 * Modeled on `scope-drift-card.component.tsx` (AGL-2062): bounded loop,
 * bound reported.
 */

/** Hard ceiling on pages per call, so a cursor bug cannot spin forever. */
export const MAX_PAGES = 50

export interface PagedResult<T> {
  items: T[]
  /**
   * TRUE when {@link MAX_PAGES} stopped the loop before the route said it
   * was done, or when a page failed mid-way. The caller must surface this;
   * a silently short list is the defect being fixed.
   */
  truncated: boolean
  /** Pages actually fetched — for the message when `truncated`. */
  pages: number
  /**
   * Extra array fields accumulated across pages, by
   * {@link FetchAllPagesOptions.accumulate}.
   *
   * Exists for `/api/admin/users`' `tenantTruncated`, which is a SECOND and
   * narrower kind of short list: walking `nextPageToken` to the end still
   * misses users in an SSO tenant pool that outgrew its per-tenant cap
   * *inside* a page. `auth-pools.ts` names those tenants precisely so a
   * caller can say so — `/admin/users/page.tsx` already does — and a walker
   * that dropped the field would have made this list look complete again by
   * a different route.
   */
  extras: Record<string, unknown[]>
}

export interface FetchAllPagesOptions {
  /** Base path, without any cursor param. */
  path: string
  /** Response key holding the array (`'hosts'`, `'orgs'`, `'users'`). */
  key: string
  /** Query param carrying the cursor. Firestore routes use `after`. */
  cursorParam?: string
  /** Response field carrying the next cursor. */
  cursorField?: string
  headers?: Record<string, string>
  maxPages?: number
  /** Abort check between pages, so an unmounted caller stops fetching. */
  active?: () => boolean
  /**
   * Extra ARRAY response fields to concatenate across pages, surfaced on
   * {@link PagedResult.extras}. Accumulated rather than last-write-wins
   * because such a field can appear on any page, not only the final one.
   */
  accumulate?: string[]
}

/**
 * Reads every page of a staff list route.
 *
 * Deliberately tolerant of a mid-way failure: it returns what it has with
 * `truncated: true` rather than throwing away pages already fetched. A
 * partial list the caller KNOWS is partial is strictly better than both an
 * empty list and a silently short one.
 */
export async function fetchAllPages<T = unknown>(
  options: FetchAllPagesOptions,
): Promise<PagedResult<T>> {
  const {
    path,
    key,
    cursorParam = 'after',
    cursorField = 'nextCursor',
    headers = {},
    maxPages = MAX_PAGES,
    active,
    accumulate = [],
  } = options
  const items: T[] = []
  const extras: Record<string, unknown[]> = Object.fromEntries(
    accumulate.map((key) => [key, [] as unknown[]]),
  )
  let cursor: string | null = null
  let pages = 0

  for (let page = 0; page < maxPages; page += 1) {
    if (active && !active()) return { items, truncated: true, pages, extras }
    const separator = path.includes('?') ? '&' : '?'
    const url = cursor
      ? `${path}${separator}${cursorParam}=${encodeURIComponent(cursor)}`
      : path
    let payload: Record<string, unknown>
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) return { items, truncated: true, pages, extras }
      payload = await response.json()
    } catch {
      return { items, truncated: true, pages, extras }
    }
    pages += 1
    const batch = payload?.[key]
    if (Array.isArray(batch)) items.push(...(batch as T[]))
    for (const field of accumulate) {
      const value = payload?.[field]
      if (Array.isArray(value)) extras[field].push(...value)
    }
    const next = payload?.[cursorField]
    // `hasMore` is advisory; the CURSOR is what decides. A route that
    // reports `hasMore: true` with a null cursor has nowhere to send us,
    // and looping on the flag alone would refetch page one forever.
    cursor = typeof next === 'string' && next ? next : null
    if (!cursor) return { items, truncated: false, pages, extras }
  }
  // Fell out of the loop with a cursor still in hand: the ceiling stopped
  // us, not the route.
  return { items, truncated: true, pages, extras }
}

export default fetchAllPages
