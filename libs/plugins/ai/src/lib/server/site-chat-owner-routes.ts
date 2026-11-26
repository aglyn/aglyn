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
import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  normalizeSiteChatSettings,
  readStoredSiteChatSettings,
  SITE_CHAT_DEFAULT_SETTINGS,
  siteChatCeiling,
  siteChatOnPlan,
  siteChatPlanCredits,
  type SiteChatConversationSummary,
  type SiteChatMonth,
  type SiteChatSettings,
  type SiteChatSettingsAnswer,
  type SiteChatTurn,
} from '../model/site-chat'

/**
 * The owner's site chat doors on the console (AGL-4250):
 *
 * - `GET|POST ai/site-chat/settings?hostId=` — the chat's settings card: on
 *   or off, the greeting, suggested questions, opening message, what it may
 *   do, the pages it shows on and the monthly cap; with what the plan allows
 *   and this month's figures. Writing takes "Manage site settings".
 * - `GET ai/site-chat/conversations?hostId=[&id=]` — the site's visitor
 *   conversations, newest first, or one conversation's turns. Any member of
 *   the site may read them.
 */

export interface SiteChatOwnerDeps {
  verifyIdToken: (token: string) => Promise<{ uid: string; staff?: boolean }>
  isEmailUnverified: (error: unknown) => boolean
  readSiteAccess: (hostId: string) => Promise<{
    memberRoles: Record<string, unknown>
    memberPermissions?: unknown
    orgId: string | null
  } | null>
  readPlan: (orgId: string) => Promise<string>
  flagOn: (orgId: string) => Promise<boolean>
  siteLocked: (hostId: string) => Promise<boolean>
  readSettings: (hostId: string) => Promise<unknown>
  writeSettings: (hostId: string, settings: SiteChatSettings, uid: string) => Promise<void>
  dropSiteCache: (hostId: string) => Promise<boolean>
  readMonth: (orgId: string, hostId: string) => Promise<SiteChatMonth>
  listConversations: (hostId: string, limit: number) => Promise<SiteChatConversationSummary[]>
  readConversation: (
    hostId: string,
    id: string,
  ) => Promise<{ summary: SiteChatConversationSummary; turns: SiteChatTurn[]; handOff: unknown } | null>
}


const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/
const CONVERSATION_ID = /^[0-9a-f]{32}$/

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

type Caller = { uid: string; staff: boolean; access: NonNullable<Awaited<ReturnType<SiteChatOwnerDeps['readSiteAccess']>>> }

async function authorize(
  deps: SiteChatOwnerDeps,
  req: PluginApiRequest,
  hostId: string,
): Promise<{ caller: Caller } | { status: number; body: Record<string, unknown> }> {
  const token = bearerOf(req)
  if (!token) return { status: 401, body: { error: 'Unauthenticated' } }
  let decoded: { uid: string; staff?: boolean }
  try {
    decoded = await deps.verifyIdToken(token)
  } catch (error) {
    if (deps.isEmailUnverified(error)) {
      return { status: 403, body: { error: 'Verify your email to continue', reason: 'email-unverified' } }
    }
    if (!isRefusedIdToken(error)) throw error
    return { status: 401, body: { error: 'Unauthenticated' } }
  }
  const access = await deps.readSiteAccess(hostId)
  if (!access) return { status: 404, body: { error: 'Unknown site' } }
  const staff = decoded.staff === true
  if (!staff && !access.memberRoles[decoded.uid]) {
    return { status: 403, body: { error: 'You are not a member of this site' } }
  }
  return { caller: { uid: decoded.uid, staff, access } }
}

export function createSiteChatSettingsHandler(deps: SiteChatOwnerDeps): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = req.method === 'POST' ? bodyOf(req) : {}
    const hostId = String((req.method === 'GET' ? req.query['hostId'] : body['hostId']) ?? '')
    if (!HOST_ID.test(hostId)) return res.status(400).json({ error: 'Missing site' })
    try {
      const auth = await authorize(deps, req, hostId)
      if ('status' in auth) return res.status(auth.status).json(auth.body)
      const { caller } = auth
      const canManage = caller.staff || holdsSiteKey(caller.access, caller.uid, 'site.manage')
      const orgId = caller.access.orgId
      const [plan, released] = orgId
        ? await Promise.all([deps.readPlan(orgId), deps.flagOn(orgId)])
        : ['free', false]
      // A released-off feature does not exist; staff preview it.
      if (!released && !caller.staff) return res.status(404).json({ error: 'Not found' })
      const planCredits = siteChatPlanCredits(plan)

      if (req.method === 'GET') {
        const settings = readStoredSiteChatSettings(await deps.readSettings(hostId))
        const answer: SiteChatSettingsAnswer = {
          settings,
          canManage,
          onPlan: siteChatOnPlan(plan),
          released,
          planCredits,
          ceiling: siteChatCeiling(planCredits, settings.monthlyCreditCap),
          month: orgId ? await deps.readMonth(orgId, hostId).catch(() => null) : null,
        }
        return res.status(200).json(answer)
      }

      if (!canManage) return res.status(403).json({ error: siteKeyRefusal('site.manage') })
      if (await deps.siteLocked(hostId)) {
        return res.status(423).json({ error: 'This site is locked and cannot take changes right now.' })
      }
      const result = normalizeSiteChatSettings(body['settings'] ?? SITE_CHAT_DEFAULT_SETTINGS)
      if ('error' in result) return res.status(400).json({ error: result.error })
      if (result.settings.enabled && !siteChatOnPlan(plan)) {
        return res.status(402).json({ error: 'Site chat is included from the Starter plan up.', reason: 'plan' })
      }
      await deps.writeSettings(hostId, result.settings, caller.uid)
      const refreshed = await deps.dropSiteCache(hostId).catch(() => false)
      return res.status(200).json({ settings: result.settings, canManage, refreshed })
    } catch (error) {
      console.error('[ai/site-chat/settings]', error)
      return res.status(500).json({ error: 'That did not go through. Try again.' })
    }
  }
}

export function createSiteChatConversationsHandler(deps: SiteChatOwnerDeps): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const hostId = String(req.query['hostId'] ?? '')
    if (!HOST_ID.test(hostId)) return res.status(400).json({ error: 'Missing site' })
    const id = String(req.query['id'] ?? '')
    if (id && !CONVERSATION_ID.test(id)) return res.status(400).json({ error: 'Unknown conversation' })
    try {
      const auth = await authorize(deps, req, hostId)
      if ('status' in auth) return res.status(auth.status).json(auth.body)
      const orgId = auth.caller.access.orgId
      if (!auth.caller.staff && !(orgId && (await deps.flagOn(orgId)))) {
        return res.status(404).json({ error: 'Not found' })
      }
      if (id) {
        const conversation = await deps.readConversation(hostId, id)
        if (!conversation) return res.status(404).json({ error: 'Unknown conversation' })
        return res.status(200).json(conversation)
      }
      return res.status(200).json({ conversations: await deps.listConversations(hostId, 50) })
    } catch (error) {
      console.error('[ai/site-chat/conversations]', error)
      return res.status(500).json({ error: 'That did not load. Try again.' })
    }
  }
}
