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

import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/app-utils/api-plugins'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  LIVE_CHAT_DEFAULT_SETTINGS,
  normalizeLiveChatSettings,
  readStoredLiveChatSettings,
  type LiveChatSettings,
} from '../model/settings'

/**
 * The console card's route, `/api/live-chat/settings` (AGL-3698).
 *
 *  - `GET ?hostId=` → `{ settings, canManage }`. Any member of the site.
 *  - `POST { hostId, settings }` → checks the settings field by field, writes
 *    them, and drops the site's cached pages so the change reaches the live
 *    site now rather than when the hour-long page cache lapses. A site ADMIN
 *    only — the role that switches a plugin on for the site, and the role the
 *    rules give `pluginSettings` — and never while the site is locked.
 *
 * The rules refuse a client write to this plugin's settings document, so
 * this route's check is the only way in: what reaches a published page has
 * always been parsed here first.
 */

export interface LiveChatSettingsDeps {
  /** Throws on a refused token; `emailUnverified` names that refusal. */
  verifyIdToken: (token: string) => Promise<{ uid: string; staff?: boolean }>
  isEmailUnverified: (error: unknown) => boolean
  /** The site's member roles, or null when there is no such site. */
  readMemberRoles: (hostId: string) => Promise<Record<string, unknown> | null>
  siteLocked: (hostId: string) => Promise<boolean>
  readSettings: (hostId: string) => Promise<unknown>
  writeSettings: (hostId: string, settings: LiveChatSettings, uid: string) => Promise<void>
  /** Drops the site's cached pages; false when that did not certainly happen. */
  dropSiteCache: (hostId: string) => Promise<boolean>
}

export interface LiveChatSettingsAnswer {
  settings: LiveChatSettings
  canManage: boolean
}

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

const bearerOf = (req: PluginApiRequest): string => {
  const header = req.headers['authorization']
  const value = String((Array.isArray(header) ? header[0] : header) ?? '')
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length) : ''
}

const bodyOf = (req: PluginApiRequest): Record<string, unknown> => {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (req.body ?? {}) as Record<string, unknown>
}

export function createLiveChatSettingsHandler(deps: LiveChatSettingsDeps): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const body = req.method === 'POST' ? bodyOf(req) : {}
    const hostId = String((req.method === 'GET' ? req.query['hostId'] : body['hostId']) ?? '')
    if (!HOST_ID.test(hostId)) return res.status(400).json({ error: 'Missing site' })
    const token = bearerOf(req)
    if (!token) return res.status(401).json({ error: 'Unauthenticated' })
    try {
      let caller: { uid: string; staff?: boolean }
      try {
        caller = await deps.verifyIdToken(token)
      } catch (error) {
        if (deps.isEmailUnverified(error)) {
          return res.status(403).json({ error: 'Verify your email to continue', reason: 'email-unverified' })
        }
        // Only a refused token is the caller's fault; an Auth outage is ours.
        if (!isRefusedIdToken(error)) throw error
        return res.status(401).json({ error: 'Unauthenticated' })
      }
      const roles = await deps.readMemberRoles(hostId)
      if (!roles) return res.status(404).json({ error: 'Unknown site' })
      const staff = caller.staff === true
      const role = roles[caller.uid]
      if (!staff && !role) return res.status(403).json({ error: 'You are not a member of this site' })
      const canManage = staff || role === 'admin'

      if (req.method === 'GET') {
        const answer: LiveChatSettingsAnswer = {
          settings: readStoredLiveChatSettings(await deps.readSettings(hostId)),
          canManage,
        }
        return res.status(200).json(answer)
      }

      if (!canManage) {
        return res.status(403).json({ error: 'Live chat is set up by a site admin.' })
      }
      if (await deps.siteLocked(hostId)) {
        return res.status(423).json({ error: 'This site is locked and cannot take changes right now.' })
      }
      const result = normalizeLiveChatSettings(body['settings'] ?? LIVE_CHAT_DEFAULT_SETTINGS)
      if ('error' in result) return res.status(400).json({ error: result.error })
      await deps.writeSettings(hostId, result.settings, caller.uid)
      const refreshed = await deps.dropSiteCache(hostId).catch(() => false)
      return res.status(200).json({ settings: result.settings, canManage, refreshed })
    } catch (error) {
      console.error('[live-chat/settings]', error)
      return res.status(500).json({ error: 'That did not go through. Try again.' })
    }
  }
}
