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
 * Delivering an event to a site's hooks (AGL-3643): at least once, never
 * twice to a hook that took it, and every delivery asking again whether the
 * key, the plan and the site still allow it.
 */

import { memoryZapierHookStore } from '../testing/memory-store'
import { deliverToZapierHooks, type ZapierDeliveryDeps, type ZapierDeliveryInput, type ZapierPostResult } from './deliver'
import type { ZapierHook } from './store'

const NOW = Date.UTC(2026, 9, 7, 12)

const hook = (id: string, extra: Partial<ZapierHook> = {}): ZapierHook => ({
  id,
  orgId: 'org1',
  hostId: 'h1',
  events: ['order.paid'],
  targetUrl: `https://hooks.zapier.com/hooks/standard/1/${id}/`,
  keyId: 'key_zap',
  keyName: 'Zapier',
  createdAtMs: NOW - 60_000,
  updatedAtMs: NOW - 60_000,
  consecutiveFailures: 0,
  ...extra,
})

const ORG = { plan: 'business', hosts: { h1: true } }

const input = (extra: Partial<ZapierDeliveryInput> = {}): ZapierDeliveryInput => ({
  eventId: 'evt_1',
  event: 'order.paid',
  hostId: 'h1',
  occurredAtMs: NOW - 1000,
  attempt: 1,
  data: { order: { id: 'o1', object: 'order', number: 1042 } },
  ...extra,
})

function setup(
  seed: ZapierHook[],
  options: {
    answer?: (url: string) => ZapierPostResult
    org?: Record<string, unknown> | null
    grant?: { scopes: string[] } | null
  } = {},
) {
  const memory = memoryZapierHookStore(seed)
  const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = []
  const deps: ZapierDeliveryDeps = {
    store: memory.store,
    post: async (url, body, headers) => {
      posts.push({ url, body, headers })
      return options.answer ? options.answer(url) : { status: 200 }
    },
    readGrant: async () => (options.grant === undefined ? { scopes: ['orders:read', 'contacts:read'] } : options.grant),
    readOrg: async () => (options.org === undefined ? ORG : options.org),
    now: () => NOW,
    maxAttempts: 8,
  }
  return { ...memory, deps, posts }
}

