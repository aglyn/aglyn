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
 * The notifications feed's cursor and mark-all logic (AGL-3720), over an
 * in-memory feed that answers `where read == false`, `orderBy createdAt
 * desc`, `startAfter` and `limit` the way Firestore does.
 */

import {
  applyLiveHead,
  fetchFeedPage,
  isNearScrollEnd,
  isNotificationRead,
  markAllNotificationsRead,
  MARK_ALL_CHUNK,
  shouldLoadMore,
  type FeedEntry,
} from './notification-feed'

interface Row extends FeedEntry {
  createdAt: { toMillis: () => number }
}

const row = (n: number, read = false): Row => ({
  $id: `n-${String(n).padStart(4, '0')}`,
  read,
  readAt: read ? { seconds: n } : null,
  createdAt: { toMillis: () => n * 1000 },
})

/** n-0001 … n-<count>, newest = highest. */
const feedOf = (count: number, read = false) =>
  Array.from({ length: count }, (_, i) => row(i + 1, read))

/** Firestore's answer: unread, newest first, after the cursor row, limited. */
function unreadQuery(store: Row[]) {
  const reads: Array<{ cursor: string | null; limit: number }> = []
  const fetch = async (cursor: Row | null, size: number) => {
    reads.push({ cursor: cursor?.$id ?? null, limit: size })
    const ordered = store
      .filter((entry) => entry.read === false)
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
    const after = cursor
      ? ordered.filter((entry) => entry.createdAt.toMillis() < cursor.createdAt.toMillis())
      : ordered
    return after.slice(0, size)
  }
  return { reads, fetch }
}

describe('isNotificationRead', () => {
  it('reads `read` first, so a pending server timestamp (null readAt) is still read', () => {
    expect(isNotificationRead({ read: true, readAt: null })).toBe(true)
  })
  it('falls back to readAt for a row written before `read` existed', () => {
    expect(isNotificationRead({ readAt: { seconds: 1 } })).toBe(true)
    expect(isNotificationRead({ read: false, readAt: null })).toBe(false)
    expect(isNotificationRead(undefined)).toBe(false)
  })
})

describe('fetchFeedPage — a real cursor, not a window', () => {
  it('pages 27 unread as 20 + 7, each read resuming after the last row', async () => {
    const store = feedOf(27)
    const { reads, fetch } = unreadQuery(store)
    const pager = (cursor: Row | null, size: number) =>
      fetch(cursor, size).then((rows) => rows.map((entry) => ({ entry, cursor: entry })))

    const first = await fetchFeedPage(pager, null, 20)
    expect(first.entries).toHaveLength(20)
    expect(first.entries[0].$id).toBe('n-0027')
    expect(first.hasMore).toBe(true)
    expect(first.cursor?.$id).toBe('n-0008')

    const second = await fetchFeedPage(pager, first.cursor, 20)
    expect(second.entries.map((entry) => entry.$id)).toEqual(
      ['n-0007', 'n-0006', 'n-0005', 'n-0004', 'n-0003', 'n-0002', 'n-0001'],
    )
    expect(second.hasMore).toBe(false)
    // One extra row asked for to learn hasMore; the second read resumed after the cursor.
    expect(reads).toEqual([
      { cursor: null, limit: 21 },
      { cursor: 'n-0008', limit: 21 },
    ])
  })

  it('resumes correctly after the cursor row itself was read', async () => {
    const store = feedOf(25)
    const { fetch } = unreadQuery(store)
    const pager = (cursor: Row | null, size: number) =>
      fetch(cursor, size).then((rows) => rows.map((entry) => ({ entry, cursor: entry })))
    const first = await fetchFeedPage(pager, null, 10)
    // Every loaded row is read, the cursor row included.
    for (const entry of first.entries) entry.read = true
    const second = await fetchFeedPage(pager, first.cursor, 10)
    expect(second.entries[0].$id).toBe('n-0015')
    expect(second.entries).toHaveLength(10)
  })

  it('keeps the cursor on an empty page', async () => {
    const page = await fetchFeedPage(async () => [], 'c-1', 20)
    expect(page).toEqual({ entries: [], cursor: 'c-1', hasMore: false })
  })
})

