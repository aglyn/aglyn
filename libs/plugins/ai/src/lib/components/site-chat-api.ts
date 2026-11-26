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
import {
  SITE_CHAT_CONVERSATIONS_ROUTE,
  SITE_CHAT_SETTINGS_ROUTE,
  type SiteChatConversationSummary,
  type SiteChatSettings,
  type SiteChatSettingsAnswer,
  type SiteChatTurn,
} from '../model/site-chat'


export interface SiteChatConversation {
  summary: SiteChatConversationSummary
  turns: SiteChatTurn[]
  handOff: { email?: string; question?: string; at?: number } | null
}

/** The card's way to its routes; a spec hands the card its own. */
export interface SiteChatApi {
  /** `null` where the feature is not released to the workspace. */
  read(): Promise<SiteChatSettingsAnswer | null>
  save(settings: SiteChatSettings): Promise<{ settings: SiteChatSettings; refreshed: boolean }>
  conversations(): Promise<SiteChatConversationSummary[]>
  conversation(id: string): Promise<SiteChatConversation>
}

export function useSiteChatApi(hostId: string): SiteChatApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const answer = async <T,>(response: Response): Promise<T> => {
      const body = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw new Error(body?.error ?? 'Something went wrong. Try again.')
      return body
    }
    const query = (extra: Record<string, string> = {}) => new URLSearchParams({ hostId, ...extra }).toString()
    return {
      read: async () => {
        const response = await authorizedFetch(user, `/api/${SITE_CHAT_SETTINGS_ROUTE}?${query()}`, { method: 'GET' })
        return response.status === 404 ? null : answer<SiteChatSettingsAnswer>(response)
      },
      save: async (settings) =>
        answer(
          await authorizedFetch(user, `/api/${SITE_CHAT_SETTINGS_ROUTE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId, settings }),
          }),
        ),
      conversations: async () =>
        (
          await answer<{ conversations: SiteChatConversationSummary[] }>(
            await authorizedFetch(user, `/api/${SITE_CHAT_CONVERSATIONS_ROUTE}?${query()}`, { method: 'GET' }),
          )
        ).conversations,
      conversation: async (id) =>
        answer<SiteChatConversation>(
          await authorizedFetch(user, `/api/${SITE_CHAT_CONVERSATIONS_ROUTE}?${query({ id })}`, { method: 'GET' }),
        ),
    }
  }, [hostId, user])
}
