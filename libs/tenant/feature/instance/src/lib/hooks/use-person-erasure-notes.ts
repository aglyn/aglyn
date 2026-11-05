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

import type { PersonErasureNotesRead } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure-notes'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import type { User } from 'firebase/auth'
import { useEffect, useState } from 'react'

/** What a person erasure's confirmation prints from the plugins' notes. */
export interface PersonErasureNotes {
  /** Each sentence a plugin answered. */
  lines: string[]
  /** A plugin's note could not be read, so the screen says details are missing. */
  unavailable: boolean
}

const NONE: PersonErasureNotes = { lines: [], unavailable: false }

/**
 * What the plugins say a person erasure keeps in a workspace (AGL-4042), from
 * `/api/person-erasure-notes`. Nothing until it answers, and nothing for a
 * member the route refuses, who cannot file an erasure either. Any other
 * failure reads as `unavailable`, so a missing note never reads as nothing
 * being kept. Never holds a confirm back.
 */
export function usePersonErasureNotes(
  user: User | null | undefined,
  orgId: string | null | undefined,
): PersonErasureNotes {
  const [notes, setNotes] = useState<PersonErasureNotes>(NONE)
  const uid = user?.uid ?? ''
  useEffect(() => {
    setNotes(NONE)
    if (!user || !orgId) return
    let active = true
    void (async () => {
      let answer: PersonErasureNotes
      try {
        const response = await authorizedFetch(
          user,
          `/api/person-erasure-notes?orgId=${encodeURIComponent(orgId)}`,
        )
        const body = (await response.json().catch(() => null)) as PersonErasureNotesRead | null
        answer =
          response.status === 403
            ? NONE
            : response.ok && Array.isArray(body?.notes)
              ? {
                  lines: body.notes.map((note) => note.text),
                  unavailable: Array.isArray(body.unavailable) && body.unavailable.length > 0,
                }
              : { lines: [], unavailable: true }
      } catch {
        answer = { lines: [], unavailable: true }
      }
      if (active) setNotes(answer)
    })()
    return () => {
      active = false
    }
    // The user object changes identity on every token refresh; its uid does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, orgId])
  return notes
}
