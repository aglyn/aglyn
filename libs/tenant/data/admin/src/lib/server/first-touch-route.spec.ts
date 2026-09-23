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

const stored: { hosts?: unknown } = {}
const settingsGet = jest.fn(async () => ({ get: (field: string) => (field === 'hosts' ? stored.hosts : undefined) }))
jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({ collection: () => ({ doc: () => ({ get: settingsGet }) }) }),
    }),
  },
}))

import { FIRST_TOUCH_HANDOFF_TTL_MS, openFirstTouch, sealFirstTouch } from './first-touch-handoff'
import {
  builtInHosts,
  firstPartyOrigin,
  invalidateFirstPartyHostsCache,
  resolveFirstPartyHosts,
} from './first-party-hosts'
import {
  firstTouchHandoffResponse,
  firstTouchScriptResponse,
  firstTouchStorageDefault,
} from './first-touch-route'

const NOW = Date.UTC(2026, 8, 23, 20, 0, 0)
const touch = { v: 1, at: NOW - 60_000, host: 'example.com', path: '/pricing', ref: 'www.g2.com' }

const ENV = { ...process.env }
beforeEach(() => {
  process.env = { ...ENV, TOKEN_SIGNING_SECRET: 'test-secret', NEXT_PUBLIC_WORKSPACE_DOMAIN: 'example.com' }
  stored.hosts = ['forum.example.net']
  settingsGet.mockClear()
  invalidateFirstPartyHostsCache()
})
afterAll(() => {
  process.env = ENV
})

describe('the sealed hand-off', () => {
  it('opens what it sealed, re-scrubbed', () => {
    const sealed = sealFirstTouch({ ...touch, email: 'x@y.z' }, NOW)
    expect(sealed?.exp).toBe(NOW + FIRST_TOUCH_HANDOFF_TTL_MS)
    expect(openFirstTouch(sealed?.token, NOW + 1000)).toEqual(touch)
  })

  it('refuses a token that expired, was edited, or came from another secret', () => {
    const sealed = sealFirstTouch(touch, NOW)
    const token = String(sealed?.token)
    expect(openFirstTouch(token, NOW + FIRST_TOUCH_HANDOFF_TTL_MS)).toBeNull()
    const [prefix, payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ touch: { ...touch, ref: 'evil.test' }, exp: NOW + 60_000 })).toString('base64url')
    expect(openFirstTouch(`${prefix}.${forged}.${signature}`, NOW)).toBeNull()
    expect(openFirstTouch(`${prefix}.${payload}.${signature.slice(0, -2)}`, NOW)).toBeNull()
    process.env['TOKEN_SIGNING_SECRET'] = 'another-secret'
    expect(openFirstTouch(token, NOW)).toBeNull()
  })

  it('fails closed with no secret configured, and seals nothing invalid', () => {
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(sealFirstTouch(touch, NOW)).toBeNull()
    process.env['TOKEN_SIGNING_SECRET'] = 'test-secret'
    expect(sealFirstTouch({ v: 2 }, NOW)).toBeNull()
    expect(openFirstTouch('not.a.token')).toBeNull()
    expect(openFirstTouch(42)).toBeNull()
  })
})

describe('the registry a server reads', () => {
  it('serves the built-in list plus what staff configured, from one read per TTL', async () => {
    const hosts = await resolveFirstPartyHosts(NOW)
    expect(hosts).toEqual(expect.arrayContaining(['example.com', '*.example.com', 'forum.example.net']))
    await resolveFirstPartyHosts(NOW + 1000)
    expect(settingsGet).toHaveBeenCalledTimes(1)
  })

  it('keeps serving the built-in list when the settings cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    settingsGet.mockRejectedValueOnce(new Error('unavailable'))
    const hosts = await resolveFirstPartyHosts(NOW)
    expect(hosts).toEqual(builtInHosts())
    expect(hosts).toContain('*.example.com')
  })

  it('answers CORS only for a secure origin on a registered host', () => {
    const hosts = ['example.com', '*.example.com']
    expect(firstPartyOrigin('https://docs.example.com', hosts)).toBe('https://docs.example.com')
    expect(firstPartyOrigin('http://docs.example.com', hosts)).toBeNull()
    expect(firstPartyOrigin('https://example.com.evil.test', hosts)).toBeNull()
    expect(firstPartyOrigin('https://docs.example.com/path', hosts)).toBeNull()
    expect(firstPartyOrigin(null, hosts)).toBeNull()
  })
})

