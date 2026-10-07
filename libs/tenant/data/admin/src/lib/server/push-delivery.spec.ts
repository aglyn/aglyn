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

jest.mock('@aglyn/aglyn/server', () => ({
  normalizeNotificationLink: (link: string, scope: { orgSlug?: string | null }) =>
    `${scope.orgSlug ? `/${scope.orgSlug}` : ''}${link}`,
}))

import type { Firestore } from 'firebase-admin/firestore'
import type { MobilePushPayload } from './mobile-push-switch'
import {
  deliverNativePush,
  type PushMessage,
  type PushOutcome,
  type PushTarget,
  type PushTransport,
} from './push-delivery'

const NOW = Date.UTC(2026, 9, 7)
const APNS = 'a1b2c3d4'.repeat(8)
const APNS_MAC = 'f'.repeat(64)
const FCM = `dQw4w9WgXcQ:APA91b${'Fz_-0aZ'.repeat(20)}`

type Row = Record<string, unknown>

function fakeDb(devicesByUid: Record<string, Record<string, Row>>, orgs: Record<string, Row> = {}) {
  const deleted: string[] = []
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => {
        if (name === 'orgs' || name === 'hosts') {
          return { get: async () => ({ get: (field: string) => (name === 'orgs' ? orgs[id]?.[field] : undefined) }) }
        }
        return {
          collection: () => ({
            limit: () => ({
              get: async () => ({
                docs: Object.entries(devicesByUid[id] ?? {}).map(([deviceId, row]) => ({
                  get: (field: string) => row[field],
                  ref: {
                    delete: async () => {
                      deleted.push(`${id}/${deviceId}`)
                    },
                  },
                })),
              }),
            }),
          }),
        }
      },
    }),
  }
  return { db: db as unknown as Firestore, deleted }
}

function recorder(outcome: (target: PushTarget) => PushOutcome = () => 'sent') {
  const calls: Array<{ targets: PushTarget[]; message: PushMessage }> = []
  const transport: PushTransport = {
    send: async (targets, message) => {
      calls.push({ targets: [...targets], message })
      return targets.map(outcome)
    },
  }
  return { calls, transport }
}

const PAYLOAD: MobilePushPayload = {
  type: 'content.order',
  title: 'New order #1042',
  body: '$12.50 from Acme',
  link: '/hosts/host-1/orders/o1',
  orgId: 'org-1',
  hostId: 'host-1',
  level: 'success',
} as MobilePushPayload

const lastSeen = { toMillis: () => NOW - 1000 }

