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

import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PresentPerson } from '../app/api/_lib/presence-summary'

export type { PresentPerson }

/** `{ [docType]: { [docId]: PresentPerson[] } }` */
export type PresenceSummary = Record<string, Record<string, PresentPerson[]>>

/**
 * How often a visible list re-asks who is in each document.
 *
 * A SNAPSHOT, not a subscription — see `use-presence.ts` for the live room and
 * `/api/presence/summary` for why a list cannot have one: the RTDB rules let a
 * client read exactly one room, so a list of fifty would need fifty listeners
 * and ~97% of them would report an empty room.
 *
 * 30s is chosen against what the answer is FOR. Nobody opens a document based
 * on a half-minute-old avatar and is meaningfully misled — and the summary
 * already refuses to report anyone the editor would have stopped drawing
 * (150s), so a stale row expires on its own terms rather than lingering.
 */
export const PRESENCE_SUMMARY_POLL_MS = 30_000

/**
 * Who is already in each document of a site, for list rows (AGL-2486).
 *
 * Zach: "identify who is currently in the document already before joining."
 *
 * ## Only while the tab is VISIBLE
 *
 * The same discipline the presence heartbeat follows. A backgrounded list is
 * nobody's decision aid, and a console with several tabs open would otherwise
 * poll once per tab forever. It also refreshes on focus, which is the moment
 * the answer is about to be used and the moment it is most likely stale.
 *
 * ## It fails to NOTHING
 *
 * Every failure path yields an empty summary rather than an error state. This
 * decorates a list; it must never be the reason a page looks broken. The
 * endpoint agrees — it answers 200 with an empty summary when it cannot read.
 */
export function usePresenceSummary(hostId: string | undefined): {
  summary: PresenceSummary
  /** Who is in one document, across its versions. Empty when nobody is. */
  peopleIn: (docType: string, docId: string) => PresentPerson[]
  refresh: () => void
} {
  const { data: user } = useUser()
  const [summary, setSummary] = useState<PresenceSummary>({})
  // The token getter is read through a ref so the polling effect does not
  // re-arm every time the user object is re-created — the same trap that once
  // made presence re-mint a token on every render.
  const getIdTokenRef = useRef<(() => Promise<string>) | undefined>(undefined)
  getIdTokenRef.current = (
    user as { getIdToken?: () => Promise<string> } | undefined
  )?.getIdToken?.bind(user)
  const uid = (user as { uid?: string } | undefined)?.uid

  const load = useCallback(async () => {
    if (!hostId) return
    try {
      const idToken = await getIdTokenRef.current?.()
      if (!idToken) return
      const response = await fetch('/api/presence/summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ hostId }),
      })
      if (!response.ok) {
        // A refusal here is not worth a console error on every list render —
        // it is the ordinary answer for a viewer without access.
        setSummary({})
        return
      }
      const body = await response.json()
      setSummary((body?.summary ?? {}) as PresenceSummary)
    } catch {
      setSummary({})
    }
  }, [hostId])

  useEffect(() => {
    if (!hostId || !uid) return undefined
    let stopped = false
    const tick = () => {
      if (stopped) return
      if (typeof document !== 'undefined' && document.hidden) return
      void load()
    }
    tick()
    const timer = setInterval(tick, PRESENCE_SUMMARY_POLL_MS)
    // The moment the answer is about to be used is the moment to refresh it.
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [hostId, uid, load])

  const peopleIn = useCallback(
    (docType: string, docId: string) => summary[docType]?.[docId] ?? [],
    [summary],
  )

  return { summary, peopleIn, refresh: () => void load() }
}

export default usePresenceSummary
