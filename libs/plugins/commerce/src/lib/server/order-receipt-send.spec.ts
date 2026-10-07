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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import {
  registerPluginSmsMessaging,
} from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { orderReceiptSendHandler } from './order-receipt-send'

/**
 * "Resend receipt" (AGL-3610): who may, how often, and what the dialog is
 * told. The send itself is `sendOrderReceipt`'s and is stubbed here; its own
 * spec covers what goes out.
 */

const roles: Record<string, string> = {}
const mockSend = jest.fn(async (..._args: any[]) => ({ outcome: 'sent', channel: 'email' }) as any)
const mockConsume = jest.fn(async (_key: string, _options: any) => ({ allowed: true, resetMs: Date.now() + 30_000 }))
let uid = 'admin-1'
let emailConfigured = true

jest.mock('./order-notifications', () => ({
  sendOrderReceipt: (...args: any[]) => mockSend(...args),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => emailConfigured,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  consumeRateLimit: (key: string, options: any) => mockConsume(key, options),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid }) }),
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: id === 'host-1',
              get: (field: string) => (field === 'memberRoles' ? roles : undefined),
            }),
          }),
        }),
      }),
    }),
  },
}))

function call(method: 'GET' | 'POST', input: Record<string, unknown>, auth = true) {
  const result = { status: 0, body: undefined as any, headers: {} as Record<string, string> }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader(name, value) {
      result.headers[name] = String(value)
    },
    redirect() {},
    end() {},
  }
  const req: PluginApiRequest = {
    method,
    query: method === 'GET' ? (input as any) : {},
    body: method === 'POST' ? input : undefined,
    headers: auth ? { authorization: 'Bearer token' } : {},
    cookies: {},
    socket: {},
  }
  return Promise.resolve(orderReceiptSendHandler(req, res)).then(() => result)
}

beforeEach(() => {
  for (const key of Object.keys(roles)) delete roles[key]
  roles['admin-1'] = 'admin'
  roles['editor-1'] = 'editor'
  roles['author-1'] = 'author'
  uid = 'admin-1'
  emailConfigured = true
  mockSend.mockClear()
  mockConsume.mockClear()
  unregisterPluginServices('sms-test')
})

const SEND = { hostId: 'host-1', orderId: 'order-1', channel: 'email', to: 'buyer@example.com' }

describe('orderReceiptSendHandler (AGL-3610)', () => {
  it('tells the dialog which channels can carry a receipt', async () => {
    expect((await call('GET', { hostId: 'host-1' })).body).toEqual({ email: true, sms: false })
    registerPluginSmsMessaging(
      { isConfigured: () => true, send: async () => ({ status: 'not-configured' }) },
      { pluginId: 'sms-test' },
    )
    expect((await call('GET', { hostId: 'host-1' })).body).toEqual({ email: true, sms: true })
  })

  it('lets an admin or an editor resend, and nobody else', async () => {
    expect((await call('POST', SEND)).body).toEqual({ ok: true, channel: 'email' })
    uid = 'editor-1'
    expect((await call('POST', SEND)).status).toBe(200)
    uid = 'author-1'
    expect((await call('POST', SEND)).status).toBe(403)
    uid = 'stranger'
    expect((await call('POST', SEND)).status).toBe(403)
    expect((await call('POST', SEND, false)).status).toBe(401)
    expect((await call('POST', { ...SEND, hostId: 'nope' })).status).toBe(404)
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith(
      { hostId: 'host-1', orderId: 'order-1' },
      { channel: 'email', to: 'buyer@example.com' },
    )
  })

  it('rate-limits per member and per order, and sends nothing when either is spent', async () => {
    mockConsume.mockImplementation(async (key: string) => ({
      allowed: !key.includes(':order:'),
      resetMs: Date.now() + 120_000,
    }))
    const refused = await call('POST', SEND)
    expect(refused.status).toBe(429)
    expect(refused.headers['Retry-After']).toMatch(/^\d+$/)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockConsume.mock.calls.map(([key]) => key)).toEqual([
      'commerce-receipt-send:uid:admin-1',
      'commerce-receipt-send:order:host-1:order-1',
    ])
    mockConsume.mockImplementation(async () => ({ allowed: true, resetMs: 0 }))
  })

  it('refuses a malformed request before anything is counted', async () => {
    expect((await call('POST', { ...SEND, channel: 'fax' })).status).toBe(400)
    expect((await call('POST', { ...SEND, to: '' })).status).toBe(400)
    expect((await call('POST', { ...SEND, orderId: '' })).status).toBe(400)
    expect(mockConsume).not.toHaveBeenCalled()
  })

  it('says what went wrong in the merchant’s words', async () => {
    mockSend.mockResolvedValueOnce({ outcome: 'not_configured' })
    expect((await call('POST', { ...SEND, channel: 'sms', to: '+15555550100' })).body.error).toBe(
      'Text messages are not set up on this platform.',
    )
    mockSend.mockResolvedValueOnce({ outcome: 'invalid_recipient' })
    expect((await call('POST', SEND)).status).toBe(400)
    mockSend.mockResolvedValueOnce({ outcome: 'failed', error: 'suppressed' })
    expect((await call('POST', SEND)).body.error).toBe('That number has opted out of texts.')
    mockSend.mockResolvedValueOnce({ outcome: 'no_such_order' })
    expect((await call('POST', SEND)).status).toBe(404)
  })
})
