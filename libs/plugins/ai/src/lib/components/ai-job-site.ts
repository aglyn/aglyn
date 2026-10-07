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
import { useEffect, useRef, useState } from 'react'

/**
 * The site a site's AI jobs pages are about (AGL-3596): its workspace, which
 * every jobs request names, and its display name. Read once off the site
 * document the reader may already read.
 *
 * It always settles. A read that fails, a document without a workspace, or a
 * read still out after {@link AI_JOB_SITE_TIMEOUT_MS} is `error`, so a page
 * waiting on it says so instead of spinning: without a workspace there is no
 * job to ask for, and nothing would ever arrive to end the wait.
 */
export type AiJobSite =
  | { status: 'loading' }
  | { status: 'ready'; orgId: string; name: string }
  | { status: 'error' }

/** How long the site's read may take before the page says it could not be read. */
export const AI_JOB_SITE_TIMEOUT_MS = 15_000

export function useAiJobSite(hostId: string | null | undefined): AiJobSite {
  // Read through a ref: the read is keyed on the site alone, so a provider
  // that hands back a new handle each render does not read it again.
  const firestore = useFirestore()
  const firestoreRef = useRef(firestore)
  firestoreRef.current = firestore
  const [site, setSite] = useState<AiJobSite>({ status: 'loading' })
  useEffect(() => {
    if (!hostId) {
      setSite({ status: 'error' })
      return undefined
    }
    let active = true
    setSite((current) => (current.status === 'loading' ? current : { status: 'loading' }))
    const settle = (next: AiJobSite) => {
      if (!active) return
      active = false
      setSite(next)
    }
    const timer = setTimeout(() => settle({ status: 'error' }), AI_JOB_SITE_TIMEOUT_MS)
    void getDoc(doc(firestoreRef.current, 'hosts', hostId))
      .then((snapshot) => {
        const data = (snapshot.data() ?? {}) as { orgId?: unknown; displayName?: unknown }
        const orgId = typeof data.orgId === 'string' ? data.orgId : ''
        settle(
          orgId
            ? { status: 'ready', orgId, name: typeof data.displayName === 'string' ? data.displayName : '' }
            : { status: 'error' },
        )
      })
      .catch(() => settle({ status: 'error' }))
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [hostId])
  return site
}
