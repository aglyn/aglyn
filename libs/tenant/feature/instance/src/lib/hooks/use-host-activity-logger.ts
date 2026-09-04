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

import { reportHandledError } from '@aglyn/aglyn/app-utils/error-beacon'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { addDoc, collection } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore, useUser } from './firebase/firebase-services'

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
    // Standalone editors (AGL-680/681) — both are edited on their own now,
    // so their saves belong in the same log as screens and layouts.
    | 'component'
    | 'template'
  id?: string
  name?: string
  /**
   * Version-addressed targets (screens) record this so the feed can deep-link
   * straight to the exact version's detail view (AGL-812). Written only when
   * truthy, like `id`/`name`.
   */
  versionId?: string
}

/** One console line per session, however many appends fail. */
let announced = false

/**
 * What a dropped audit append does instead of nothing.
 *
 * The append stays fire-and-forget: an audit miss must never break the edit
 * that triggered it, and a snackbar about the LOG would be a worse answer to
 * "your page saved" than silence. But a rejection with nowhere to go is a
 * feature that can break for months without a single signal, so the failure
 * leaves by two doors that cost the person nothing.
 *
 * The beacon is the durable one — it reaches Cloud Error Reporting, dedupes a
 * failure that repeats on every edit into one report, and caps itself, so a
 * permission denial shows up as a graph instead of a support ticket. The
 * console line is for whoever has devtools open, and fires once: the second
 * failure carries no information the first did not, and a message per edit
 * buries the diagnostics that do.
 */
function reportDroppedEntry(error: unknown): void {
  reportHandledError(error, { kind: 'host-activity-write' })
  if (announced) return
  announced = true
  console.error(
    'Activity logging failed; entries from this session are being dropped.',
    error,
  )
}

/**
 * User activity log (AGL-118): fire-and-forget appends to
 * `hosts/{hostId}/activity` from console mutation points. Never throws —
 * an audit miss must not break the edit that triggered it. Covered by the
 * host-admin wildcard rule, so no rules change is needed.
 *
 * `activity` is deliberately absent from the host catch-all's create
 * exclusion list, so a member holding a content role writes here directly.
 * `cloud/rules-tests/firestore-rules.test.mjs` pins that on both sides —
 * the roles that may append and the roles that may not.
 */
export function useHostActivityLogger(hostId: string | undefined) {
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
          ...(target.versionId ? { versionId: target.versionId } : {}),
        },
        createdAt: Timestamp.now(),
      }).catch(reportDroppedEntry)
    },
    [firestore, hostId, user],
  )
}

export default useHostActivityLogger
