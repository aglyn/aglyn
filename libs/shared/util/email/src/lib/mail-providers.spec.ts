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

import type { MailProvider, MailProviderMessage } from './mail-provider'
import {
  mailProvider,
  mailProviderProblem,
  mailProviderReads,
  normalizeDeliveryEvents,
  readInboundMailEvent,
  registerMailProvider,
  resetMailProvidersForTests,
} from './mail-providers'
import { mailWebhookBody } from './mail-provider-webhook'
import { isEmailConfigured, sendEmail } from './send-email'

const FROM = 'Aglyn <noreply@aglyn.com>'
const MAIL_SETTINGS = [
  'AGLYN_MAIL_PROVIDER',
  'AGLYN_MAIL_WEBHOOK_URL',
  'AGLYN_MAIL_WEBHOOK_TOKEN',
  'RESEND_API_KEY',
  'RESEND_READ_API_KEY',
  'USAGE_EMAIL_FROM',
]

/**
 * Every case names the settings it has and clears the rest: `nx test`
 * injects the root `.env`, which would otherwise hand a case a real key and
 * pick a provider the case did not ask for.
 */
function environment(settings: Record<string, string>): void {
  for (const name of MAIL_SETTINGS) delete process.env[name]
  Object.assign(process.env, settings)
}

function mockFetch(response: Partial<Response> & { json?: () => unknown }) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'relay_1' }),
    text: async () => '',
    headers: { get: () => null },
    ...response,
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

/** A provider a plugin or a fork could register, recording what it is handed. */
function recordingProvider(id: string): MailProvider & { sent: MailProviderMessage[] } {
  const sent: MailProviderMessage[] = []
  return {
    id,
    sent,
    missingSettings: () => [],
    send: async (message) => {
      sent.push(message)
      return { accepted: true, id: `${id}_1` }
    },
  }
}

const originalFetch = global.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
  resetMailProvidersForTests()
  jest.restoreAllMocks()
})

describe('which provider carries the mail', () => {
  it('is Resend when nothing is configured, so a skipped send names its key', async () => {
    environment({ USAGE_EMAIL_FROM: FROM })
    expect(mailProvider().id).toBe('resend')
    expect(mailProvider().missingSettings()).toEqual(['RESEND_API_KEY'])

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', context: 'invite' })
    expect(result).toEqual({ sent: false, reason: 'unconfigured' })
    expect(warn).toHaveBeenCalledWith(
      'invite email skipped — set RESEND_API_KEY to deliver mail',
    )
  })

  it('keeps Resend for a deployment that has its key, whatever else is set', () => {
    environment({ RESEND_API_KEY: 're_test', AGLYN_MAIL_WEBHOOK_URL: 'https://relay.internal/send' })
    expect(mailProvider().id).toBe('resend')
  })

  it('finds the operator’s own relay when that is all a deployment set', () => {
    environment({ AGLYN_MAIL_WEBHOOK_URL: 'https://relay.internal/send' })
    expect(mailProvider().id).toBe('webhook')
  })

  it('takes an explicit choice over detection', () => {
    environment({
      AGLYN_MAIL_PROVIDER: 'Webhook',
      RESEND_API_KEY: 're_test',
      AGLYN_MAIL_WEBHOOK_URL: 'https://relay.internal/send',
    })
    expect(mailProvider().id).toBe('webhook')
  })
})

/*
 * THE FAILURE DIRECTION. A provider the operator named and this process
 * does not have must stop the mail and say so — never fall back to the
 * vendor detection would have picked, which would hand the deployment's
 * recipients and bodies to a provider nobody chose.
 */
describe('a named provider this process does not have', () => {
  it('sends nothing, through nobody, and says why as an error', async () => {
    environment({ AGLYN_MAIL_PROVIDER: 'smtp', RESEND_API_KEY: 're_test', USAGE_EMAIL_FROM: FROM })
    const fetchMock = mockFetch({})
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', context: 'invite' })

    expect(result).toMatchObject({ sent: false, reason: 'unconfigured' })
    expect((result as { detail?: string }).detail).toMatch(/AGLYN_MAIL_PROVIDER is "smtp"/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^invite email not sent — AGLYN_MAIL_PROVIDER/))
    expect(isEmailConfigured()).toBe(false)
    expect(mailProviderProblem()).toMatch(/not a built-in mail provider \(resend, webhook\)/)
    expect(mailProviderReads().unmet()).toMatch(/AGLYN_MAIL_PROVIDER is "smtp"/)
  })

  it('is the registered provider once one is, and every policy runs before it', async () => {
    environment({ AGLYN_MAIL_PROVIDER: 'smtp', USAGE_EMAIL_FROM: FROM })
    const smtp = recordingProvider('smtp')
    registerMailProvider(smtp)

    const result = await sendEmail({ to: ' a@example.com ', subject: 'Hi', text: 'Hello', context: 'invite', fromName: 'Acme' })

    expect(result).toEqual({ sent: true, id: 'smtp_1' })
    expect(mailProviderProblem()).toBeNull()
    expect(smtp.sent).toHaveLength(1)
    expect(smtp.sent[0]).toMatchObject({
      from: '"Acme" <noreply@aglyn.com>',
      to: ['a@example.com'],
      subject: 'Hi',
      text: 'Hello',
      tags: [{ name: 'context', value: 'invite' }],
    })
    // The HTML part is synthesized before the provider sees the message.
    expect(smtp.sent[0].html).toContain('Hello')
  })
})

