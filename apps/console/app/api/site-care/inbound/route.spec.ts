/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
 *
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
 * `/api/site-care/inbound` (AGL-3959, AGL-3997): the Site Care intake's
 * webhook. The Svix signature is checked for real (signed here with a test
 * secret); the provider's event reader and the filing are doubles. Only a
 * signed message to the support address is filed; anything else is
 * acknowledged with a 200, never refused, so the provider does not retry it
 * forever.
 */

import { createHmac } from 'node:crypto'

const mockFile = jest.fn()
const mockReceived = jest.fn()
let mockUnmet: string | null = null

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: jest.requireActual('@aglyn/aglyn/app-utils/api-adapter').pluginRequestFromWeb,
}))
jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  readInboundMailEvent: (event: { type?: string; data?: { email_id?: string; to?: string[] } }) =>
    event?.type === 'email.received' ? { id: event.data?.email_id ?? '', recipients: event.data?.to ?? [] } : null,
  mailProviderReads: () => ({ unmet: () => mockUnmet, received: (...args: unknown[]) => mockReceived(...args) }),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({ fake: 'firestore' }) }) },
}))
const mockAddresses = { domain: 'in.aglyn.com', supportEmail: 'help@example.com', platformSender: null }
jest.mock('@aglyn/tenant-data-admin/server/site-care-inbound', () => ({
  __esModule: true,
  fileSiteCareInboundEmail: (...args: unknown[]) => mockFile(...args),
  siteCareInboundAddresses: () => mockAddresses,
  siteCareInboundTarget: (recipients: string[], addresses: typeof mockAddresses) =>
    recipients.includes(addresses.supportEmail) || recipients.includes(`support@${addresses.domain}`)
      ? { kind: 'new' }
      : null,
}))

import { POST } from './route'

const SECRET = `whsec_${Buffer.from('site-care-test-secret').toString('base64')}`

function signed(event: unknown, secret = SECRET) {
  const payload = JSON.stringify(event)
  const id = 'msg_1'
  const timestamp = '1760886000'
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64')
  return new Request('https://console.test/api/site-care/inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    body: payload,
  })
}

const RECEIVED = { type: 'email.received', data: { email_id: 'em_1', to: ['help@example.com'] } }

const saved = { site: process.env['SITE_CARE_INBOUND_WEBHOOK_SECRET'], resend: process.env['RESEND_WEBHOOK_SECRET'] }
beforeEach(() => {
  jest.clearAllMocks()
  process.env['SITE_CARE_INBOUND_WEBHOOK_SECRET'] = SECRET
  delete process.env['RESEND_WEBHOOK_SECRET']
  mockUnmet = null
  mockReceived.mockResolvedValue({ id: 'em_1', from: 'owner@example.com' })
  mockFile.mockResolvedValue({ outcome: 'opened', requestId: 'ticket-1' })
})
afterAll(() => {
  for (const [name, value] of [
    ['SITE_CARE_INBOUND_WEBHOOK_SECRET', saved.site],
    ['RESEND_WEBHOOK_SECRET', saved.resend],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('the Site Care webhook', () => {
  it('is not configured without a secret', async () => {
    delete process.env['SITE_CARE_INBOUND_WEBHOOK_SECRET']
    expect((await POST(signed(RECEIVED))).status).toBe(501)
  })

  it('refuses a bad signature and files nothing', async () => {
    const forged = signed(RECEIVED, `whsec_${Buffer.from('someone-else').toString('base64')}`)
    expect((await POST(forged)).status).toBe(401)
    expect(mockFile).not.toHaveBeenCalled()
  })

  it('accepts the delivery-events secret as well', async () => {
    delete process.env['SITE_CARE_INBOUND_WEBHOOK_SECRET']
    process.env['RESEND_WEBHOOK_SECRET'] = SECRET
    expect((await POST(signed(RECEIVED))).status).toBe(200)
  })

  it('files a message to the support address', async () => {
    const response = await POST(signed(RECEIVED))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: 'opened', requestId: 'ticket-1' })
    expect(mockReceived).toHaveBeenCalledWith('em_1')
    expect(mockFile).toHaveBeenCalledWith(
      { fake: 'firestore' },
      { target: { kind: 'new' }, message: { id: 'em_1', from: 'owner@example.com' }, addresses: mockAddresses },
    )
  })

  it('files the copy the support mailbox delivers to support@ the inbound domain', async () => {
    const copy = await POST(signed({ ...RECEIVED, data: { email_id: 'em_3', to: ['support@in.aglyn.com'] } }))
    expect(copy.status).toBe(200)
    expect(mockFile).toHaveBeenCalledTimes(1)
  })

  it('acknowledges with a 200, without reading or filing, other events and other addresses', async () => {
    const other = await POST(signed({ type: 'email.delivered', data: {} }))
    expect(other.status).toBe(200)
    expect(await other.json()).toEqual({ ignored: true, reason: 'not-received-event' })
    for (const to of [['sales@in.aglyn.com'], ['care@in.aglyn.com']]) {
      const elsewhere = await POST(signed({ ...RECEIVED, data: { email_id: 'em_2', to } }))
      expect(elsewhere.status).toBe(200)
      expect(await elsewhere.json()).toEqual({ ignored: true, reason: 'not-site-care' })
    }
    expect(mockReceived).not.toHaveBeenCalled()
    expect(mockFile).not.toHaveBeenCalled()
  })

  it('answers 200 for mail it leaves to the support inbox, so the provider does not retry', async () => {
    mockFile.mockResolvedValue({ outcome: 'ignored', reason: 'not-a-member' })
    const response = await POST(signed(RECEIVED))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ignored: true, reason: 'not-a-member' })
  })

  it('says so when the provider cannot read received mail', async () => {
    mockUnmet = 'No API key.'
    expect((await POST(signed(RECEIVED))).status).toBe(501)
  })

  it('never logs the body when filing fails', async () => {
    mockFile.mockRejectedValue(new Error('Firestore unavailable'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(signed(RECEIVED))
    expect(response.status).toBe(500)
    expect(JSON.stringify(spy.mock.calls)).not.toContain('owner@example.com')
    spy.mockRestore()
  })
})