describe('the storage default for a surface with no consent code', () => {
  const headers = (entries: Record<string, string>) => new Headers(entries)

  it('follows a recorded answer first, whatever the region', () => {
    const accepted = encodeURIComponent(JSON.stringify({ v: 1, at: 1, status: 'accepted' }))
    const declined = encodeURIComponent(JSON.stringify({ v: 1, at: 1, status: 'declined' }))
    expect(firstTouchStorageDefault(headers({ cookie: `aglyn_consent=${accepted}`, 'x-vercel-ip-country': 'DE' }))).toBe(true)
    expect(firstTouchStorageDefault(headers({ cookie: `aglyn_consent=${declined}`, 'x-vercel-ip-country': 'US' }))).toBe(false)
  })

  it('honors Global Privacy Control, then the region’s posture', () => {
    expect(firstTouchStorageDefault(headers({ 'sec-gpc': '1', 'x-vercel-ip-country': 'US' }))).toBe(false)
    expect(firstTouchStorageDefault(headers({ 'x-vercel-ip-country': 'AU' }))).toBe(true)
    expect(firstTouchStorageDefault(headers({ 'x-vercel-ip-country': 'FR' }))).toBeNull()
    expect(firstTouchStorageDefault(headers({ 'x-vercel-ip-country': 'CH' }))).toBeNull()
    // No region at all is treated as a region that asks first.
    expect(firstTouchStorageDefault(headers({}))).toBeNull()
  })

  it('does not let a hand-edited cookie grant what its status does not', () => {
    const edited = encodeURIComponent(JSON.stringify({ v: 1, at: 1, status: 'declined', analytics: true }))
    expect(firstTouchStorageDefault(headers({ cookie: `aglyn_consent=${edited}` }))).toBe(false)
  })
})

describe('the route', () => {
  it('serves the capture configured for this install, never from a shared cache', async () => {
    const response = await firstTouchScriptResponse(
      new Request('https://app.example.com/api/first-touch', { headers: { 'x-vercel-ip-country': 'AU' } }),
    )
    expect(response.headers.get('content-type')).toMatch(/javascript/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const script = await response.text()
    expect(script).toContain('"handoffUrl":"https://app.example.com/api/first-touch"')
    expect(script).toContain('"storage":true')
    expect(script).toContain('forum.example.net')
  })

  it('seals and opens for a first-party origin only', async () => {
    const post = (origin: string | null, body: unknown) =>
      firstTouchHandoffResponse(
        new Request('https://app.example.com/api/first-touch', {
          method: 'POST',
          headers: origin ? { origin, 'content-type': 'text/plain' } : { 'content-type': 'text/plain' },
          body: JSON.stringify(body),
        }),
      )
    const sealed = await post('https://docs.example.com', { seal: touch })
    expect(sealed.status).toBe(200)
    expect(sealed.headers.get('access-control-allow-origin')).toBe('https://docs.example.com')
    const { token } = await sealed.json()
    const opened = await post('https://forum.example.net', { open: token })
    expect((await opened.json()).touch).toEqual(touch)

    expect((await post('https://evil.test', { seal: touch })).status).toBe(403)
    expect((await post(null, { seal: touch })).status).toBe(403)
    expect((await post('https://docs.example.com', { open: 'forged' })).status).toBe(400)
    expect((await post('https://docs.example.com', { nothing: true })).status).toBe(400)
  })
})
