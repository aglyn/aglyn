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

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyLiveHead,
  fetchFeedPage,
  markAllNotificationsRead,
  mergeFeedEntries,
  shouldLoadMore,
  type FeedEntry,
} from '../utils/notification-feed'

/** Rows per page of the bell's inbox and archive. */
export const NOTIFICATION_FEED_PAGE_SIZE = 20

type Entry = FeedEntry & Record<string, any>

/*
 * `estimate`, so a row this client just marked read carries a readAt at
 * once instead of the `null` a pending server timestamp reads as.
 */
const toEntry = (snapshot: QueryDocumentSnapshot): Entry => ({
  $id: snapshot.id,
  ...snapshot.data({ serverTimestamps: 'estimate' }),
})

const notificationsOf = (firestore: Firestore, uid: string) =>
  collection(firestore, 'users', uid, 'notifications')

/**
 * Mark every unread notification of `uid` read (AGL-3720), walking the
 * `read == false` query newest first in batches of at most 500. The owner
 * may update their own notifications (`users/{uid}/notifications` in
 * `cloud/firebase-firestore.rules`), and the write is the same
 * `{ read: true, readAt }` a single click makes.
 */
export async function markAllNotificationsReadFor(firestore: Firestore, uid: string): Promise<number> {
  return markAllNotificationsRead<DocumentReference, QueryDocumentSnapshot>({
    fetchUnread: async (cursor, size) => {
      const snapshot = await getDocs(
        query(
          notificationsOf(firestore, uid),
          where('read', '==', false),
          orderBy('createdAt', 'desc'),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(size),
        ),
      )
      return snapshot.docs.map((entry) => ({ ref: entry.ref, cursor: entry }))
    },
    commit: async (refs) => {
      const batch = writeBatch(firestore)
      for (const ref of refs) batch.update(ref, { read: true, readAt: serverTimestamp() })
      /*
       * Not awaited (AGL-3373): `commit` resolves on the server's
       * acknowledgment, which a stalled client never delivers. The writes
       * land in the local cache at once and stay queued, and the walk pages
       * on its cursor, so it never waits on them.
       */
      void batch.commit().catch(console.error)
    },
  })
}

/** Mark one notification read: the write a row click makes. */
export function markNotificationRead(firestore: Firestore, uid: string, id: string): Promise<void> {
  return updateDoc(doc(firestore, 'users', uid, 'notifications', id), {
    read: true,
    readAt: serverTimestamp(),
  })
}

export interface UseNotificationFeedOptions {
  firestore: Firestore
  uid: string | undefined
  /** `false` = the inbox, `true` = the archive. */
  read: boolean
  /** Off while the popover is closed, so a closed bell costs no reads. */
  enabled: boolean
  pageSize?: number
}

export interface NotificationFeed {
  items: Entry[]
  hasMore: boolean
  loading: boolean
  /** Read the next page on the cursor, if one exists and none is in flight. */
  loadMore: () => void
  /** Take rows out of this feed now (they were read, for the inbox). */
  remove: (ids: readonly string[]) => void
  /** Drop everything and read the first page again. */
  reset: () => void
}

/**
 * The bell's inbox or archive (AGL-3720): `read == <read>` newest first, on
 * a real Firestore cursor — the first page live (so arrivals and rows read
 * elsewhere show at once), every page after it read with `startAfter` on the
 * last row loaded. The list refills itself when marking rows read leaves it
 * shorter than a page and more wait on the cursor.
 *
 * Index: `notifications (read ASC, createdAt DESC)`, already in
 * `cloud/firebase-firestore.indexes.json` for the feed's Status filter.
 */
export function useNotificationFeed(options: UseNotificationFeedOptions): NotificationFeed {
  const { firestore, uid, read, enabled } = options
  const pageSize = options.pageSize ?? NOTIFICATION_FEED_PAGE_SIZE
  const [items, setItems] = useState<Entry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generation, setGeneration] = useState(0)
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null)
  const loadingRef = useRef(false)
  /** Bumped on every reset, so a page from a superseded feed is dropped. */
  const epochRef = useRef(0)
  const headIdsRef = useRef<Set<string>>(new Set())
  /** Ids removed here before the server agrees; the live head must not revive them. */
  const removedRef = useRef<Set<string>>(new Set())

  const baseQuery = useCallback(
    () =>
      uid
        ? query(notificationsOf(firestore, uid), where('read', '==', read), orderBy('createdAt', 'desc'))
        : null,
    [firestore, uid, read],
  )

  const loadMore = useCallback(() => {
    const base = baseQuery()
    if (!base || !enabled || loadingRef.current) return
    const epoch = epochRef.current
    loadingRef.current = true
    setLoading(true)
    void fetchFeedPage<Entry, QueryDocumentSnapshot>(
      async (cursor, size) => {
        const snapshot = await getDocs(query(base, ...(cursor ? [startAfter(cursor)] : []), limit(size)))
        return snapshot.docs.map((entry) => ({ entry: toEntry(entry), cursor: entry }))
      },
      cursorRef.current,
      pageSize,
    )
      .then((page) => {
        if (epochRef.current !== epoch) return
        cursorRef.current = page.cursor
        setHasMore(page.hasMore)
        const fresh = page.entries.filter((entry) => !removedRef.current.has(entry.$id))
        setItems((current) => mergeFeedEntries(current, fresh))
      })
      .catch((error) => {
        console.error(error)
        if (epochRef.current === epoch) setHasMore(false)
      })
      .finally(() => {
        if (epochRef.current !== epoch) return
        loadingRef.current = false
        setLoading(false)
      })
  }, [baseQuery, enabled, pageSize])

  // A new feed (tab, user, open/closed, reset): start again at the top.
  useEffect(() => {
    epochRef.current += 1
    cursorRef.current = null
    loadingRef.current = false
    headIdsRef.current = new Set()
    removedRef.current = new Set()
    setItems([])
    setHasMore(false)
    setLoading(false)
    const base = baseQuery()
    if (!base || !enabled) return undefined
    loadMore()
    // The live head: the first page, as it changes.
    const unsubscribe = onSnapshot(
      query(base, limit(pageSize)),
      (snapshot) => {
        const head = snapshot.docs.map(toEntry).filter((entry) => !removedRef.current.has(entry.$id))
        const previous = headIdsRef.current
        headIdsRef.current = new Set(snapshot.docs.map((entry) => entry.id))
        setItems((current) => applyLiveHead(current, head, previous, pageSize))
      },
      (error) => console.error(error),
    )
    return unsubscribe
    // `loadMore` is rebuilt with the same deps; the generation re-runs a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseQuery, enabled, pageSize, generation])

  // Refill: marking rows read must not strand the rest behind the cursor.
  useEffect(() => {
    if (enabled && shouldLoadMore({ hasMore, loading, shown: items.length, pageSize })) loadMore()
  }, [enabled, hasMore, loading, items.length, pageSize, loadMore])

  const remove = useCallback((ids: readonly string[]) => {
    const gone = new Set(ids)
    for (const id of ids) removedRef.current.add(id)
    setItems((current) => current.filter((entry) => !gone.has(entry.$id)))
  }, [])

  const reset = useCallback(() => setGeneration((value) => value + 1), [])

  return { items, hasMore, loading, loadMore, remove, reset }
}

export default useNotificationFeed
