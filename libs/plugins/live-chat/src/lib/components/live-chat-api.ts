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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useMemo } from 'react'
import { LIVE_CHAT_SETTINGS_ROUTE } from '../constants'
import type { LiveChatSettings } from '../model/settings'

/** What the card's route answers (`server/settings-route.ts`). */
export interface LiveChatCardState {
  settings: LiveChatSettings
  canManage: boolean
}

export interface LiveChatSaveAnswer extends LiveChatCardState {
  /** Whether the site's cached pages were dropped, so the change is live now. */
  refreshed: boolean
}

/**
 * The card's one way to its route (AGL-3698): the member's own token, the
 * route's sentence thrown on a refusal. A spec hands the card its own.
 */
export interface LiveChatApi {
  read(): Promise<LiveChatCardState>
  save(settings: LiveChatSettings): Promise<LiveChatSaveAnswer>
}

export function useLiveChatApi(hostId: string): LiveChatApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const answer = async <T,>(response: Response): Promise<T> => {
      const body = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw new Error(body?.error ?? 'Something went wrong. Try again.')
      return body
    }
    return {
      read: async () =>
        answer<LiveChatCardState>(
          await authorizedFetch(
            user,
            `/api/${LIVE_CHAT_SETTINGS_ROUTE}?${new URLSearchParams({ hostId }).toString()}`,
            { method: 'GET' },
          ),
        ),
      save: async (settings) =>
        answer<LiveChatSaveAnswer>(
          await authorizedFetch(user, `/api/${LIVE_CHAT_SETTINGS_ROUTE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId, settings }),
          }),
        ),
    }
  }, [hostId, user])
}
