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

/**
 * The customer display's pairing and token (AGL-3608): a code opens one
 * register once, the token opens that register's display and nothing else,
 * only hashes are stored, a revoked token stops on the next poll, and a
 * customer's typed address never comes back to the screen.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

let mockRateAllowed = true

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'cashier-1' }) }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    consumeRateLimit: async () => ({ allowed: mockRateAllowed }),
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: { id: 'org-1', plan: 'business', subscriptionStatus: 'active' },
    }),
    getPluginConfig: async () => ({ posDisplayMessage: 'Hello' }),
  }
})

import { registerPluginSmsMessaging } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { finishPosDisplayReceipt, posDisplayHandler, resetPosDisplay } from './pos-display'

let mockSmsConfigured = true
registerPluginSmsMessaging(
  { isConfigured: () => mockSmsConfigured, send: async () => ({ outcome: 'sent', id: 'SM1' }) as any },
  { pluginId: 'sms-spec' },
)

async function call(
  body: Record<string, unknown>,
  options: { staff?: boolean; method?: 'GET' | 'POST'; token?: string } = {},
) {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(value: unknown) {
      result.body = value
    },
    send() {},
    setHeader() {},
    redirect() {},
    end() {},
  } as unknown as PluginApiResponse
  const method = options.method ?? 'POST'
  const req: PluginApiRequest = {
    method,
    query: method === 'GET' ? (body as Record<string, string>) : {},
    body: method === 'POST' ? body : undefined,
    headers: {
      ...(options.staff ? { authorization: 'Bearer staff' } : {}),
      ...(options.token ? { 'x-pos-display-token': options.token } : {}),
    },
    cookies: {},
    socket: { remoteAddress: '203.0.113.9' },
  }
  await posDisplayHandler(req, res)
  return result
}

const SITE = { hostId: 'host-1', registerId: 'register-1' }

beforeEach(() => {
  resetFakeFirestore()
  mockRateAllowed = true
  mockSmsConfigured = true
  fakeDocs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'editor' }, displayName: 'Bean Bar' })
  fakeDocs.set('hosts/host-1/registers/register-1', { name: 'Front' })
})

async function pairDisplay(): Promise<string> {
  const code = await call({ action: 'pairing-code', ...SITE }, { staff: true })
  expect(code.body.code).toMatch(/^\d{6}$/)
  const paired = await call({ action: 'pair', code: code.body.code })
  expect(paired.status).toBe(200)
  return paired.body.token
}

describe('pairing', () => {
  it('opens the register once and stores only hashes', async () => {
    const code = await call({ action: 'pairing-code', ...SITE }, { staff: true })
    const paired = await call({ action: 'pair', code: code.body.code })
    expect(paired.body.branding).toMatchObject({ name: 'Bean Bar', message: 'Hello' })
    const stored = JSON.stringify([...fakeDocs.entries()])
    expect(stored).not.toContain(paired.body.token)
    expect(stored).not.toContain(`"${code.body.code}"`)
    // Spent: the same code pairs nothing a second time.
    expect((await call({ action: 'pair', code: code.body.code })).status).toBe(404)
  })

  it('refuses an expired code and a flood of guesses', async () => {
    const code = await call({ action: 'pairing-code', ...SITE }, { staff: true })
    for (const [key, value] of fakeDocs) {
      if (key.startsWith('posDisplayPairings/')) fakeDocs.set(key, { ...value, expiresAtMs: 1 })
    }
    expect((await call({ action: 'pair', code: code.body.code })).status).toBe(404)
    mockRateAllowed = false
    expect((await call({ action: 'pair', code: '123456' })).status).toBe(429)
  })

  it('needs the register gate to make a code', async () => {
    expect((await call({ action: 'pairing-code', ...SITE })).status).toBe(401)
  })
})

describe('the display token', () => {
  it('reads its own register, answers the current prompt only, and never sees the answer back', async () => {
    const token = await pairDisplay()
    await call(
      {
        action: 'push',
        ...SITE,
        state: {
          mode: 'receipt',
          promptId: 'r1',
          receipt: { channels: ['email', 'none'], offerMarketing: true },
        },
      },
      { staff: true },
    )
    const stale = await call(
      { action: 'respond', response: { promptId: 'r0', receiptChannel: 'none' } },
      { token },
    )
    expect(stale.status).toBe(409)
    const answered = await call(
      {
        action: 'respond',
        response: { promptId: 'r1', receiptChannel: 'email', email: 'ann@example.com', marketingOptIn: true },
      },
      { token },
    )
    expect(answered.status).toBe(200)
    const poll = await call({ action: 'poll' }, { method: 'GET', token })
    expect(poll.body.state).toMatchObject({ mode: 'receipt', answered: true })
    expect(JSON.stringify(poll.body)).not.toContain('ann@example.com')
    const cashier = await call({ action: 'state', ...SITE }, { staff: true, method: 'GET' })
    expect(cashier.body.state.response).toMatchObject({ email: 'ann@example.com', marketingOptIn: true })
    expect(cashier.body.connected).toBe(true)
  })

  it('stops working once revoked, or once its register is removed', async () => {
    const token = await pairDisplay()
    await call({ action: 'revoke', ...SITE, displayId: '*' }, { staff: true })
    expect((await call({ action: 'poll' }, { method: 'GET', token })).status).toBe(401)
    const second = await pairDisplay()
    fakeDocs.delete('hosts/host-1/registers/register-1')
    expect((await call({ action: 'poll' }, { method: 'GET', token: second })).status).toBe(401)
  })

  it('refuses a made-up token', async () => {
    expect((await call({ action: 'poll' }, { method: 'GET', token: 'x'.repeat(43) })).status).toBe(401)
  })
})

describe('the end of a sale (AGL-3608)', () => {
  const STATE_KEY = 'posDisplayStates/host-1__register-1'

  async function answerReceipt(token: string) {
    await call(
      {
        action: 'push',
        ...SITE,
        state: {
          mode: 'receipt',
          promptId: 'r1',
          receipt: { channels: ['email', 'sms', 'none'], offerMarketing: false },
        },
      },
      { staff: true },
    )
    await call(
      { action: 'respond', response: { promptId: 'r1', receiptChannel: 'sms', phone: '+1 555 010 9999' } },
      { token },
    )
    expect(JSON.stringify(fakeDocs.get(STATE_KEY))).toContain('15550109999')
  }

  it('never offers text on the screen when the store cannot send one', async () => {
    const token = await pairDisplay()
    mockSmsConfigured = false
    await call(
      {
        action: 'push',
        ...SITE,
        state: { mode: 'receipt', promptId: 'r1', receipt: { channels: ['email', 'sms', 'none'] } },
      },
      { staff: true },
    )
    const poll = await call({ action: 'poll' }, { method: 'GET', token })
    expect(poll.body.state.receipt.channels).toEqual(['email', 'none'])
  })

  it("formats in the store's chosen currency", async () => {
    const token = await pairDisplay()
    fakeDocs.set('hosts/host-1/settings/store', { currency: 'CAD' })
    await call({ action: 'push', ...SITE, state: { mode: 'idle' } }, { staff: true })
    const poll = await call({ action: 'poll' }, { method: 'GET', token })
    expect(poll.body.state).toMatchObject({ currency: 'cad' })
  })

  it('stamps the store currency on every state, whatever the register sent', async () => {
    const token = await pairDisplay()
    await call(
      {
        action: 'push',
        ...SITE,
        state: { mode: 'cart', currency: 'eur', cart: { lines: [], itemsCents: 0, discountCents: 0, taxCents: 0, totalCents: 500 } },
      },
      { staff: true },
    )
    const poll = await call({ action: 'poll' }, { method: 'GET', token })
    expect(poll.body.state).toMatchObject({ mode: 'cart', currency: 'usd' })
  })

  it('says thank you and forgets the typed phone once the receipt is handled', async () => {
    const token = await pairDisplay()
    await answerReceipt(token)
    await finishPosDisplayReceipt('host-1', 'register-1')
    const stored = fakeDocs.get(STATE_KEY)
    expect(stored).toMatchObject({ mode: 'thanks' })
    expect(JSON.stringify(stored)).not.toContain('15550109999')
    const poll = await call({ action: 'poll' }, { method: 'GET', token })
    expect(poll.body.state).toMatchObject({ mode: 'thanks' })
  })

  it('leaves the next customer\'s basket alone but still drops a stale answer', async () => {
    await pairDisplay()
    fakeDocs.set(STATE_KEY, {
      mode: 'cart',
      updatedAtMs: Date.now(),
      cart: { lines: [], itemsCents: 0, discountCents: 0, taxCents: 0, totalCents: 900 },
      response: { promptId: 'old', receiptChannel: 'email', email: 'ann@example.com', atMs: 1 },
      hostId: 'host-1',
      registerId: 'register-1',
    })
    await finishPosDisplayReceipt('host-1', 'register-1')
    const stored = fakeDocs.get(STATE_KEY)
    expect(stored).toMatchObject({ mode: 'cart', cart: { totalCents: 900 } })
    expect(JSON.stringify(stored)).not.toContain('ann@example.com')
  })

  it('a completed sale rewrites the state whole, answer and all', async () => {
    const token = await pairDisplay()
    await answerReceipt(token)
    await resetPosDisplay('host-1', 'register-1')
    expect(fakeDocs.get(STATE_KEY)).toMatchObject({ mode: 'thanks', currency: 'usd' })
    expect(JSON.stringify(fakeDocs.get(STATE_KEY))).not.toContain('15550109999')
  })
})
