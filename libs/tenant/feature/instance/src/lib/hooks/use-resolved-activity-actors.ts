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

import { useEffect, useMemo, useRef, useState } from 'react'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from './firebase/firebase-services'

/** What the route resolves per request; a larger page asks in turns. */
const ACTORS_PER_REQUEST = 50

interface ActorRowLike {
  actorId?: string | null
  actorEmail?: string | null
}

/** A uid the row recorded with no address beside it, or null. */
function unaddressedUid(row: ActorRowLike): string | null {
  if (row.actorEmail) return null
  const uid = typeof row.actorId === 'string' ? row.actorId.trim() : ''
  return uid && uid !== 'api' && !uid.startsWith('system:') ? uid : null
}

/**
 * A site activity feed's rows, each one that recorded a uid and no address
 * given the address that uid holds now as `actorEmailNow` (AGL-3369).
 *
 * The site feeds read `hosts/{hostId}/activity` in the browser, which sees a
 * uid but cannot turn one into an address; `/api/hosts/activity-actors`
 * does, for members of the site and only for uids its log names. Rows render
 * at once and gain the address when it arrives; a failed lookup leaves them
 * as they were, and the presenter names the uid instead.
 */
export function useResolvedActivityActors<T extends ActorRowLike>(
  hostId: string | null | undefined,
  rows: readonly T[],
): Array<T & { actorEmailNow?: string }> {
  const { data: user } = useUser()
  const [resolved, setResolved] = useState<Record<string, string>>({})
  // Asked once per site, in a ref: marking a uid asked must not re-run the
  // effect that is still waiting on its answer.
  const asked = useRef(new Set<string>())
  const currentHost = useRef(hostId)

  // A different site is a different log: nothing resolved for one is asked
  // of another's.
  useEffect(() => {
    currentHost.current = hostId
    asked.current = new Set()
    setResolved({})
  }, [hostId])

  useEffect(() => {
    if (!hostId || !user) return
    const fresh = [
      ...new Set(rows.map(unaddressedUid).filter((uid): uid is string => Boolean(uid))),
    ].filter((uid) => !asked.current.has(uid))
    if (!fresh.length) return
    for (const uid of fresh) asked.current.add(uid)
    void (async () => {
      for (let start = 0; start < fresh.length; start += ACTORS_PER_REQUEST) {
        const url = new URL('/api/hosts/activity-actors', window.location.origin)
        url.searchParams.set('hostId', hostId)
        url.searchParams.set('uids', fresh.slice(start, start + ACTORS_PER_REQUEST).join(','))
        try {
          const response = await authorizedFetch(user, url.toString())
          if (!response.ok) continue
          const payload = (await response.json()) as { actors?: Record<string, string> }
          if (currentHost.current === hostId && payload.actors) {
            setResolved((previous) => ({ ...previous, ...payload.actors }))
          }
        } catch {
          // The row keeps its uid; the presenter names it.
        }
      }
    })()
  }, [hostId, user, rows])

  return useMemo(
    () =>
      rows.map((row) => {
        const uid = unaddressedUid(row)
        const now = uid ? resolved[uid] : undefined
        return now ? { ...row, actorEmailNow: now } : row
      }),
    [rows, resolved],
  )
}
