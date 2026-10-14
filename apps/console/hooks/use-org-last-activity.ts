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

import { authorizedFetch, type MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useRef } from 'react'
import { ORG_LAST_ACTIVITY_INTERVAL_MS } from '../utils/org-list-query'

/** Real input — not a mouse drifting across an idle window. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

const storageKey = (orgId: string) => `aglyn:org-last-activity:${orgId}`

/** When this browser last told the server about activity in `orgId`, or 0. */
export function readOrgActivitySentAt(orgId: string): number {
  try {
    return Number(window.localStorage.getItem(storageKey(orgId))) || 0
  } catch {
    return 0
  }
}

function writeOrgActivitySentAt(orgId: string, at: number): void {
  try {
    window.localStorage.setItem(storageKey(orgId), String(at))
  } catch {
    // Private mode: the per-hook timestamp below still throttles this tab,
    // and the route bounds the writes either way.
  }
}

/**
 * Whether a beat is due: nothing sent from this browser (any tab) or from
 * this hook within the interval.
 */
export function orgActivityBeatDue(
  lastSentMs: number,
  nowMs: number,
  intervalMs: number = ORG_LAST_ACTIVITY_INTERVAL_MS,
): boolean {
  return nowMs - lastSentMs >= intervalMs
}

/**
 * Tells the server a member is using the console in `orgId`, so the staff
 * Organizations list can say when each workspace was last active
 * (`lastActivityAt`, `utils/org-list-query.ts`).
 *
 * On mount (opening the workspace is activity) and on real input, at most
 * once per `ORG_LAST_ACTIVITY_INTERVAL_MS` per browser — sibling tabs share
 * the throttle through `localStorage`. Fire-and-forget: a failed beat costs
 * one interval of accuracy and is never surfaced.
 */
export function useOrgLastActivity(orgId: string | null | undefined): void {
  const { data: user } = useUser()
  const userRef = useRef<MaybeTokenSource>(user as MaybeTokenSource)
  userRef.current = user as MaybeTokenSource
  const signedIn = Boolean(user)

  useEffect(() => {
    if (!orgId || !signedIn || typeof window === 'undefined') return undefined
    let lastSent = 0
    const beat = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (!orgActivityBeatDue(Math.max(lastSent, readOrgActivitySentAt(orgId)), now)) return
      lastSent = now
      writeOrgActivitySentAt(orgId, now)
      void authorizedFetch(userRef.current, '/api/orgs/last-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
        keepalive: true,
      }).catch(() => undefined)
    }
    beat()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, beat, { passive: true })
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, beat)
      }
    }
  }, [orgId, signedIn])
}

export default useOrgLastActivity
