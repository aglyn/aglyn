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

import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Resolve `hostId → subdomain` for an arbitrary set of hosts (AGL-672).
 *
 * Notification links are stored as `/{hostDocId}/rest` and rewritten to
 * `/{orgSlug}/hosts/{subdomain}/rest` when followed. Resolving the subdomain
 * from the *currently open* org's host list only works when the notification
 * belongs to that org — a notification from any other org silently fell
 * through to the stored link, which is a dead route.
 *
 * `hostIndex` is the global routing mirror: signed-in readable, keyed by host
 * doc id, and already carrying `subdomain` (the same reason
 * `host-id-provider` uses it for cross-org redirects). So it resolves hosts in
 * every org the user can see, not just the open one.
 *
 * Ids are fetched once and cached for the life of the component. Failures are
 * swallowed and simply leave the id unresolved — callers must degrade to the
 * stored link rather than to a wrong destination.
 */
export function useHostSubdomains(
  hostIds: Array<string | undefined | null>,
): Map<string, string> {
  const firestore = useFirestore()
  const [resolved, setResolved] = useState<Map<string, string>>(new Map())
  // Ids already fetched — including ones that came back empty, so a host
  // without an index entry is not re-requested on every render.
  const attemptedRef = useRef<Set<string>>(new Set())

  // Stringified so a new array with the same ids doesn't re-trigger the effect.
  const key = useMemo(
    () => Array.from(new Set(hostIds.filter(Boolean) as string[])).sort().join(','),
    [hostIds],
  )

  useEffect(() => {
    if (!key) return
    const pending = key.split(',').filter((id) => !attemptedRef.current.has(id))
    if (!pending.length) return
    pending.forEach((id) => attemptedRef.current.add(id))

    let active = true
    void Promise.all(
      pending.map(async (id) => {
        try {
          const snapshot = await getDoc(doc(firestore, 'hostIndex', id))
          const subdomain = snapshot.get('subdomain') as string | undefined
          return subdomain ? ([id, subdomain] as const) : null
        } catch {
          return null
        }
      }),
    ).then((entries) => {
      if (!active) return
      const found = entries.filter(Boolean) as Array<readonly [string, string]>
      if (!found.length) return
      setResolved((previous) => {
        const next = new Map(previous)
        found.forEach(([id, subdomain]) => next.set(id, subdomain))
        return next
      })
    })

    return () => {
      active = false
    }
  }, [firestore, key])

  return resolved
}

export default useHostSubdomains
