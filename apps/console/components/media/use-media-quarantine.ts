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

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Which of these assets are disabled, and what the owner should be told
 * (AGL-1612).
 *
 * The state lives in a deny list only the Admin SDK can read, so this asks
 * `/api/media/quarantine` rather than listening to Firestore — see that
 * route for why it takes media ids instead of the digests the client already
 * has. The route answers without touching a single media document when
 * nothing is quarantined, which is the state of a healthy platform, so the
 * cost of having this hook mounted is one bounded POST per grid change.
 *
 * **Silent on failure, deliberately.** A quarantine notice is additional
 * context on a grid that renders perfectly well without it. If the probe
 * fails, the DAM must look exactly as it does today — a snackbar reading
 * "could not check file state" on a page where nothing is wrong would train
 * people to ignore it, and the enforcement itself does not depend on this
 * surface being right.
 */
export interface MediaQuarantineCardNotice {
  reason: string
  title: string
  body: string
  contact: string | null
}

export type MediaQuarantineMap = Record<string, MediaQuarantineCardNotice>

export interface UseMediaQuarantineOptions {
  /** The ids currently on screen. Order is irrelevant; identity is not. */
  mediaIds: string[]
  orgId?: string | null
  hostId?: string | null
  /** The signed-in user, for its `getIdToken()`. */
  user?: unknown
  /** Test seam — the real one is `fetch`. */
  fetcher?: typeof fetch
}

export function useMediaQuarantine(
  options: UseMediaQuarantineOptions,
): MediaQuarantineMap {
  const { mediaIds, orgId, hostId, user, fetcher } = options
  const [map, setMap] = useState<MediaQuarantineMap>({})
  // The identity of the SET, not of the array. The grid rebuilds its list on
  // every render and on every unrelated filter change; keying the effect on
  // the array itself would re-probe continuously.
  const idKey = useMemo(
    () => Array.from(new Set(mediaIds)).sort().join(','),
    [mediaIds],
  )
  const latest = useRef(0)

  useEffect(() => {
    if (!idKey) {
      setMap({})
      return
    }
    let cancelled = false
    const ticket = ++latest.current
    const run = async () => {
      try {
        const idToken = await (user as { getIdToken?: () => Promise<string> })
          ?.getIdToken?.()
        if (!idToken || cancelled) return
        const response = await (fetcher ?? fetch)('/api/media/quarantine', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${idToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            orgId: orgId ?? undefined,
            hostId: hostId ?? undefined,
            mediaIds: idKey.split(','),
          }),
        })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as {
          quarantined?: MediaQuarantineMap
        }
        // A slower earlier probe must never overwrite a newer answer — the
        // grid changes faster than a round trip when someone is typing in
        // the search field.
        if (cancelled || ticket !== latest.current) return
        setMap(payload?.quarantined ?? {})
      } catch {
        // Silent — see the header.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [idKey, orgId, hostId, user, fetcher])

  return map
}

export default useMediaQuarantine
