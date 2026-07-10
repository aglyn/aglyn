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

import { Timestamp } from '@aglyn/shared-util-timestamp'
import { addDoc, collection } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'

/** What an activity entry points at; `id` lets detail pages filter. */
export interface HostActivityTarget {
  type:
    | 'host'
    | 'screen'
    | 'layout'
    | 'theme'
    | 'media'
    | 'content'
    | 'variable'
    | 'function'
    | 'workflow'
    | 'member'
  id?: string
  name?: string
}

/**
 * User activity log (AGL-118): fire-and-forget appends to
 * `hosts/{hostId}/activity` from console mutation points. Never throws —
 * an audit miss must not break the edit that triggered it. Covered by the
 * host-admin wildcard rule, so no rules change is needed.
 */
export function useHostActivityLogger(hostId: string) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  return useCallback(
    (action: string, target: HostActivityTarget) => {
      if (!hostId) return
      void addDoc(collection(firestore, 'hosts', hostId, 'activity'), {
        actorId: user?.uid ?? null,
        actorEmail: user?.email ?? null,
        action,
        target: {
          type: target.type,
          ...(target.id ? { id: target.id } : {}),
          ...(target.name ? { name: target.name } : {}),
        },
        createdAt: Timestamp.now(),
      }).catch(console.error)
    },
    [firestore, hostId, user],
  )
}

export default useHostActivityLogger
