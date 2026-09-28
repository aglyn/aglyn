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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useState } from 'react'
import type { PageHold } from './page-hold-copy'

export interface PageHoldsState {
  holds: PageHold[]
  /** The workspace the site belongs to, for a review request. */
  orgId: string | null
  /** Whether this reader may ask for a review (the workspace's owners and admins). */
  canRequestReview: boolean
}

const EMPTY: PageHoldsState = { holds: [], orgId: null, canRequestReview: false }

/**
 * How long one read serves every surface on the page: the list, its chips
 * and the editor's banner all ask, and a hold changes on a person's review,
 * not by the second.
 */
const TTL_MS = 60_000
const cache = new Map<string, { atMs: number; read: Promise<PageHoldsState> }>()

/** Test seam. */
export function resetPageHoldsCacheForTests(): void {
  cache.clear()
}

/**
 * The site's held and flagged pages (AGL-3374), from `/api/hosts/page-holds`
 * — one query on the site's page notices, shared by every surface that asks
 * within a minute. Fails quiet: a surface without the answer shows no chip,
 * which is what it showed before this existed.
 */
export default function usePageHolds(hostId: string | null | undefined): PageHoldsState & {
  reload: () => void
} {
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid
  const [state, setState] = useState<PageHoldsState>(EMPTY)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!hostId || !uid) return
    let live = true
    const key = `${uid}\n${hostId}`
    const cached = cache.get(key)
    const read =
      cached && Date.now() - cached.atMs < TTL_MS
        ? cached.read
        : authorizedFetch(user, `/api/hosts/page-holds?hostId=${encodeURIComponent(hostId)}`)
            .then(async (response) => {
              const payload = await response.json().catch(() => ({}))
              if (!response.ok) return EMPTY
              return {
                holds: Array.isArray(payload.holds) ? (payload.holds as PageHold[]) : [],
                orgId: typeof payload.orgId === 'string' ? payload.orgId : null,
                canRequestReview: payload.canRequestReview === true,
              }
            })
            .catch(() => EMPTY)
    if (read !== cached?.read) cache.set(key, { atMs: Date.now(), read })
    void read.then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
    // Keyed on who, which site and a reload — not on `user`, whose identity
    // changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, uid, nonce])

  const reload = useCallback(() => {
    if (hostId && uid) cache.delete(`${uid}\n${hostId}`)
    setNonce((value) => value + 1)
  }, [hostId, uid])

  return { ...state, reload }
}
