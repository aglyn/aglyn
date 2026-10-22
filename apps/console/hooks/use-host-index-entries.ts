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
import firestoreOneShotRetry from '../utils/firestore-one-shot-retry'

/** The routing fields a stored notification link needs to be rewritten. */
export interface HostIndexEntry {
  subdomain: string
  /** Owning org, mirrored from the host doc (AGL-233). */
  orgId?: string
}

/**
 * Resolve `hostId → { subdomain, orgId }` for an arbitrary set of hosts
 * (AGL-672, AGL-1773).
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
 * It mirrors `orgId` too, and this used to return the subdomain alone — so the
 * cross-org fix was half done (AGL-1773): the rewrite got the right subdomain
 * and then keyed the org half off whichever workspace the reader had OPEN,
 * producing `/{other-org}/hosts/{subdomain}/…`, which `HostGuard` 404s because
 * it only resolves subdomains inside the current org. Returning the org with
 * the subdomain repairs the whole stored backlog, not just links written from
 * now on: a notification's `link` is frozen at write time, so fixing the
 * emitters alone can never reach one that already exists.
 *
 * Ids are fetched once and cached for the life of the component. Failures are
 * swallowed and simply leave the id unresolved — callers must degrade to the
 * stored link rather than to a wrong destination.
 */
export function useHostIndexEntries(
  hostIds: Array<string | undefined | null>,
): Map<string, HostIndexEntry> {
  const firestore = useFirestore()
  const [resolved, setResolved] = useState<Map<string, HostIndexEntry>>(
    new Map(),
  )
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
          // Named for the session-health verdict (AGL-1063) — `hostIndex`
          // is readable by any signed-in member of the owning org, so a
          // denial here is about the session rather than about this host.
          const snapshot = await firestoreOneShotRetry(
            () => getDoc(doc(firestore, 'hostIndex', id)),
            'hostIndex',
          )
          const subdomain = snapshot.get('subdomain') as string | undefined
          const orgId = snapshot.get('orgId') as string | undefined
          // The subdomain is what makes an entry usable at all — an index
          // row without one cannot be routed to, with or without an org.
          return subdomain
            ? ([id, { subdomain, ...(orgId ? { orgId } : {}) }] as const)
            : null
        } catch {
          return null
        }
      }),
    ).then((entries) => {
      if (!active) return
      const found = entries.filter(Boolean) as Array<
        readonly [string, HostIndexEntry]
      >
      if (!found.length) return
      setResolved((previous) => {
        const next = new Map(previous)
        found.forEach(([id, entry]) => next.set(id, entry))
        return next
      })
    })

    return () => {
      active = false
    }
  }, [firestore, key])

  return resolved
}

export default useHostIndexEntries
