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
 *
 * @jest-environment node
 */

/**
 * The console card's route (AGL-3643): hidden until the app is published,
 * readable by the site's members, and a Zap disconnected by an admin only.
 */

import { memoryZapierHookStore } from '../testing/memory-store'
import { createZapierConsoleHooksHandler, type ZapierConsoleDeps } from './console-hooks'
import type { ZapierHook } from './store'

const APP = 'https://zapier.com/apps/aglyn/integrations'

const hook = (id: string, extra: Partial<ZapierHook> = {}): ZapierHook => ({
  id,
  orgId: 'org1',
  hostId: 'h1',
  events: ['order.paid'],
  targetUrl: `https://hooks.zapier.com/hooks/standard/1/${id}/`,
  keyId: 'key_zap',
  keyName: 'Zapier',
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
  consecutiveFailures: 0,
  ...extra,
})

function setup(overrides: Partial<ZapierConsoleDeps> = {}) {
  const memory = memoryZapierHookStore([hook('a'), hook('elsewhere', { hostId: 'h2' })])
  const deps: ZapierConsoleDeps = {
    verifyIdToken: async (token) => {
      if (token === 'bad') throw new Error('expired')
      return { uid: token }
    },
    readMemberRoles: async (hostId) => (hostId === 'h1' || hostId === 'h2' ? { admin1: 'admin', editor1: 'editor' } : null),
    siteLocked: async () => false,
    store: () => memory.store,
    appUrl: () => APP,
    ...overrides,
  }
  const handler = createZapierConsoleHooksHandler(deps)
  const call = async (method: string, token: string | null, input: Record<string, unknown>) => {
    const out = { statusCode: 0, body: undefined as any }
    const res = {
      status(code: number) {
        out.statusCode = code
        return res
      },
      json(body: unknown) {
        out.body = body
      },
    }
    await handler(
      {
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        query: method === 'GET' ? (input as Record<string, string>) : {},
        body: method === 'GET' ? undefined : input,
        cookies: {},
      } as never,
      res as never,
    )
    return out
  }
  return { ...memory, call }
}

describe('/api/zapier/hooks (AGL-3643)', () => {
  it('answers configured: false, and no hooks, until the app is published', async () => {
    const { call } = setup({ appUrl: () => null })
    const out = await call('GET', 'admin1', { hostId: 'h1' })
    expect(out.statusCode).toBe(200)
    expect(out.body).toEqual({ configured: false, appUrl: null, canManage: false, hooks: [] })
  })

  it('lists the site’s Zaps to a member, without their URLs, and says who may manage them', async () => {
    const { call } = setup()
    const asEditor = await call('GET', 'editor1', { hostId: 'h1' })
    expect(asEditor.statusCode).toBe(200)
    expect(asEditor.body).toMatchObject({ configured: true, appUrl: APP, canManage: false })
    expect(asEditor.body.hooks.map((one: { id: string }) => one.id)).toEqual(['a'])
    expect(JSON.stringify(asEditor.body)).not.toContain('hooks/standard')
    expect((await call('GET', 'admin1', { hostId: 'h1' })).body.canManage).toBe(true)
  })

  it('refuses a stranger, a bad token, no token, an unknown site and a bad host id', async () => {
    const { call } = setup()
    expect((await call('GET', 'stranger', { hostId: 'h1' })).statusCode).toBe(403)
    expect((await call('GET', 'bad', { hostId: 'h1' })).statusCode).toBe(401)
    expect((await call('GET', null, { hostId: 'h1' })).statusCode).toBe(401)
    expect((await call('GET', 'admin1', { hostId: 'nope' })).statusCode).toBe(404)
    expect((await call('GET', 'admin1', { hostId: '../x' })).statusCode).toBe(400)
    expect((await call('PUT', 'admin1', { hostId: 'h1' })).statusCode).toBe(405)
  })

  it('lets a site admin disconnect a Zap of this site only', async () => {
    const { call, hooks } = setup()
    expect((await call('POST', 'editor1', { hostId: 'h1', hookId: 'a' })).statusCode).toBe(403)
    expect((await call('POST', 'admin1', { hostId: 'h1', hookId: 'elsewhere' })).statusCode).toBe(404)
    expect(hooks.has('elsewhere')).toBe(true)
    const out = await call('POST', 'admin1', { hostId: 'h1', hookId: 'a' })
    expect(out.statusCode).toBe(200)
    expect(hooks.has('a')).toBe(false)
  })

  it('refuses a disconnect on a locked site', async () => {
    const { call, hooks } = setup({ siteLocked: async () => true })
    expect((await call('POST', 'admin1', { hostId: 'h1', hookId: 'a' })).statusCode).toBe(423)
    expect(hooks.has('a')).toBe(true)
  })
})
