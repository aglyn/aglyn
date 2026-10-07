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

import type { Firestore } from 'firebase-admin/firestore'
import { deliverPush, EXPO_PUSH_URL, expoPushRelayEnabled, mobilePushEnabled, pushMessage } from './push-delivery'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 7)
const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaa]'
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbb]'

interface FakeDevice {
  token: unknown
  lastSeen?: number
}

/** users/{uid}/devices rows, plus org and host docs for the link rewrite. */
function fakeDb(devices: Record<string, Record<string, FakeDevice>>, docs: Record<string, Record<string, unknown>> = {}) {
  const deleted: string[] = []
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ get: (field: string) => docs[`${name}/${id}`]?.[field] }),
        collection: () => ({
          limit: () => ({
            get: async () => ({
              docs: Object.entries(devices[id] ?? {}).map(([deviceId, row]) => ({
                get: (field: string) => (row as unknown as Record<string, unknown>)[field],
                ref: {
                  delete: async () => {
                    deleted.push(`users/${id}/devices/${deviceId}`)
                  },
                },
              })),
            }),
          }),
        }),
      }),
    }),
  }
  return { db: db as unknown as Firestore, deleted }
}

function fakeFetch(respond: (messages: Array<{ to: string }>) => unknown, status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string>; messages: Array<Record<string, unknown>> }> = []
  const impl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const messages = JSON.parse(init.body)
    calls.push({ url, headers: init.headers, messages })
    return { ok: status < 300, status, json: async () => respond(messages) }
  }) as unknown as typeof fetch
  return { impl, calls }
}

const ORDER = {
  type: 'content.order' as const,
  title: 'New order',
  body: 'Order #1001 was placed.',
  link: '/host-1/orders/o1',
  orgId: 'org-1',
  hostId: 'host-1',
}

const ON = { EXPO_PUSH_RELAY: '1' }