describe('deliverToZapierHooks (AGL-3643)', () => {
  it('posts the event to every hook of the site that takes it, in the webhook body shape', async () => {
    const { deps, posts, hooks } = setup([
      hook('a'),
      hook('b', { events: ['order.paid', 'order.refunded'] }),
      hook('other-event', { events: ['order.refunded'] }),
      hook('other-site', { hostId: 'h2' }),
    ])
    const result = await deliverToZapierHooks(deps, input())
    expect(result).toEqual({ delivered: 2, failed: 0, paused: 0, removed: 0 })
    expect(posts.map((post) => post.url).sort()).toEqual([
      'https://hooks.zapier.com/hooks/standard/1/a/',
      'https://hooks.zapier.com/hooks/standard/1/b/',
    ])
    expect(JSON.parse(posts[0].body)).toEqual({
      id: 'evt_1',
      type: 'order.paid',
      createdAt: new Date(NOW - 1000).toISOString(),
      siteId: 'h1',
      data: { order: { id: 'o1', object: 'order', number: 1042 } },
    })
    expect(posts[0].headers).toMatchObject({ 'Aglyn-Event': 'order.paid', 'Aglyn-Event-Id': 'evt_1' })
    expect(hooks.get('a')).toMatchObject({ lastDeliveryStatus: 'delivered', lastDeliveryAtMs: NOW, consecutiveFailures: 0 })
  })

  it('does not post an event to a hook made after it happened', async () => {
    const { deps, posts } = setup([hook('late', { createdAtMs: NOW })])
    expect(await deliverToZapierHooks(deps, input())).toEqual({ delivered: 0, failed: 0, paused: 0, removed: 0 })
    expect(posts).toEqual([])
  })

  it('on a retry, posts only to the hooks that did not take it, and throws until they all have', async () => {
    let failing = true
    const { deps, posts, hooks } = setup([hook('ok'), hook('down')], {
      answer: (url) => (url.includes('/down/') && failing ? { status: 500 } : { status: 200 }),
    })
    await expect(deliverToZapierHooks(deps, input())).rejects.toThrow(/1 of 2 Zapier hooks did not take order.paid/)
    expect(hooks.get('down')).toMatchObject({ lastDeliveryStatus: 'failed', consecutiveFailures: 1 })
    failing = false
    posts.length = 0
    const second = await deliverToZapierHooks(deps, input({ attempt: 2 }))
    expect(second).toEqual({ delivered: 2, failed: 0, paused: 0, removed: 0 })
    expect(posts.map((post) => post.url)).toEqual(['https://hooks.zapier.com/hooks/standard/1/down/'])
    expect(hooks.get('down')).toMatchObject({ lastDeliveryStatus: 'delivered', consecutiveFailures: 0 })
  })

  it('stops throwing on the outbox’s last attempt and leaves the failure on the hook', async () => {
    const { deps, hooks } = setup([hook('down', { consecutiveFailures: 7 })], {
      answer: () => ({ status: null, error: 'No answer within 10 seconds' }),
    })
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await deliverToZapierHooks(deps, input({ attempt: 8 }))
    errors.mockRestore()
    expect(result).toEqual({ delivered: 0, failed: 1, paused: 0, removed: 0 })
    expect(hooks.get('down')).toMatchObject({ lastDeliveryStatus: 'failed', consecutiveFailures: 8 })
  })

  it('removes a hook whose Zap is gone (410)', async () => {
    const { deps, hooks } = setup([hook('gone')], { answer: () => ({ status: 410 }) })
    expect(await deliverToZapierHooks(deps, input())).toEqual({ delivered: 0, failed: 0, paused: 0, removed: 1 })
    expect(hooks.has('gone')).toBe(false)
  })

  it('removes the hooks of a revoked key, one whose key lost the scope, and a site the org no longer owns', async () => {
    const revoked = setup([hook('a')], { grant: null })
    expect((await deliverToZapierHooks(revoked.deps, input())).removed).toBe(1)
    expect(revoked.posts).toEqual([])
    expect(revoked.hooks.size).toBe(0)

    const narrowed = setup([hook('a')], { grant: { scopes: ['contacts:read'] } })
    expect((await deliverToZapierHooks(narrowed.deps, input())).removed).toBe(1)
    expect(narrowed.posts).toEqual([])

    const moved = setup([hook('a')], { org: { plan: 'business', hosts: { other: true } } })
    expect((await deliverToZapierHooks(moved.deps, input())).removed).toBe(1)
    expect(moved.posts).toEqual([])
  })

  it('pauses, and keeps, the hooks of an org whose plan lapsed', async () => {
    const lapsed = setup([hook('a')], { org: { plan: 'free', hosts: { h1: true } } })
    expect(await deliverToZapierHooks(lapsed.deps, input())).toEqual({ delivered: 0, failed: 0, paused: 1, removed: 0 })
    expect(lapsed.posts).toEqual([])
    expect(lapsed.hooks.has('a')).toBe(true)
  })

  it('asks the key and the org once per event, however many hooks share them', async () => {
    const { deps } = setup([hook('a'), hook('b'), hook('c')])
    const readGrant = jest.spyOn(deps, 'readGrant')
    const readOrg = jest.spyOn(deps, 'readOrg')
    await deliverToZapierHooks(deps, input())
    expect(readGrant).toHaveBeenCalledTimes(1)
    expect(readOrg).toHaveBeenCalledTimes(1)
  })

  it('ignores an event no hook can take', async () => {
    const { deps, posts } = setup([hook('a')])
    expect(await deliverToZapierHooks(deps, input({ event: 'order.exploded' as never }))).toEqual({
      delivered: 0,
      failed: 0,
      paused: 0,
      removed: 0,
    })
    expect(posts).toEqual([])
  })
})
