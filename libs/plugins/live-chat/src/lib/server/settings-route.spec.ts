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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/app-utils/api-plugins'
import { LIVE_CHAT_DEFAULT_SETTINGS } from '../model/settings'
import { createLiveChatSettingsHandler, type LiveChatSettingsDeps } from './settings-route'

const TIDIO_KEY = 'abcdefghijklmnopqrstuvwxyz123456'
const SETTINGS = { ...LIVE_CHAT_DEFAULT_SETTINGS, enabled: true, publicKey: TIDIO_KEY }

class Unverified extends Error {}
class Refused extends Error {
  code = 'auth/id-token-expired'
}

function deps(overrides: Partial<LiveChatSettingsDeps> = {}): LiveChatSettingsDeps {
  return {
    verifyIdToken: jest.fn(async (token: string) => {
      if (token === 'unverified') throw new Unverified()
      if (token === 'bad') throw new Refused()
      if (token === 'outage') throw new Error('auth down')
      return { uid: token, staff: token === 'staff' }
    }),
    isEmailUnverified: (error) => error instanceof Unverified,
    readMemberRoles: jest.fn(async (hostId: string) =>
      hostId === 'h1' ? { admin: 'admin', editor: 'editor' } : null,
    ),
    siteLocked: jest.fn(async () => false),
    readSettings: jest.fn(async () => SETTINGS),
    writeSettings: jest.fn(async () => undefined),
    dropSiteCache: jest.fn(async () => true),
    ...overrides,
  }
}

function call(
  handlerDeps: LiveChatSettingsDeps,
  request: { method: string; token?: string; query?: Record<string, string>; body?: unknown },
) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
  const req = {
    method: request.method,
    headers: request.token ? { authorization: `Bearer ${request.token}` } : {},
    query: request.query ?? {},
    body: request.body,
  } as unknown as PluginApiRequest
  return Promise.resolve(
    createLiveChatSettingsHandler(handlerDeps)(req, res as unknown as PluginApiResponse),
  ).then(() => res)
}

describe('/api/live-chat/settings (AGL-3698)', () => {
  it('lets any member read the settings, and says whether they may change them', async () => {
    const handlerDeps = deps()
    const asEditor = await call(handlerDeps, { method: 'GET', token: 'editor', query: { hostId: 'h1' } })
    expect([asEditor.statusCode, asEditor.body]).toEqual([200, { settings: SETTINGS, canManage: false }])
    const asAdmin = await call(handlerDeps, { method: 'GET', token: 'admin', query: { hostId: 'h1' } })
    expect(asAdmin.body).toEqual({ settings: SETTINGS, canManage: true })
  })

  it('refuses a stranger, a missing token, an unverified email and an unknown site', async () => {
    const handlerDeps = deps()
    expect((await call(handlerDeps, { method: 'GET', token: 'stranger', query: { hostId: 'h1' } })).statusCode).toBe(403)
    expect((await call(handlerDeps, { method: 'GET', query: { hostId: 'h1' } })).statusCode).toBe(401)
    expect((await call(handlerDeps, { method: 'GET', token: 'bad', query: { hostId: 'h1' } })).statusCode).toBe(401)
    const unverified = await call(handlerDeps, { method: 'GET', token: 'unverified', query: { hostId: 'h1' } })
    expect([unverified.statusCode, (unverified.body as { reason: string }).reason]).toEqual([403, 'email-unverified'])
    expect((await call(handlerDeps, { method: 'GET', token: 'admin', query: { hostId: 'h2' } })).statusCode).toBe(404)
    expect((await call(handlerDeps, { method: 'GET', token: 'admin', query: { hostId: '../x' } })).statusCode).toBe(400)
    expect((await call(handlerDeps, { method: 'DELETE', token: 'admin' })).statusCode).toBe(405)
  })

  it('answers an Auth outage as ours, not the caller’s', async () => {
    const answer = await call(deps(), { method: 'GET', token: 'outage', query: { hostId: 'h1' } })
    expect(answer.statusCode).toBe(500)
  })

  it('saves a site admin’s checked settings and drops the site’s cached pages', async () => {
    const handlerDeps = deps()
    const pasted = `<script src="//code.tidio.co/${TIDIO_KEY}.js" async></script>`
    const answer = await call(handlerDeps, {
      method: 'POST',
      token: 'admin',
      body: { hostId: 'h1', settings: { ...SETTINGS, publicKey: pasted, pages: 'only', paths: ['/contact/'] } },
    })
    const saved = { ...SETTINGS, pages: 'only', paths: ['/contact'] }
    expect([answer.statusCode, answer.body]).toEqual([200, { settings: saved, canManage: true, refreshed: true }])
    expect(handlerDeps.writeSettings).toHaveBeenCalledWith('h1', saved, 'admin')
    expect(handlerDeps.dropSiteCache).toHaveBeenCalledWith('h1')
  })

  it('lets staff save, and says so when the cache could not be dropped', async () => {
    const handlerDeps = deps({ readMemberRoles: jest.fn(async () => ({})), dropSiteCache: jest.fn(async () => false) })
    const answer = await call(handlerDeps, { method: 'POST', token: 'staff', body: { hostId: 'h1', settings: SETTINGS } })
    expect(answer.statusCode).toBe(200)
    expect((answer.body as { refreshed: boolean }).refreshed).toBe(false)
  })

  it('refuses a save from an editor, on a locked site, or with a bad key — writing nothing', async () => {
    const handlerDeps = deps()
    const editor = await call(handlerDeps, { method: 'POST', token: 'editor', body: { hostId: 'h1', settings: SETTINGS } })
    expect(editor.statusCode).toBe(403)
    const locked = await call(deps({ siteLocked: jest.fn(async () => true), writeSettings: handlerDeps.writeSettings }), {
      method: 'POST',
      token: 'admin',
      body: { hostId: 'h1', settings: SETTINGS },
    })
    expect(locked.statusCode).toBe(423)
    const junk = await call(handlerDeps, {
      method: 'POST',
      token: 'admin',
      body: { hostId: 'h1', settings: { ...SETTINGS, publicKey: 'nope"><script>' } },
    })
    expect(junk.statusCode).toBe(400)
    expect((junk.body as { error: string }).error).toContain('Tidio public key')
    expect(handlerDeps.writeSettings).not.toHaveBeenCalled()
  })
})
