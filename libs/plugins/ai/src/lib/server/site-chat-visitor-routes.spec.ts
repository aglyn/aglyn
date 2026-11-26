/**
 * @jest-environment node
 */

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

import { mintSiteChatSession } from './site-chat-session'
import {
  createSiteChatHandOffHandler,
  createSiteChatHistoryHandler,
  type SiteChatVisitorDeps,
} from './site-chat-visitor-routes'

const turns = [{ role: 'visitor' as const, text: 'Hours?', at: 1 }]

function makeDeps(overrides: Partial<SiteChatVisitorDeps> = {}) {
  const saved: unknown[] = []
  const deps: SiteChatVisitorDeps = {
    secret: () => 's',
    siteOn: async (hostId) => (hostId === 'h' ? { enabledPlugins: ['commerce'] } : null),
    readTurns: async () => turns,
    member: async () => ({ name: 'Pat' }),
    saveHandOff: async (...args) => {
      saved.push(args)
    },
    rateLimit: async () => true,
    ...overrides,
  }
  return { deps, saved }
}

const cookie = (hostId: string) => `aglyn_chat_${hostId}=${mintSiteChatSession(hostId, 's').token}`

describe('the site chat visitor doors (AGL-4250)', () => {
  it('hands back only the conversation the visitor\'s own session names', async () => {
    const { deps } = makeDeps()
    const history = createSiteChatHistoryHandler(deps)
    const none = await history(new Request('https://a.example/api/ai/site-chat/history?hostId=h'))
    expect(await none.json()).toEqual({ turns: [], member: { name: 'Pat' } })
    const mine = await history(new Request('https://a.example/api/ai/site-chat/history?hostId=h', { headers: { cookie: cookie('h') } }))
    expect((await mine.json()).turns).toEqual(turns)
    const foreign = await history(new Request('https://a.example/api/ai/site-chat/history?hostId=h', { headers: { cookie: cookie('other').replace('other', 'h') } }))
    expect((await foreign.json()).turns).toEqual([])
  })

  it('answers 404 where the chat is not on', async () => {
    const { deps } = makeDeps()
    const response = await createSiteChatHistoryHandler(deps)(new Request('https://a.example/api/ai/site-chat/history?hostId=x'))
    expect(response.status).toBe(404)
  })

  it('keeps a hand-off on the visitor\'s conversation, and only with a real email and question', async () => {
    const { deps, saved } = makeDeps()
    const handOff = createSiteChatHandOffHandler(deps)
    const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      handOff(new Request('https://a.example/api/ai/site-chat/handoff', { method: 'POST', headers, body: JSON.stringify(body) }))
    expect((await post({ hostId: 'h', email: 'nope', question: 'q' }, { cookie: cookie('h') })).status).toBe(400)
    expect((await post({ hostId: 'h', email: 'pat@example.com', question: 'Call me?' })).status).toBe(400)
    expect((await post({ hostId: 'h', email: 'pat@example.com', question: 'Call me?' }, { cookie: cookie('h') })).status).toBe(200)
    expect(saved).toEqual([['h', expect.stringMatching(/^[0-9a-f]{32}$/), { email: 'pat@example.com', question: 'Call me?' }]])
  })
})