describe('native push delivery (AGL-3651)', () => {
  it('groups devices by transport and sends each group through its own', async () => {
    const { db, deleted } = fakeDb(
      {
        'uid-a': {
          phone: { token: APNS, transport: 'apns', apnsEnvironment: 'production', platform: 'ios', app: 'aglyn', lastSeen },
          mac: { token: APNS_MAC, transport: 'apns', apnsEnvironment: 'sandbox', platform: 'macos', app: 'aglyn-pos', lastSeen },
        },
        'uid-b': { pixel: { token: FCM, transport: 'fcm', platform: 'android', app: 'aglyn', lastSeen } },
      },
      { 'org-1': { slug: 'acme' } },
    )
    const apns = recorder()
    const fcm = recorder()
    const result = await deliverNativePush(['uid-a', 'uid-b'], PAYLOAD, {
      db,
      now: () => NOW,
      transport: async (kind) => (kind === 'apns' ? apns.transport : fcm.transport),
    })
    expect(result).toEqual({ sent: 3, pruned: 0, failed: 0, skipped: 0 })
    expect(deleted).toEqual([])
    expect(apns.calls[0].targets).toEqual([
      { token: APNS, app: 'aglyn', topic: 'com.aglyn.app', apnsEnvironment: 'production' },
      { token: APNS_MAC, app: 'aglyn-pos', topic: 'com.aglyn.pos', apnsEnvironment: 'sandbox' },
    ])
    expect(fcm.calls[0].targets).toEqual([{ token: FCM, app: 'aglyn', topic: 'com.aglyn.app' }])
    expect(apns.calls[0].message).toEqual({
      title: 'New order #1042',
      body: '$12.50 from Acme',
      data: { type: 'content.order', link: '/acme/hosts/host-1/orders/o1', orgId: 'org-1', hostId: 'host-1' },
      urgent: false,
    })
  })

  it('prunes Expo, transport-less, malformed and stale rows, and never sends to them', async () => {
    const { db, deleted } = fakeDb({
      'uid-a': {
        expo: { token: 'ExponentPushToken[abcdefgh1234]', transport: 'expo', platform: 'ios', app: 'aglyn' },
        legacy: { token: 'ExponentPushToken[abcdefgh1234]', platform: 'ios', app: 'aglyn' },
        bad: { token: 'xyz', transport: 'apns', apnsEnvironment: 'production', platform: 'ios', app: 'aglyn' },
        noApp: { token: APNS, transport: 'apns', apnsEnvironment: 'production', platform: 'ios', app: 'other' },
        stale: { token: FCM, transport: 'fcm', platform: 'android', app: 'aglyn', lastSeen: NOW - 61 * 24 * 3600 * 1000 },
      },
    })
    const transport = recorder()
    const result = await deliverNativePush(['uid-a'], PAYLOAD, { db, now: () => NOW, transport: async () => transport.transport })
    expect(result).toEqual({ sent: 0, pruned: 5, failed: 0, skipped: 0 })
    expect(deleted.sort()).toEqual(['uid-a/bad', 'uid-a/expo', 'uid-a/legacy', 'uid-a/noApp', 'uid-a/stale'])
    expect(transport.calls).toHaveLength(0)
  })

  it('prunes what a transport reports gone, counts failures, and sends a shared token once', async () => {
    const { db, deleted } = fakeDb({
      'uid-a': {
        one: { token: APNS, transport: 'apns', apnsEnvironment: 'production', platform: 'ios', app: 'aglyn' },
        two: { token: APNS_MAC, transport: 'apns', apnsEnvironment: 'production', platform: 'macos', app: 'aglyn' },
      },
      'uid-b': { same: { token: APNS, transport: 'apns', apnsEnvironment: 'production', platform: 'ios', app: 'aglyn' } },
    })
    const apns = recorder((target) => (target.token === APNS ? 'prune' : 'failed'))
    const result = await deliverNativePush(['uid-a', 'uid-b'], { ...PAYLOAD, level: 'critical' } as MobilePushPayload, {
      db,
      now: () => NOW,
      transport: async () => apns.transport,
    })
    expect(result).toEqual({ sent: 0, pruned: 1, failed: 1, skipped: 0 })
    expect(deleted).toEqual(['uid-a/one'])
    expect(apns.calls[0].targets).toHaveLength(2)
    expect(apns.calls[0].message.urgent).toBe(true)
  })

  it('skips a transport the deployment has not configured, and survives one that throws', async () => {
    const { db } = fakeDb({
      'uid-a': {
        phone: { token: APNS, transport: 'apns', apnsEnvironment: 'production', platform: 'ios', app: 'aglyn' },
        pixel: { token: FCM, transport: 'fcm', platform: 'android', app: 'aglyn' },
      },
    })
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const result = await deliverNativePush(['uid-a'], PAYLOAD, {
        db,
        now: () => NOW,
        transport: async (kind) =>
          kind === 'apns'
            ? null
            : {
                send: async () => {
                  throw new Error('fcm down')
                },
              },
      })
      expect(result).toEqual({ sent: 0, pruned: 0, failed: 1, skipped: 1 })
    } finally {
      errors.mockRestore()
    }
  })

  it('does nothing for nobody', async () => {
    const { db } = fakeDb({})
    const transport = jest.fn()
    expect(await deliverNativePush([], PAYLOAD, { db, transport })).toEqual({ sent: 0, pruned: 0, failed: 0, skipped: 0 })
    expect(transport).not.toHaveBeenCalled()
  })
})
