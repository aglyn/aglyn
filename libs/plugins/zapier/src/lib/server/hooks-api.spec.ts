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
 * `/v1/sites/{siteId}/hooks` (AGL-3643): what a subscribe asks — the scope
 * and plan of every event, a Zapier URL — and that a hook is only ever its
 * own organization's and site's.
 */

import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { memoryZapierHookStore } from '../testing/memory-store'
import { createZapierHooksHandler, zapierTargetRefusal } from './hooks-api'
import type { ZapierHook } from './store'

const NOW = Date.UTC(2026, 9, 7, 12)
const TARGET = 'https://hooks.zapier.com/hooks/standard/123/abc/'

const BUSINESS = { plan: 'business' }

const ctx = (overrides: Partial<ApiV1Context> = {}): ApiV1Context =>
  ({
    orgId: 'org1',
    keyId: 'key_zap',
    keyName: 'Zapier',
    scopes: ['orders:read', 'bookings:read', 'contacts:read', 'forms:read'],
    org: BUSINESS,
    firestore: {} as never,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }) as ApiV1Context

function setup(seed: ZapierHook[] = []) {
  const memory = memoryZapierHookStore(seed)
  const handle = createZapierHooksHandler({ store: () => memory.store, now: () => NOW })
  const call = (method: string, path: string, body?: unknown, context = ctx()) => {
    const request = new Request(`https://app.aglyn.com/api${path}`, {
      method,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })
    const segments = new URL(request.url).pathname.replace('/api/v1/', '').split('/').filter(Boolean)
    return handle(request, context, segments)
  }
  return { ...memory, call }
}

const hook = (id: string, extra: Partial<ZapierHook> = {}): ZapierHook => ({
  id,
  orgId: 'org1',
  hostId: 'h1',
  events: ['order.paid'],
  targetUrl: `${TARGET}${id}`,
  keyId: 'key_zap',
  keyName: 'Zapier',
  createdAtMs: NOW - 1000,
  updatedAtMs: NOW - 1000,
  consecutiveFailures: 0,
  ...extra,
})

