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

/*
 * THE NOTIFICATIONS FEED'S CURSOR AND MARK-ALL LOGIC (AGL-3720), free of
 * Firestore so the specs can drive it over an in-memory feed.
 *
 * The bell's inbox read the ten newest notifications and filtered them for
 * unread on the client, so a reader with 27 unread saw the few of those ten,
 * marked them read, and was left with "No new notifications" under a badge
 * of 16: nothing ever asked Firestore for the rest. The inbox now reads
 * `read == false` newest first, page by page on a real cursor
 * (`orderBy('createdAt', 'desc')` + `startAfter(last)` + `limit`), which is
 * the same query the badge counts, so the list and the count answer the same
 * question.
 */

/** The shape every helper here needs from a notification. */
export interface FeedEntry {
  $id: string
  read?: boolean
  readAt?: unknown
  createdAt?: unknown
}

/**
 * Whether a notification has been read.
 *
 * `read` FIRST, then `readAt`. Marking read writes `read: true` beside
 * `readAt: serverTimestamp()`, and until the server acknowledges the write a
 * pending server timestamp reads back as `null` — so a row keyed on `readAt`
 * alone stayed "New" after the first press of Mark read and only turned on
 * the second, once the first write had landed (AGL-3720). `read` is a plain
 * boolean the cache answers at once.
 */
export function isNotificationRead(entry: Pick<FeedEntry, 'read' | 'readAt'> | null | undefined): boolean {
  return entry?.read === true || Boolean(entry?.readAt)
}

/** Milliseconds since the epoch for a Firestore-ish timestamp, or 0. */
export function entryTime(entry: Pick<FeedEntry, 'createdAt'>): number {
  const value = entry.createdAt as
    | { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    | null
    | undefined
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return 0
}

/** Newest first, ties broken by id descending — the query's own order. */
export function compareFeedEntries(a: FeedEntry, b: FeedEntry): number {
  const delta = entryTime(b) - entryTime(a)
  if (delta !== 0) return delta
  return a.$id < b.$id ? 1 : a.$id > b.$id ? -1 : 0
}

/** Merge entries into a feed: one row per id (the newer copy wins), in order. */
export function mergeFeedEntries<T extends FeedEntry>(current: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const entry of current) byId.set(entry.$id, entry)
  for (const entry of incoming) byId.set(entry.$id, entry)
  return [...byId.values()].sort(compareFeedEntries)
}

/**
 * One page read on the cursor: `limit` rows after `cursor` (or from the top
 * when it is null). The caller asks for one more than it shows, so the
 * extra row says whether a further page exists without a read of its own.
 */
export type FeedPageFetcher<T, C> = (cursor: C | null, limit: number) => Promise<Array<{ entry: T; cursor: C }>>

export interface FeedPage<T, C> {
  entries: T[]
  /** Where the next page resumes; unchanged when the page was empty. */
  cursor: C | null
  hasMore: boolean
}

/** Read the page after `cursor`: `pageSize` rows, and whether more follow. */
export async function fetchFeedPage<T, C>(
  fetch: FeedPageFetcher<T, C>,
  cursor: C | null,
  pageSize: number,
): Promise<FeedPage<T, C>> {
  const rows = await fetch(cursor, pageSize + 1)
  const page = rows.slice(0, pageSize)
  const last = page[page.length - 1]
  return {
    entries: page.map((row) => row.entry),
    cursor: last ? last.cursor : cursor,
    hasMore: rows.length > pageSize,
  }
}

/**
 * Fold a fresh snapshot of the feed's LIVE HEAD (its first `headLimit` rows)
 * into the rows already loaded.
 *
 * Every head row is taken as the truth. A row that WAS in the previous head
 * and is not in this one left for one of two reasons:
 *  - it stopped matching (it was read, or deleted): drop it;
 *  - newer rows pushed it below a full head: keep it, it is still unread.
 * The second is told apart by position: a pushed-out row is older than every
 * row the full head now holds, while a row that left the query is replaced
 * from BELOW, so something in the new head is older than it.
 */
export function applyLiveHead<T extends FeedEntry>(
  current: readonly T[],
  head: readonly T[],
  previousHeadIds: ReadonlySet<string>,
  headLimit: number,
): T[] {
  const headIds = new Set(head.map((entry) => entry.$id))
  const oldestHead = head.length ? Math.min(...head.map(entryTime)) : Infinity
  const kept = current.filter((entry) => {
    if (headIds.has(entry.$id)) return false
    if (!previousHeadIds.has(entry.$id)) return true
    if (head.length < headLimit) return false
    return entryTime(entry) < oldestHead
  })
  return mergeFeedEntries(kept, head)
}

/** Firestore's cap on the writes one batch may hold. */
export const MARK_ALL_CHUNK = 500

export interface MarkAllDeps<R, C> {
  /** Up to `limit` UNREAD notifications after `cursor`, newest first. */
  fetchUnread: (cursor: C | null, limit: number) => Promise<Array<{ ref: R; cursor: C }>>
  /** Write `read: true` + `readAt` to every ref, as one batch. */
  commit: (refs: R[]) => Promise<void>
  chunk?: number
}

/**
 * Mark EVERY unread notification read, not only the ones on screen
 * (AGL-3720).
 *
 * The unread query is walked on its cursor in chunks of at most 500 — one
 * batch's cap — so a reader with 1,200 unread gets three batches and none
 * left behind. Paging on the cursor rather than re-reading the top keeps the
 * walk correct even before a batch is acknowledged. Idempotent: a row
 * already read is not in the unread query, so a second run writes nothing.
 *
 * @returns how many notifications were marked.
 */
export async function markAllNotificationsRead<R, C>(deps: MarkAllDeps<R, C>): Promise<number> {
  const chunk = Math.min(deps.chunk ?? MARK_ALL_CHUNK, MARK_ALL_CHUNK)
  let cursor: C | null = null
  let total = 0
  for (;;) {
    const rows = await deps.fetchUnread(cursor, chunk)
    if (rows.length === 0) break
    await deps.commit(rows.map((row) => row.ref))
    total += rows.length
    if (rows.length < chunk) break
    cursor = rows[rows.length - 1].cursor
  }
  return total
}

/**
 * Whether the list should read its next page now: it is near its end, or
 * marking rows read has left it shorter than a page while more wait on the
 * cursor — the refill that never happened, leaving an empty inbox over a
 * badge that still counted the rest.
 */
export function shouldLoadMore(state: {
  hasMore: boolean
  loading: boolean
  shown: number
  pageSize: number
  nearEnd?: boolean
}): boolean {
  if (!state.hasMore || state.loading) return false
  return Boolean(state.nearEnd) || state.shown < state.pageSize
}

/** Pixels from the bottom at which a scrolling list asks for its next page. */
export const LOAD_MORE_THRESHOLD_PX = 120

/** Whether a scroll container is within the threshold of its end. */
export function isNearScrollEnd(element: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= LOAD_MORE_THRESHOLD_PX
}
