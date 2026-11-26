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

import type { RegisteredSiteChatTool } from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import type { AiStreamEvent } from '../providers/contract'
import { siteChatCookieName, type SiteChatEvent } from '../model/site-chat'
import { createSiteChatHandler, mentionedCards, type SiteChatDeps, type SiteChatSite } from './site-chat'
import { mintSiteChatSession } from './site-chat-session'

const SECRET = 'spec-secret'

const site: SiteChatSite = {
  host: { $id: 'host-1', orgId: 'org-1' },
  orgId: 'org-1',
  org: {},
  plan: 'starter',
  timeZone: 'America/Chicago',
  enabledPlugins: ['commerce'],
}

const done = (input = 100, output = 40): AiStreamEvent => ({
  type: 'done',
  usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0.001,
  stopReason: 'end_turn',
})

async function* events(list: AiStreamEvent[]): AsyncIterable<AiStreamEvent> {
  for (const event of list) yield event
}

function makeDeps(overrides: Partial<SiteChatDeps> = {}) {
  const calls = {
    stream: [] as Parameters<SiteChatDeps['stream']>[0][],
    settled: [] as Parameters<SiteChatDeps['settleTurn']>[2][],
    appended: [] as unknown[],
    released: 0,
    limits: [] as string[],
  }
  const rounds: AiStreamEvent[][] = [[{ type: 'delta', text: 'We are open 9 to 4. See [Hours](/visit).' }, done()]]
  const deps: SiteChatDeps = {
    readSite: async (hostId) => (hostId === 'host-1' ? site : null),
    flagOn: async () => true,
    aiOnForSite: () => true,
    readSettings: async () => ({ enabled: true, greeting: 'Hi!', capabilities: ['answer', 'cart'], pages: 'all' }),
    providerReady: () => true,
    secret: () => SECRET,
    rateLimit: async (key) => {
      calls.limits.push(key)
      return true
    },
    holdTurn: async () => ({ allowed: true, month: '2026-11', held: 40 }),
    settleTurn: async (_site, _hold, outcome) => {
      calls.settled.push(outcome)
    },
    reserveBand: async () => ({
      allowed: true,
      release: async () => {
        calls.released += 1
      },
    }),
    recordCost: async () => 3,
    businessBlock: async () => 'Business name: Acme Ranch',
    sections: async () => [{ url: '/visit', title: 'Visit', heading: 'Hours', text: 'Open 9 to 4.' }],
    candidates: async () => [],
    tools: async () => [],
    member: async () => null,
    readTurns: async () => [],
    appendTurns: async (...args) => {
      calls.appended.push(args)
    },
    model: () => 'spec-model',
    stream: async (request) => {
      calls.stream.push(request)
      return events(rounds.shift() ?? [done()])
    },
    clientAddress: () => '203.0.113.9',
    now: () => new Date('2026-11-26T15:00:00Z'),
    ...overrides,
  }
  return { deps, calls, rounds }
}

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request('https://acme.example.com/api/ai/site-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

async function readEvents(response: Response): Promise<SiteChatEvent[]> {
  const text = await response.text()
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)) as SiteChatEvent)
}

const ask = { hostId: 'host-1', message: 'What are your hours?', path: '/' }