describe('POST /v1/sites/{siteId}/hooks (AGL-3643)', () => {
  it('subscribes a hook to the events asked, and answers it without its URL', async () => {
    const { call, hooks } = setup()
    const response = await call('POST', '/v1/sites/h1/hooks', {
      targetUrl: TARGET,
      events: ['order.fulfilled', 'order.paid', 'order.paid'],
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    const body = await response.json()
    expect(body).toMatchObject({
      object: 'hook',
      siteId: 'h1',
      events: ['order.paid', 'order.fulfilled'],
      target: 'hooks.zapier.com',
      keyName: 'Zapier',
      created: new Date(NOW).toISOString(),
    })
    expect(JSON.stringify(body)).not.toContain('/hooks/standard/')
    const stored = hooks.get(body.id)
    expect(stored).toMatchObject({ orgId: 'org1', hostId: 'h1', keyId: 'key_zap', targetUrl: TARGET })
  })

  it('takes one `event` as well as `events`', async () => {
    const { call } = setup()
    const response = await call('POST', '/v1/sites/h1/hooks', { targetUrl: TARGET, event: 'form.submitted' })
    expect(response.status).toBe(201)
    expect((await response.json()).events).toEqual(['form.submitted'])
  })

  it('answers a Zap re-subscribing the same URL with its hook, the events replaced', async () => {
    const { call, hooks } = setup([hook('h_old', { targetUrl: TARGET })])
    const response = await call('POST', '/v1/sites/h1/hooks', { targetUrl: TARGET, events: ['order.refunded'] })
    expect(response.status).toBe(200)
    expect((await response.json()).id).toBe('h_old')
    expect(hooks.size).toBe(1)
    expect(hooks.get('h_old')?.events).toEqual(['order.refunded'])
  })

  it('refuses a key without every event’s scope, naming the scope', async () => {
    const { call, hooks } = setup()
    const response = await call(
      'POST',
      '/v1/sites/h1/hooks',
      { targetUrl: TARGET, events: ['form.submitted', 'booking.created'] },
      ctx({ scopes: ['forms:read'] }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'bookings:read' })
    expect(hooks.size).toBe(0)
  })

  it('refuses an event whose records the plan does not include', async () => {
    const { call } = setup()
    const response = await call(
      'POST',
      '/v1/sites/h1/hooks',
      { targetUrl: TARGET, events: ['order.paid'] },
      ctx({ org: { plan: 'free' } as never }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'plan_required', code: 'commerce' })
  })

  it('posts nowhere but Zapier, over https', async () => {
    const { call } = setup()
    for (const targetUrl of [
      'https://example.com/hook',
      'http://hooks.zapier.com/hooks/standard/1/a/',
      'https://hooks.zapier.com.evil.example/x',
      '',
    ]) {
      const response = await call('POST', '/v1/sites/h1/hooks', { targetUrl, events: ['order.paid'] })
      expect(response.status).toBe(400)
      expect((await response.json()).error.fields).toHaveProperty('targetUrl')
    }
    expect(zapierTargetRefusal(TARGET)).toBeNull()
  })

  it('refuses an unknown event, an empty list and a body that is not JSON', async () => {
    const { call } = setup()
    const unknown = await call('POST', '/v1/sites/h1/hooks', { targetUrl: TARGET, events: ['order.paid', 'order.exploded'] })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error.message).toContain('order.exploded')
    expect((await call('POST', '/v1/sites/h1/hooks', { targetUrl: TARGET, events: [] })).status).toBe(400)
    expect((await call('POST', '/v1/sites/h1/hooks', 'not json')).status).toBe(400)
  })

  it('holds a site to its limit', async () => {
    const seed = Array.from({ length: 100 }, (_, index) => hook(`h${index}`))
    const { call } = setup(seed)
    const response = await call('POST', '/v1/sites/h1/hooks', { targetUrl: TARGET, events: ['order.paid'] })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('hook_limit')
  })
})

describe('GET and DELETE /v1/sites/{siteId}/hooks/{id} (AGL-3643)', () => {
  it('lists the site’s hooks of this organization only, newest first, without URLs', async () => {
    const { call } = setup([
      hook('a', { createdAtMs: NOW - 5000 }),
      hook('b', { createdAtMs: NOW - 1000 }),
      hook('theirs', { orgId: 'org2' }),
      hook('other-site', { hostId: 'h2' }),
    ])
    const response = await call('GET', '/v1/sites/h1/hooks')
    const body = await response.json()
    expect(body.object).toBe('list')
    expect(body.data.map((one: { id: string }) => one.id)).toEqual(['b', 'a'])
    expect(JSON.stringify(body)).not.toContain('hooks/standard')
  })

  it('reads and removes its own hook, and answers 404 for another org’s or site’s', async () => {
    const { call, hooks } = setup([hook('mine'), hook('theirs', { orgId: 'org2' }), hook('elsewhere', { hostId: 'h2' })])
    expect((await call('GET', '/v1/sites/h1/hooks/mine')).status).toBe(200)
    expect((await call('GET', '/v1/sites/h1/hooks/theirs')).status).toBe(404)
    expect((await call('DELETE', '/v1/sites/h1/hooks/elsewhere')).status).toBe(404)
    const removed = await call('DELETE', '/v1/sites/h1/hooks/mine')
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ id: 'mine', object: 'hook', deleted: true })
    expect([...hooks.keys()].sort()).toEqual(['elsewhere', 'theirs'])
  })

  it('removes a hook only with a key that could have made it', async () => {
    const { call, hooks } = setup([hook('mine', { events: ['booking.created'] })])
    const response = await call('DELETE', '/v1/sites/h1/hooks/mine', undefined, ctx({ scopes: ['orders:read'] }))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('bookings:read')
    expect(hooks.has('mine')).toBe(true)
  })

  it('answers the methods it serves and no deeper path', async () => {
    const { call } = setup([hook('mine')])
    const put = await call('PATCH', '/v1/sites/h1/hooks')
    expect(put.status).toBe(405)
    expect(put.headers.get('Allow')).toBe('GET, POST')
    const patch = await call('PATCH', '/v1/sites/h1/hooks/mine')
    expect(patch.status).toBe(405)
    expect(patch.headers.get('Allow')).toBe('GET, DELETE')
    expect((await call('GET', '/v1/sites/h1/hooks/mine/deliveries')).status).toBe(404)
  })
})
