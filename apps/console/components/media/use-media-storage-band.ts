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
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { useEffect, useRef, useState } from 'react'
import { type MediaStorageBand, parseMediaStorageBand } from './media-storage-copy'

export interface UseMediaStorageBandOptions {
  /** The org library's id; set for the org scope. */
  orgId?: string | null
  /** The site library's id; read when `orgId` is not set. */
  hostId?: string | null
  /** The signed-in account, which authorizes the read. */
  user?: MaybeTokenSource
  /** Test seam — the real one is `fetch`. */
  fetcher?: typeof fetch
}

/**
 * The org's media storage band for the open library (AGL-3470), from
 * `/api/media/storage` — `null` until it answers, and `null` for good when it
 * cannot (a viewer, a lock, a failure), which the readout takes as "state no
 * cap".
 *
 * ONE read per library opened, not per render or per upload: the pool is kept
 * live from the library's own counter (`pooledMediaBytes`), so nothing here
 * needs to run again until the scope changes. A previous scope's answer is
 * never returned for the next one.
 */
export function useMediaStorageBand(
  options: UseMediaStorageBandOptions,
): MediaStorageBand | null {
  const { orgId, hostId, user, fetcher } = options
  const scopeQuery = orgId
    ? `orgId=${encodeURIComponent(orgId)}`
    : hostId
      ? `hostId=${encodeURIComponent(hostId)}`
      : null
  const signedIn = Boolean(user)
  const [answer, setAnswer] = useState<{
    scopeQuery: string
    band: MediaStorageBand | null
  } | null>(null)
  // The account by reference: its object can be rebuilt without the person
  // changing, and a new object must not cost another read.
  const userRef = useRef(user)
  userRef.current = user

  useEffect(() => {
    if (!scopeQuery || !signedIn) return undefined
    let cancelled = false
    void (async () => {
      let band: MediaStorageBand | null = null
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/media/storage?${scopeQuery}`,
          {},
          { fetchImpl: fetcher },
        )
        if (response.ok) band = parseMediaStorageBand(await response.json())
      } catch {
        band = null
      }
      if (!cancelled) setAnswer({ scopeQuery, band })
    })()
    return () => {
      cancelled = true
    }
  }, [scopeQuery, signedIn, fetcher])

  return answer && answer.scopeQuery === scopeQuery ? answer.band : null
}

export default useMediaStorageBand
