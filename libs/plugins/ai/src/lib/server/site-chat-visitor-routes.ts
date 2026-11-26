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

import { siteChatCookieName, type SiteChatTurn } from '../model/site-chat'
import { readRequestCookie, verifySiteChatSession } from './site-chat-session'

/**
 * The visitor's two small doors beside the chat (AGL-4250), each answering
 * only for the conversation the visitor's own signed session names:
 *
 * - `GET ai/site-chat/history?hostId=` — the conversation so far, and the
 *   signed-in member's first name for the greeting. No session, no history:
 *   an empty answer, never another visitor's.
 * - `POST ai/site-chat/handoff` — "have someone reply": the visitor's email
 *   and question, kept on the conversation for the site's team, who see it
 *   flagged in the console's conversations. Nothing is sent to the visitor.
 */

export interface SiteChatVisitorDeps {
  secret: () => string
  /** The site is live for chat (the same rungs as the door), with its plugins. */
  siteOn: (hostId: string) => Promise<{ enabledPlugins: readonly string[] } | null>
  readTurns: (hostId: string, conversationId: string) => Promise<SiteChatTurn[]>
  member: (request: Request, hostId: string, enabledPlugins: readonly string[]) => Promise<{ name: string } | null>
  saveHandOff: (hostId: string, conversationId: string, handOff: { email: string; question: string }) => Promise<void>
  rateLimit: (key: string, limit: number, windowMs: number) => Promise<boolean>
}

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status })

/** The visitor's own session on this site; `null` for none, or no secret to check it with. */
function readSession(request: Request, hostId: string, deps: Pick<SiteChatVisitorDeps, 'secret'>) {
  try {
    return verifySiteChatSession(readRequestCookie(request, siteChatCookieName(hostId)), hostId, deps.secret())
  } catch {
    return null
  }
}

export function createSiteChatHistoryHandler(deps: SiteChatVisitorDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' })
    const hostId = new URL(request.url).searchParams.get('hostId') ?? ''
    if (!HOST_ID.test(hostId)) return json(400, { error: 'Missing site' })
    const site = await deps.siteOn(hostId)
    if (!site) return json(404, { error: 'Not found' })
    const member = await deps.member(request, hostId, site.enabledPlugins).catch(() => null)
    const session = readSession(request, hostId, deps)
    const turns = session ? await deps.readTurns(hostId, session.sid).catch(() => []) : []
    return Response.json({ turns: turns.slice(-30), member }, { headers: { 'Cache-Control': 'no-store' } })
  }
}

export function createSiteChatHandOffHandler(deps: SiteChatVisitorDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })
    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return json(400, { error: 'Bad request' })
    }
    const hostId = typeof body['hostId'] === 'string' ? body['hostId'] : ''
    const email = typeof body['email'] === 'string' ? body['email'].trim() : ''
    const question = typeof body['question'] === 'string' ? body['question'].trim().slice(0, 1_000) : ''
    if (!HOST_ID.test(hostId)) return json(400, { error: 'Missing site' })
    if (!EMAIL.test(email)) return json(400, { error: 'Enter your email address.' })
    if (!question) return json(400, { error: 'Add your question.' })
    if (!(await deps.siteOn(hostId))) return json(404, { error: 'Not found' })
    const session = readSession(request, hostId, deps)
    // A hand-off belongs to a conversation: one the visitor started here.
    if (!session) return json(400, { error: 'Ask your question in the chat first.' })
    if (!(await deps.rateLimit(`site-chat:handoff:${hostId}:${session.sid}`, 3, 24 * 60 * 60 * 1000))) {
      return json(429, { error: 'Your message is already with the team.' })
    }
    await deps.saveHandOff(hostId, session.sid, { email, question })
    return json(200, { ok: true })
  }
}
