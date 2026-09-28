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
 * `sendEmail` × the deliverability preflight (AGL-3328).
 *
 * The same fetch guard the governor's spec uses: anything other than the
 * in-memory recorder throws, so a test that reached Resend fails loudly. The
 * preflight is INJECTED, so the send path is held to the posture it takes
 * with every other injected control — it fails open — and to the one rule
 * that is its own: a message the recipient asked for is told its purpose,
 * and a hold answers only for bulk mail.
 */

import {
  resetEmailDeliverabilityPreflightForTests,
  setEmailDeliverabilityPreflight,
  type EmailDeliverabilityPreflightRequest,
} from './email-deliverability'
import { emailSendPurpose, isDeferrableSendResult, sendEmail, sendFailureReason } from './send-email'

const FROM = 'Aglyn <noreply@aglyn.com>'

let requests: Array<{ url: string; body: any }> = []
let asked: EmailDeliverabilityPreflightRequest[] = []

function installFetchGuard() {
  global.fetch = jest.fn(async (url: any, init: any) => {
    const target = String(url)
    if (!target.startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${target}`)
    }
    requests.push({ url: target, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ id: 'email_test' }), text: async () => '' }
  }) as unknown as typeof fetch
}

describe('sendEmail × the deliverability preflight', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    requests = []
    asked = []
    installFetchGuard()
    process.env.RESEND_API_KEY = 're_test_key_not_real'
    process.env.USAGE_EMAIL_FROM = FROM
    resetEmailDeliverabilityPreflightForTests()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    resetEmailDeliverabilityPreflightForTests()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('sends as it always did when nothing is installed', async () => {
    const result = await sendEmail({ to: 'a@example.org', subject: 'Hi', text: 'x' })
    expect(result.sent).toBe(true)
    expect(requests).toHaveLength(1)
  })

  it('asks with the recipients, the purpose and the sending domain', async () => {
    setEmailDeliverabilityPreflight(async (request) => {
      asked.push(request)
      return { refused: [], held: [] }
    })
    await sendEmail({ to: 'Casey@Example.org', subject: 'Receipt', text: 'x', context: 'order-receipt' })
    await sendEmail({ to: 'casey@example.org', subject: 'News', text: 'x', context: 'campaign' })
    expect(asked).toEqual([
      expect.objectContaining({
        recipients: ['casey@example.org'],
        purpose: 'transactional',
        sendingDomain: 'aglyn.com',
        sendingSource: 'platform',
        context: 'order-receipt',
      }),
      expect.objectContaining({ purpose: 'bulk', context: 'campaign' }),
    ])
    expect(requests).toHaveLength(2)
  })

  it('refuses a recipient whose domain takes no mail, before the provider is called', async () => {
    setEmailDeliverabilityPreflight(async () => ({
      refused: [{ email: 'nobody@parked.example', code: 'no_mx', reason: 'parked.example has no mail server.' }],
      held: [],
    }))
    const result = await sendEmail({ to: 'nobody@parked.example', subject: 'Reset', text: 'x' })
    expect(result.sent).toBe(false)
    expect(sendFailureReason(result)).toBe('undeliverable')
    expect((result as { detail?: string }).detail).toBe('parked.example has no mail server.')
    expect(isDeferrableSendResult(result)).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('reports a held bulk recipient as gateway-held, and does not retry it', async () => {
    setEmailDeliverabilityPreflight(async () => ({
      refused: [],
      held: [{ email: 'kristan@lifespire.example', gateway: 'barracuda', reason: 'Barracuda refused this sender twice.' }],
    }))
    const result = await sendEmail({ to: 'kristan@lifespire.example', subject: 'News', text: 'x', context: 'campaign' })
    expect(sendFailureReason(result)).toBe('gateway-held')
    expect(isDeferrableSendResult(result)).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('drops the stopped recipients of a multi-recipient message and sends to the rest', async () => {
    setEmailDeliverabilityPreflight(async () => ({
      refused: [{ email: 'gone@parked.example', code: 'no_mx', reason: 'no mail server' }],
      held: [],
    }))
    const result = await sendEmail({
      to: ['ops@acme.example', 'gone@parked.example'],
      subject: 'Alert',
      text: 'x',
    })
    expect(result.sent).toBe(true)
    expect(requests[0].body.to).toEqual(['ops@acme.example'])
  })

  it('fails OPEN when the preflight throws', async () => {
    setEmailDeliverabilityPreflight(async () => {
      throw new Error('store unreachable')
    })
    const result = await sendEmail({ to: 'a@example.org', subject: 'Hi', text: 'x' })
    expect(result.sent).toBe(true)
    expect(requests).toHaveLength(1)
  })

  it('fails OPEN when the preflight never answers', async () => {
    jest.useFakeTimers()
    try {
      setEmailDeliverabilityPreflight(() => new Promise(() => undefined))
      const pending = sendEmail({ to: 'a@example.org', subject: 'Hi', text: 'x' })
      await jest.advanceTimersByTimeAsync(3_000)
      await expect(pending).resolves.toMatchObject({ sent: true })
    } finally {
      jest.useRealTimers()
    }
  })

  it('names the site identity it sends from', async () => {
    setEmailDeliverabilityPreflight(async (request) => {
      asked.push(request)
      return { refused: [], held: [] }
    })
    await sendEmail({
      to: 'a@example.org',
      subject: 'Hi',
      text: 'x',
      audience: 'tenant',
      sendingIdentity: {
        from: 'Acme <hello@mail.acme.example>',
        source: 'custom',
        domain: 'mail.acme.example',
        summary: 'hello@mail.acme.example',
        refusal: null,
      },
    })
    expect(asked[0]).toMatchObject({ sendingDomain: 'mail.acme.example', sendingSource: 'custom' })
  })
})

describe('emailSendPurpose', () => {
  it('reads marketing, a campaign and a resumable sweep as bulk, and everything else as transactional', () => {
    expect(emailSendPurpose({ context: 'password-reset' })).toBe('transactional')
    expect(emailSendPurpose({ context: 'order-receipt' })).toBe('transactional')
    expect(emailSendPurpose({ context: 'booking-confirmation' })).toBe('transactional')
    expect(emailSendPurpose({ context: 'campaign' })).toBe('bulk')
    expect(emailSendPurpose({ context: 'abandoned-cart', priority: 'bulk' })).toBe('bulk')
    expect(emailSendPurpose({ marketing: { hostId: 'h', siteBase: '' } as never })).toBe('bulk')
    expect(emailSendPurpose({ headers: { 'List-Unsubscribe': '<https://x.example/u>' } })).toBe('bulk')
  })
})