describe('markAllNotificationsRead — every unread, not the loaded ones', () => {
  it('marks 1,203 unread in three batches of at most 500', async () => {
    const store = feedOf(1203)
    const { fetch } = unreadQuery(store)
    const batches: number[] = []
    const marked = await markAllNotificationsRead<Row, Row>({
      fetchUnread: (cursor, size) => fetch(cursor, size).then((rows) => rows.map((entry) => ({ ref: entry, cursor: entry }))),
      commit: async (refs) => {
        batches.push(refs.length)
        for (const ref of refs) {
          ref.read = true
          ref.readAt = { seconds: 1 }
        }
      },
    })
    expect(marked).toBe(1203)
    expect(batches).toEqual([500, 500, 203])
    expect(Math.max(...batches)).toBeLessThanOrEqual(MARK_ALL_CHUNK)
    expect(store.every((entry) => entry.read)).toBe(true)
  })

  it('walks the cursor, so it is right even before a batch is acknowledged', async () => {
    const store = feedOf(30)
    const { fetch } = unreadQuery(store)
    const seen = new Set<string>()
    const marked = await markAllNotificationsRead<Row, Row>({
      fetchUnread: (cursor, size) => fetch(cursor, size).then((rows) => rows.map((entry) => ({ ref: entry, cursor: entry }))),
      // Never applied: the server has not answered.
      commit: async (refs) => {
        for (const ref of refs) seen.add(ref.$id)
      },
      chunk: 7,
    })
    expect(marked).toBe(30)
    expect(seen.size).toBe(30)
  })

  it('is idempotent: a second run writes nothing', async () => {
    const store = feedOf(12)
    const { fetch } = unreadQuery(store)
    const commit = jest.fn(async (refs: Row[]) => {
      for (const ref of refs) ref.read = true
    })
    const deps = {
      fetchUnread: (cursor: Row | null, size: number) =>
        fetch(cursor, size).then((rows) => rows.map((entry) => ({ ref: entry, cursor: entry }))),
      commit,
    }
    expect(await markAllNotificationsRead(deps)).toBe(12)
    expect(await markAllNotificationsRead(deps)).toBe(0)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('never asks for more than one batch can hold', async () => {
    const limits: number[] = []
    await markAllNotificationsRead({
      fetchUnread: async (_cursor, size) => {
        limits.push(size)
        return []
      },
      commit: async () => undefined,
      chunk: 5000,
    })
    expect(limits).toEqual([500])
  })
})

describe('applyLiveHead', () => {
  it('drops a head row that was read, keeps one pushed below a full head', () => {
    const loaded = feedOf(6).reverse() // n-6 … n-1
    const previous = new Set(['n-0006', 'n-0005', 'n-0004'])
    // A new arrival (n-7) pushes n-4 out of the 3-row head.
    const pushed = applyLiveHead(loaded, [row(7), row(6), row(5)], previous, 3)
    expect(pushed.map((entry) => entry.$id)).toContain('n-0004')
    expect(pushed[0].$id).toBe('n-0007')
    // n-5 is read elsewhere: the head refills from below with n-3.
    const read = applyLiveHead(loaded, [row(6), row(4), row(3)], previous, 3)
    expect(read.map((entry) => entry.$id)).not.toContain('n-0005')
    expect(read.map((entry) => entry.$id)).toEqual(['n-0006', 'n-0004', 'n-0003', 'n-0002', 'n-0001'])
  })

  it('drops any departed row when the head is not full', () => {
    const loaded = [row(2), row(1)]
    expect(applyLiveHead(loaded, [row(2)], new Set(['n-0002', 'n-0001']), 20)).toEqual([row(2)].map((entry) => expect.objectContaining({ $id: entry.$id })))
  })
})

describe('refill and infinite scroll', () => {
  it('reads the next page when marking rows read left the list short', () => {
    expect(shouldLoadMore({ hasMore: true, loading: false, shown: 0, pageSize: 20 })).toBe(true)
    expect(shouldLoadMore({ hasMore: true, loading: false, shown: 20, pageSize: 20 })).toBe(false)
    expect(shouldLoadMore({ hasMore: true, loading: false, shown: 20, pageSize: 20, nearEnd: true })).toBe(true)
    expect(shouldLoadMore({ hasMore: false, loading: false, shown: 0, pageSize: 20 })).toBe(false)
    expect(shouldLoadMore({ hasMore: true, loading: true, shown: 0, pageSize: 20 })).toBe(false)
  })
  it('knows when a scroll container is near its end', () => {
    expect(isNearScrollEnd({ scrollTop: 0, scrollHeight: 1000, clientHeight: 380 })).toBe(false)
    expect(isNearScrollEnd({ scrollTop: 520, scrollHeight: 1000, clientHeight: 380 })).toBe(true)
  })
})
