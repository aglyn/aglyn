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
import { zapierHookView, type ZapierHookStore } from './store'
import type { ZapierHookView } from '../model/hook-events'

/**
 * The console card's route, `/api/zapier/hooks` (AGL-3643): a site's Zaps,
 * and disconnecting one. A member of the site sees which Zaps take its
 * records; only a site admin disconnects one, the bar order webhooks set.
 *
 *  - `GET ?hostId=` → `{ configured, appUrl, canManage, hooks }`. While the
 *    deployment has not set `ZAPIER_APP_URL`, `configured` is false and the
 *    card draws nothing.
 *  - `POST { hostId, hookId }` → removes the hook; Zapier is not told, and
 *    the Zap stops receiving events. Turning the Zap off in Zapier does the
 *    same from the other side.
 */

export interface ZapierConsoleDeps {
  verifyIdToken: (token: string) => Promise<{ uid: string }>
  /** The site's member roles, or null when there is no such site. */
  readMemberRoles: (hostId: string) => Promise<Record<string, unknown> | null>
  siteLocked: (hostId: string) => Promise<boolean>
  store: () => ZapierHookStore
  /** The published app's link, or null while it is hidden. */
  appUrl: () => string | null
}

export interface ZapierConsoleAnswer {
  configured: boolean
  appUrl: string | null
  canManage: boolean
  hooks: ZapierHookView[]
}

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

const bearerOf = (req: PluginApiRequest): string => {
  const header = String(req.headers['authorization'] ?? '')
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
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

export function createZapierConsoleHooksHandler(deps: ZapierConsoleDeps): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const body = req.method === 'POST' ? bodyOf(req) : {}
    const hostId = String((req.method === 'GET' ? req.query['hostId'] : body['hostId']) ?? '')
    if (!HOST_ID.test(hostId)) return res.status(400).json({ error: 'Missing hostId' })
    const token = bearerOf(req)
    if (!token) return res.status(401).json({ error: 'Unauthenticated' })
    try {
      let uid: string
      try {
        uid = (await deps.verifyIdToken(token)).uid
      } catch {
        return res.status(401).json({ error: 'Unauthenticated' })
      }
      const roles = await deps.readMemberRoles(hostId)
      if (!roles) return res.status(404).json({ error: 'Unknown site' })
      const role = roles[uid]
      if (!role) return res.status(403).json({ error: 'You are not a member of this site' })
      const appUrl = deps.appUrl()
      const canManage = role === 'admin'

      if (req.method === 'GET') {
        const answer: ZapierConsoleAnswer = appUrl
          ? { configured: true, appUrl, canManage, hooks: (await deps.store().listHooks(hostId)).map(zapierHookView) }
          : { configured: false, appUrl: null, canManage: false, hooks: [] }
        return res.status(200).json(answer)
      }

      if (!canManage) return res.status(403).json({ error: 'Zaps are disconnected by a site admin' })
      if (await deps.siteLocked(hostId)) {
        return res.status(423).json({ error: 'This site is locked and cannot take changes right now' })
      }
      const hookId = String(body['hookId'] ?? '')
      const hook = hookId ? await deps.store().getHook(hookId) : null
      if (!hook || hook.hostId !== hostId) return res.status(404).json({ error: 'That Zap is no longer connected' })
      await deps.store().deleteHook(hook.id)
      return res.status(200).json({ ok: true })
    } catch (error) {
      console.error('[zapier/hooks]', error)
      return res.status(500).json({ error: 'That did not go through. Try again.' })
    }
  }
}