describe('push delivery (AGL-3620)', () => {
  it('is on unless the deployment pulls the kill switch (AGL-3648)', async () => {
    expect(mobilePushEnabled({})).toBe(true)
    expect(mobilePushEnabled({ MOBILE_PUSH_ENABLED: '1' })).toBe(true)
    expect(mobilePushEnabled({ MOBILE_PUSH_ENABLED: '' })).toBe(true)
    expect(mobilePushEnabled({ MOBILE_PUSH_ENABLED: '0' })).toBe(false)
    expect(mobilePushEnabled({ MOBILE_PUSH_ENABLED: ' 0 ' })).toBe(false)
    const { db } = fakeDb({ 'uid-a': { d1: { token: TOKEN_A, lastSeen: NOW } } })
    const { impl, calls } = fakeFetch(() => ({ data: [] }))
    const result = await deliverPush(['uid-a'], ORDER, {
      db,
      fetch: impl,
      env: { ...ON, MOBILE_PUSH_ENABLED: '0' },
      now: () => NOW,
    })
    expect(calls).toHaveLength(0)
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0 })
  })

  it('sends through Expo only for a deployment that opts in to the relay (AGL-3648)', async () => {
    expect(expoPushRelayEnabled({})).toBe(false)
    expect(expoPushRelayEnabled({ EXPO_PUSH_RELAY: '0' })).toBe(false)
    expect(expoPushRelayEnabled({ EXPO_PUSH_RELAY: ' 1 ' })).toBe(true)
    const { db } = fakeDb({ 'uid-a': { d1: { token: TOKEN_A, lastSeen: NOW } } })
    const { impl, calls } = fakeFetch(() => ({ data: [] }))
    const result = await deliverPush(['uid-a'], ORDER, { db, fetch: impl, env: {}, now: () => NOW })
    expect(calls).toHaveLength(0)
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0 })
  })

  it('sends one message per live device, with the link rewritten onto today’s routes', async () => {
    const { db } = fakeDb(
      { 'uid-a': { d1: { token: TOKEN_A, lastSeen: NOW - DAY } }, 'uid-b': { d2: { token: TOKEN_B, lastSeen: NOW } } },
      { 'orgs/org-1': { slug: 'acme' }, 'hosts/host-1': { subdomain: 'shop' } },
    )
    const { impl, calls } = fakeFetch((messages) => ({ data: messages.map(() => ({ status: 'ok' })) }))
    const result = await deliverPush(['uid-a', 'uid-b'], ORDER, { db, fetch: impl, env: ON, now: () => NOW })
    expect(result).toEqual({ sent: 2, pruned: 0, failed: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(EXPO_PUSH_URL)
    expect(calls[0].messages.map((message) => message['to'])).toEqual([TOKEN_A, TOKEN_B])
    expect(calls[0].messages[0]).toMatchObject({
      title: 'New order',
      body: 'Order #1001 was placed.',
      data: { type: 'content.order', link: '/acme/hosts/shop/orders/o1', orgId: 'org-1', hostId: 'host-1' },
    })
  })

  it('sends the Expo access token as the bearer when one is configured', async () => {
    const { db } = fakeDb({ 'uid-a': { d1: { token: TOKEN_A, lastSeen: NOW } } })
    const { impl, calls } = fakeFetch(() => ({ data: [{ status: 'ok' }] }))
    await deliverPush(['uid-a'], { ...ORDER, orgId: undefined, link: undefined }, {
      db,
      fetch: impl,
      env: { ...ON, EXPO_ACCESS_TOKEN: 'expo-secret' },
      now: () => NOW,
    })
    expect(calls[0].headers['authorization']).toBe('Bearer expo-secret')
  })

  it('forgets a device Expo no longer recognizes, and one unseen for sixty days', async () => {
    const { db, deleted } = fakeDb({
      'uid-a': {
        gone: { token: TOKEN_A, lastSeen: NOW },
        stale: { token: TOKEN_B, lastSeen: NOW - 61 * DAY },
      },
    })
    const { impl, calls } = fakeFetch(() => ({
      data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
    }))
    const result = await deliverPush(['uid-a'], ORDER, { db, fetch: impl, env: ON, now: () => NOW })
    expect(calls[0].messages).toHaveLength(1)
    expect(deleted.sort()).toEqual(['users/uid-a/devices/gone', 'users/uid-a/devices/stale'])
    expect(result).toEqual({ sent: 0, pruned: 2, failed: 0 })
  })

  it('skips a malformed token and sends a shared token once', async () => {
    const { db } = fakeDb({
      'uid-a': { d1: { token: 'not-a-token' }, d2: { token: TOKEN_A } },
      'uid-b': { d3: { token: TOKEN_A } },
    })
    const { impl, calls } = fakeFetch(() => ({ data: [{ status: 'ok' }] }))
    const result = await deliverPush(['uid-a', 'uid-b'], ORDER, { db, fetch: impl, env: ON, now: () => NOW })
    expect(calls[0].messages.map((message) => message['to'])).toEqual([TOKEN_A])
    expect(result.sent).toBe(1)
  })

  it('counts a refused request as failed and never throws', async () => {
    const { db } = fakeDb({ 'uid-a': { d1: { token: TOKEN_A } } })
    const { impl } = fakeFetch(() => ({}), 503)
    await expect(deliverPush(['uid-a'], ORDER, { db, fetch: impl, env: ON, now: () => NOW })).resolves.toEqual({
      sent: 0,
      pruned: 0,
      failed: 1,
    })
    const throwing = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    await expect(deliverPush(['uid-a'], ORDER, { db, fetch: throwing, env: ON, now: () => NOW })).resolves.toEqual({
      sent: 0,
      pruned: 0,
      failed: 1,
    })
  })

  it('asks for high priority only for an urgent notification', () => {
    expect(pushMessage(TOKEN_A, { ...ORDER, level: 'critical' }, undefined).priority).toBe('high')
    expect(pushMessage(TOKEN_A, ORDER, undefined).priority).toBe('default')
  })
})