describe('the site chat door (AGL-4250)', () => {
  it('refuses anything but a POST, and a body with no question', async () => {
    const { deps } = makeDeps()
    const handler = createSiteChatHandler(deps)
    expect((await handler(new Request('https://acme.example.com/api/ai/site-chat'))).status).toBe(405)
    expect((await handler(post({ hostId: 'host-1', message: '' }))).status).toBe(400)
    expect((await handler(post({ hostId: 'host-1', message: 'x'.repeat(1_001) }))).status).toBe(400)
    expect((await handler(post({ hostId: 'not/an/id', message: 'hi' }))).status).toBe(400)
  })

  it.each([
    ['an unknown site', { readSite: async () => null }],
    ['the release flag off', { flagOn: async () => false }],
    ['AI off for the site', { aiOnForSite: () => false }],
    ['the owner switch off', { readSettings: async () => ({ enabled: false }) }],
    ['a Free workspace', { readSite: async () => ({ ...site, plan: 'free' }) }],
    ['a page the chat does not show on', { readSettings: async () => ({ enabled: true, pages: 'only', paths: ['/shop/*'] }) }],
  ])('answers 404 for %s, spending nothing', async (_label, override) => {
    const { deps, calls } = makeDeps(override as Partial<SiteChatDeps>)
    const response = await createSiteChatHandler(deps)(post(ask))
    expect(response.status).toBe(404)
    expect(calls.stream).toHaveLength(0)
  })

  it('refuses with 503 when no provider is configured', async () => {
    const { deps } = makeDeps({ providerReady: () => false })
    expect((await createSiteChatHandler(deps)(post(ask))).status).toBe(503)
  })

  it('counts the visitor address, the session, the site and the conversation, and refuses past any', async () => {
    const { deps, calls } = makeDeps()
    await (await createSiteChatHandler(deps)(post(ask))).text()
    expect(calls.limits.map((key) => key.split(':').slice(0, 2).join(':'))).toEqual([
      'site-chat:ip',
      'site-chat:session',
      'site-chat:site',
      'site-chat:conversation',
    ])
    const refused = makeDeps({ rateLimit: async (key) => !key.startsWith('site-chat:ip') })
    const response = await createSiteChatHandler(refused.deps)(post(ask))
    expect(response.status).toBe(429)
    expect(refused.calls.stream).toHaveLength(0)
  })

  it('fails closed on credits: a spent allotment, a refused band, or a meter that cannot answer', async () => {
    for (const override of [
      { holdTurn: async () => ({ allowed: false, month: '2026-11', held: 0, refusedBy: 'site' as const }) },
      { holdTurn: async () => Promise.reject(new Error('store down')) },
      { reserveBand: async () => ({ allowed: false, release: async () => undefined }) },
    ]) {
      const { deps, calls } = makeDeps(override as Partial<SiteChatDeps>)
      const response = await createSiteChatHandler(deps)(post(ask))
      expect(response.status).toBe(503)
      expect((await response.json()).reason).toBe('credits')
      expect(calls.stream).toHaveLength(0)
    }
  })

  it('mints a site-bound session cookie for a new visitor and keeps a returning one', async () => {
    const { deps } = makeDeps()
    const handler = createSiteChatHandler(deps)
    const fresh = await handler(post(ask))
    expect(fresh.headers.get('set-cookie')).toMatch(/^aglyn_chat_host-1=sc1\..*HttpOnly; SameSite=Lax; Secure$/)
    const { token } = mintSiteChatSession('host-1', SECRET, Date.parse('2026-11-26T00:00:00Z'))
    const returning = await handler(post(ask, { cookie: `${siteChatCookieName('host-1')}=${token}` }))
    expect(returning.headers.get('set-cookie')).toBeNull()
  })

  it('streams the answer in the Assist wire shape, with the pages it used, and stores and meters the turn', async () => {
    const { deps, calls } = makeDeps()
    const response = await createSiteChatHandler(deps)(post(ask))
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)
    const sent = await readEvents(response)
    expect(sent[0]).toEqual({ type: 'delta', text: 'We are open 9 to 4. See [Hours](/visit).' })
    expect(sent.at(-1)).toMatchObject({ type: 'done', sources: [{ title: 'Visit', url: '/visit' }] })
    // The page text reached the model as quoted data, after the rules.
    const system = calls.stream[0].system
    expect(system[0].cacheBreakpoint).toBe(true)
    expect(system.at(-1)?.volatile).toBe(true)
    expect(system.at(-1)?.text).toContain('<data kind="page" url="/visit"')
    expect(system.at(-1)?.text).toContain('Today is Thursday, November 26, 2026')
    expect(calls.settled).toEqual([{ spent: 3, answered: true, proposals: 0, newConversation: true }])
    expect(calls.appended).toHaveLength(1)
  })

  it('runs a lookup the model asks for on this site only, then answers from what it found', async () => {
    const run = jest.fn(async () => ({ text: 'Lakeside cabin is free Dec 11 to 13: $300.' }))
    const tools: RegisteredSiteChatTool[] = [
      {
        pluginId: 'commerce',
        tool: { name: 'commerce_stay_availability', kind: 'lookup', capability: 'answer', description: 'd', inputSchema: { type: 'object', properties: {} }, run },
      },
    ]
    const { deps, calls, rounds } = makeDeps({ tools: async () => tools })
    rounds.splice(0, rounds.length, [{ type: 'tool', name: 'commerce_stay_availability', input: { stay: 'Lakeside' } }, done()], [
      { type: 'delta', text: 'Yes, it is free.' },
      done(),
    ])
    const sent = await readEvents(await createSiteChatHandler(deps)(post({ ...ask, message: 'Is the cabin free Dec 11-13?' })))
    expect(run).toHaveBeenCalledWith({ hostId: 'host-1', input: { stay: 'Lakeside' }, timeZone: 'America/Chicago' })
    expect(calls.stream).toHaveLength(2)
    expect(calls.stream[1].system.at(-1)?.text).toContain('<data kind="tool" name="commerce_stay_availability">Lakeside cabin is free')
    expect(sent.filter((event) => event.type === 'delta').map((event) => (event as { text: string }).text).join('')).toContain(
      'Yes, it is free.',
    )
  })

  it('sends a proposal as a confirm card only when its request is one the tool declared', async () => {
    const proposal = {
      kind: 'add-to-cart' as const,
      title: 'Add Day pass?',
      summary: '1 × $45',
      confirmLabel: 'Add to cart',
      request: { path: 'commerce/cart', body: { hostId: 'host-1', productId: 'p1' } },
    }
    const make = (path: string): RegisteredSiteChatTool[] => [
      {
        pluginId: 'commerce',
        tool: {
          name: 'commerce_propose_add_to_cart',
          kind: 'proposal',
          capability: 'cart',
          endpoints: ['commerce/cart'],
          description: 'd',
          inputSchema: { type: 'object', properties: {} },
          run: async () => ({ text: 'offered', proposal: { ...proposal, request: { ...proposal.request, path } } }),
        },
      },
    ]
    for (const [path, shown] of [
      ['commerce/cart', true],
      ['commerce/cart-checkout', false],
      ['https://evil.example/api/x', false],
    ] as const) {
      const { deps, rounds } = makeDeps({ tools: async () => make(path) })
      rounds.splice(0, rounds.length, [
        { type: 'delta', text: 'Here you go.' },
        { type: 'tool', name: 'commerce_propose_add_to_cart', input: { product: 'Day pass' } },
        done(),
      ])
      const sent = await readEvents(await createSiteChatHandler(deps)(post({ ...ask, message: 'Add a day pass' })))
      expect(sent.some((event) => event.type === 'proposal')).toBe(shown)
    }
  })

  it('offers only the tools the owner allowed, and the hand-off only when it is on', async () => {
    const asked: unknown[] = []
    const { deps, calls } = makeDeps({
      readSettings: async () => ({ enabled: true, capabilities: ['answer'], handOff: false }),
      tools: async (_site, allowed) => {
        asked.push(allowed)
        return []
      },
    })
    await (await createSiteChatHandler(deps)(post(ask))).text()
    expect(asked).toEqual([['answer']])
    expect(calls.stream[0].tools).toBeUndefined()
  })

  it('hands the hold back when the provider fails before answering', async () => {
    const { deps, calls } = makeDeps({ stream: async () => Promise.reject(new Error('upstream')) })
    const sent = await readEvents(await createSiteChatHandler(deps)(post(ask)))
    expect(sent).toEqual([expect.objectContaining({ type: 'error', reason: 'upstream' })])
    expect(calls.settled).toEqual([{ spent: 0, answered: false, proposals: 0, newConversation: true }])
    expect(calls.released).toBe(1)
    expect(calls.appended).toHaveLength(0)
  })
})

describe('the cards an answer shows', () => {
  it('shows a listing only when the answer names it or links it', () => {
    const cards = [
      { kind: 'product' as const, title: 'Adult day pass', url: '/products/adult-day-pass' },
      { kind: 'product' as const, title: 'Pit bike rental', url: '/products/pit-bike' },
    ]
    expect(mentionedCards(cards, 'The Adult day pass is $45.')).toEqual([cards[0]])
    expect(mentionedCards(cards, 'See [rentals](/products/pit-bike).')).toEqual([cards[1]])
    expect(mentionedCards(cards, 'We open at 9.')).toEqual([])
  })
})
