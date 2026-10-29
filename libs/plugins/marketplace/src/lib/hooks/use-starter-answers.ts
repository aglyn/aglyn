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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn/app-utils/lockdown'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef } from 'react'
import { readStarterAnswersAnswer, STARTER_ANSWERS_PATH, starterAnswersParams } from '../model/starter-query'

/** How reading one AI starter's answers ended. */
export type StarterAnswersOutcome =
  /** The answers it carries, to fill the AI start's questions. */
  | { status: 'ready'; answers: Record<string, unknown> }
  /** A priced starter the workspace has not bought: bought first, then read. */
  | { status: 'purchase' }
  /** They could not be read; the words to show. */
  | { status: 'failed'; message: string }

/**
 * Reads the answers an AI starter carries (AGL-4049 phase 4), once a person
 * picks it in "Choose your starter": `GET /api/marketplace/starters/answers`
 * with the person's own token, for the workspace the site is for. A 402 is a
 * starter to buy first, never a failure.
 */
export function useStarterAnswers(orgId: string | undefined): {
  read: (listingId: string) => Promise<StarterAnswersOutcome>
} {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const read = useCallback(
    async (listingId: string): Promise<StarterAnswersOutcome> => {
      if (!orgId || !listingId) return { status: 'failed', message: 'This starter could not be read.' }
      try {
        const response = await authorizedFetch(
          userRef.current,
          `${STARTER_ANSWERS_PATH}?${starterAnswersParams({ orgId, listingId }).toString()}`,
        )
        const payload: unknown = await response.json().catch((): null => null)
        if (response.status === 402) return { status: 'purchase' }
        const parsed = response.ok ? readStarterAnswersAnswer(payload) : null
        if (parsed) return { status: 'ready', answers: parsed.answers }
        // A lockdown is not a broken starter (AGL-1532): it says what is paused.
        const locked = parseLockdownRefusal(response.status, payload)
        if (locked) return { status: 'failed', message: lockdownRefusalText(locked) }
        const error = (payload as { error?: unknown } | null)?.error
        return {
          status: 'failed',
          message: typeof error === 'string' && error ? error : 'This starter could not be read.',
        }
      } catch {
        return { status: 'failed', message: 'This starter could not be read. Check your connection and try again.' }
      }
    },
    [orgId],
  )
  return { read }
}
