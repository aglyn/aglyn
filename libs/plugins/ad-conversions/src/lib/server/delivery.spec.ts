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

import { parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { randomBytes } from 'crypto'
import { sealToken } from './config'
import { runDeliveryTick } from './delivery'
import { createAdConversionRoutes, type AdRouteDeps } from './routes'
import { emptyConnection, type StoredEvent } from './store'
import { createMemoryAdConversionStore } from '../testing/memory-store'
import { createMockHttp } from '../testing/mock-http'

/**
 * Delivery and the console routes against mocked HTTP (AGL-3694): what each
 * vendor answer does to an owed event and its connection, and that no route
 * ever answers with the token.
 */

const HOST_ID = 'host-1'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const keyring = parseSecretBoxKeyring(randomBytes(32).toString('base64'))
const CONNECTION_ID = `${HOST_ID}_meta`

function setup(answers: Array<[number, unknown]> = [[200, { events_received: 1 }]]) {
  const memory = createMemoryAdConversionStore()
  memory.connections.set(CONNECTION_ID, {
    ...emptyConnection({ orgId: 'org-1', hostId: HOST_ID, provider: 'meta', nowMs: NOW }),
    sealedToken: sealToken('EAAB-secret', CONNECTION_ID, keyring),
    tokenKeyId: keyring.current.id,
  })
  const mock = createMockHttp(answers)
  return { memory, mock, deps: { store: memory.store, keyring: () => keyring, http: mock.http, now: () => NOW } }
}

function owe(memory: ReturnType<typeof createMemoryAdConversionStore>, overrides: Partial<StoredEvent> = {}) {
  const id = `${CONNECTION_ID}_purchase.cs_live_1`
  memory.events.set(id, {
    orgId: 'org-1',
    connectionId: CONNECTION_ID,
    hostId: HOST_ID,
    provider: 'meta',
    status: 'pending',
    test: null,
    pixelId: '1234567890',
    attempts: 0,
    nextAttemptAtMs: NOW,
    createdAtMs: NOW,
    lastError: null,
    emailHash: 'a'.repeat(64),
    event: {
      id: 'purchase.cs_live_1',
      name: 'purchase',
      occurredAtMs: NOW - 1000,
      url: null,
      currency: 'USD',
      valueCents: 1000,
      orderId: 'cs_live_1',
      items: [],
      user: { em: 'a'.repeat(64) },
      browser: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0' },
    },
    expiresAt: new Date(NOW + 1000),
    ...overrides,
  })
  return id
}

describe('delivery', () => {
  it('sends with the opened token, then keeps a tombstone without the personal data', async () => {
    const { memory, mock, deps } = setup()
    const id = owe(memory)
    expect(await runDeliveryTick(deps)).toMatchObject({ sent: 1, failed: 0, configured: true })
    expect(mock.requests[0].body.access_token).toBe('EAAB-secret')
    const tombstone = memory.events.get(id)
    expect(tombstone).toMatchObject({ status: 'sent', emailHash: null, event: { user: {}, browser: { ip: null, userAgent: null } } })
    expect(memory.connections.get(CONNECTION_ID)).toMatchObject({ lastSentEvent: 'Purchase', lastSentTest: false, totals: { sent: 1 } })
    // A second tick has nothing left to send.
    expect(await runDeliveryTick(deps)).toMatchObject({ sent: 0 })
    expect(mock.requests).toHaveLength(1)
  })

  it('a refused token asks for a new one and keeps the event waiting', async () => {
    const { memory, deps } = setup([[400, { error: { code: 190, message: 'Invalid OAuth access token' } }]])
    const id = owe(memory)
    await runDeliveryTick(deps)
    expect(memory.connections.get(CONNECTION_ID)?.status).toBe('reconnect')
    expect(memory.events.get(id)?.status).toBe('pending')
  })

  it('a refused event is given up with the vendor’s reason on the connection', async () => {
    const { memory, deps } = setup([[400, { error: { code: 100, message: 'Invalid parameter' } }]])
    const id = owe(memory)
    expect(await runDeliveryTick(deps)).toMatchObject({ failed: 1 })
    expect(memory.events.get(id)).toMatchObject({ status: 'failed', lastError: 'Invalid parameter', event: { user: {} } })
    expect(memory.connections.get(CONNECTION_ID)).toMatchObject({ lastError: 'Invalid parameter', totals: { failed: 1 } })
  })

  it('an outage retries with backoff', async () => {
    const { memory, deps } = setup([[503, {}]])
    const id = owe(memory)
    expect(await runDeliveryTick(deps)).toMatchObject({ retried: 1 })
    expect(memory.events.get(id)).toMatchObject({ status: 'pending', attempts: 1 })
    expect(memory.events.get(id)!.nextAttemptAtMs).toBeGreaterThan(NOW)
  })

  it('an event older than a week is given up unsent', async () => {
    const { memory, mock, deps } = setup()
    const id = owe(memory)
    memory.events.get(id)!.event.occurredAtMs = NOW - 8 * 24 * 60 * 60 * 1000
    await runDeliveryTick(deps)
    expect(memory.events.get(id)?.status).toBe('failed')
    expect(mock.requests).toHaveLength(0)
  })

  it('does nothing without the sealing key', async () => {
    const { memory, mock, deps } = setup()
    owe(memory)
    expect(await runDeliveryTick({ ...deps, keyring: () => null })).toMatchObject({ configured: false, sent: 0 })
    expect(mock.requests).toHaveLength(0)
  })
})

describe('the console routes', () => {
  function routes(answers: Array<[number, unknown]> = [[200, { events_received: 1 }]]) {
    const { memory, mock } = setup(answers)
    const deps: AdRouteDeps = {
      now: () => NOW,
      keyring: () => keyring,
      store: memory.store,
      http: mock.http,
      gate: async (request) => ({ orgId: 'org-1', hostId: HOST_ID, uid: 'user-1', body: request.method === 'GET' ? {} : await request.json() }),
      host: async () => ({ analytics: { adTags: { meta: '1234567890' } }, consent: { advertising: true } }) as never,
      logActivity: async () => undefined,
    }
    return { memory, mock, api: createAdConversionRoutes(deps) }
  }
  const post = (body: Record<string, unknown>, method = 'POST') =>
    new Request('https://app.example.com/api/ad-conversions/x', {
      method,
      headers: { 'Content-Type': 'application/json', 'user-agent': 'Console/1.0' },
      body: JSON.stringify({ hostId: HOST_ID, ...body }),
    })

  it('never answers with the token, sealed or open', async () => {
    const { api } = routes()
    const connected = await api.connect(post({ provider: 'tiktok', accessToken: 'tt-secret-token' }))
    const listed = await api.list(new Request(`https://app.example.com/api/ad-conversions/connections?hostId=${HOST_ID}`))
    for (const response of [connected, listed]) {
      const text = await response.text()
      expect(text).not.toContain('tt-secret-token')
      expect(text).not.toContain('EAAB-secret')
      expect(text).not.toMatch(/sealedToken|sb1\./)
    }
  })

  it('reports the setup state the card shows', async () => {
    const { api } = routes()
    const answer = await (await api.list(new Request(`https://app.example.com/api/ad-conversions/connections?hostId=${HOST_ID}`))).json()
    expect(answer.available).toBe(true)
    expect(answer.setup.tagIds).toEqual({ meta: '1234567890', tiktok: null, pinterest: null })
    expect(answer.connections[0]).toMatchObject({ provider: 'meta', status: 'active' })
  })

  it('a test event needs a test code, and goes with it', async () => {
    const { api, mock, memory } = routes()
    const refused = await api.testEvent(post({ provider: 'meta' }))
    expect(refused.status).toBe(400)
    expect(mock.requests).toHaveLength(0)
    await api.connection(post({ provider: 'meta', testEventCode: 'TEST123' }, 'PATCH'))
    const sent = await api.testEvent(post({ provider: 'meta' }))
    expect(sent.status).toBe(200)
    expect(mock.requests[0].body.test_event_code).toBe('TEST123')
    expect(memory.connections.get(CONNECTION_ID)).toMatchObject({ lastSentTest: true })
  })

  it('Pinterest needs its ad account to connect', async () => {
    const { api } = routes()
    expect((await api.connect(post({ provider: 'pinterest', accessToken: 'pina-token' }))).status).toBe(400)
    expect((await api.connect(post({ provider: 'pinterest', accessToken: 'pina-token', adAccountId: '549755885175' }))).status).toBe(200)
  })

  it('disconnecting deletes the connection and its owed events', async () => {
    const { api, memory } = routes()
    owe(memory)
    await api.connection(post({ provider: 'meta' }, 'DELETE'))
    expect(memory.connections.size).toBe(0)
    expect(memory.events.size).toBe(0)
  })
})