describe('registering a provider', () => {
  it('refuses a built-in id, and a second provider under a taken one', () => {
    expect(() => registerMailProvider(recordingProvider('resend'))).toThrow(/built-in/)
    const first = recordingProvider('smtp')
    registerMailProvider(first)
    registerMailProvider(first)
    expect(() => registerMailProvider(recordingProvider('smtp'))).toThrow(/already registered/)
  })

  it('is seen by a second copy of the module, as a route bundle sees boot’s', () => {
    environment({ AGLYN_MAIL_PROVIDER: 'smtp' })
    registerMailProvider(recordingProvider('smtp'))
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require('./mail-providers') as typeof import('./mail-providers')
      expect(copy.mailProvider().id).toBe('smtp')
      expect(copy.mailProviderProblem()).toBeNull()
    })
  })
})

describe('the webhook provider', () => {
  const RELAY = 'https://relay.internal/send'

  it('posts the decided message, bearer and all, and keeps the relay’s id', async () => {
    environment({ AGLYN_MAIL_WEBHOOK_URL: RELAY, AGLYN_MAIL_WEBHOOK_TOKEN: 'tok', USAGE_EMAIL_FROM: FROM })
    const fetchMock = mockFetch({})

    const result = await sendEmail({
      to: 'a@example.com',
      subject: 'Hi',
      text: 'Hello',
      context: 'invite',
      replyTo: 'help@aglyn.com',
      bcc: 'copy@invite.example.com',
    })

    expect(result).toEqual({ sent: true, id: 'relay_1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(RELAY)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      type: 'mail.send',
      version: 1,
      context: 'invite',
      message: {
        from: FROM,
        to: ['a@example.com'],
        subject: 'Hi',
        text: 'Hello',
        replyTo: 'help@aglyn.com',
        bcc: ['copy@invite.example.com'],
        tags: [{ name: 'context', value: 'invite' }],
      },
    })
    expect(body.message.html).toContain('Hello')
  })

  it('sends no Authorization header without a token, and a null id when the relay has none', async () => {
    environment({ AGLYN_MAIL_WEBHOOK_URL: RELAY, USAGE_EMAIL_FROM: FROM })
    const fetchMock = mockFetch({ json: async () => ({}) })
    expect(await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'x' })).toEqual({ sent: true, id: null })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('reads a 429 as a request to slow down, and anything else as a refusal', async () => {
    environment({ AGLYN_MAIL_WEBHOOK_URL: RELAY, USAGE_EMAIL_FROM: FROM })
    mockFetch({
      ok: false,
      status: 429,
      text: async () => 'slow down',
      headers: { get: (name: string) => (name === 'retry-after' ? '30' : null) } as never,
    })
    const before = Date.now()
    const deferred = await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'x' })
    expect(deferred).toMatchObject({ sent: false, reason: 'rate-limited', status: 429, detail: 'slow down' })
    expect((deferred as { retryAtMs: number }).retryAtMs).toBeGreaterThanOrEqual(before + 30_000)

    mockFetch({ ok: false, status: 400, text: async () => 'bad address' })
    expect(await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'x' })).toEqual({
      sent: false,
      reason: 'rejected',
      status: 400,
      detail: 'bad address',
    })
  })

  it('names its URL when it has none, and answers every read with why it cannot', () => {
    environment({ AGLYN_MAIL_PROVIDER: 'webhook' })
    expect(mailProvider().missingSettings()).toEqual(['AGLYN_MAIL_WEBHOOK_URL'])
    expect(mailProviderReads().unmet()).toMatch(/"webhook" mail provider cannot read/)
    expect(normalizeDeliveryEvents({ type: 'email.delivered' }, 1)).toEqual([])
    expect(readInboundMailEvent({ type: 'email.received', data: { email_id: 'x' } })).toBeNull()
  })

  it('leaves out what a message does not carry', () => {
    expect(mailWebhookBody({ from: FROM, to: ['a@example.com'], subject: 'Hi' })).toEqual({
      type: 'mail.send',
      version: 1,
      message: { from: FROM, to: ['a@example.com'], subject: 'Hi' },
    })
  })
})

describe('what the platform asks the default provider', () => {
  it('reads a delivery event and an inbound notification through Resend', () => {
    environment({})
    const [event] = normalizeDeliveryEvents(
      { type: 'email.delivered', data: { email_id: 'm1', to: ['A@Example.com'] } },
      42,
    )
    expect(event).toMatchObject({ type: 'delivered', provider: 'resend', providerMessageId: 'm1', to: 'a@example.com', at: 42 })
    expect(
      readInboundMailEvent({ type: 'email.received', data: { email_id: 'r1', to: ['x@in.example.com'], cc: ['y@example.com'] } }),
    ).toEqual({ id: 'r1', recipients: ['x@in.example.com', 'y@example.com'] })
  })

  it('asks for the full-access key before any read', async () => {
    environment({ RESEND_API_KEY: 're_send_only' })
    const fetchMock = mockFetch({})
    const reads = mailProviderReads()
    expect(reads.unmet()).toBe('Set RESEND_READ_API_KEY to a full-access key. The sending key cannot read mail.')
    await expect(reads.message('m1')).rejects.toThrow(/RESEND_READ_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
