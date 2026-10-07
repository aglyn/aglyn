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

import { createHmac } from 'crypto'
import { smsSegmentCount } from './sms-provider'
import { createTwilioSmsProvider, verifyTwilioSignature } from './twilio-provider'

/**
 * The Twilio adapter (AGL-3610). No network: `fetch` is injected, and every
 * case asserts the exact request the adapter would have made.
 */

const ENV = {
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'secret-token',
  TWILIO_MESSAGING_SERVICE_SID: 'MG456',
}

function withEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() =>
  withEnv({
    TWILIO_ACCOUNT_SID: undefined,
    TWILIO_AUTH_TOKEN: undefined,
    TWILIO_MESSAGING_SERVICE_SID: undefined,
  }),
)

describe('createTwilioSmsProvider', () => {
  it('is unconfigured until all three variables are set, and then sends nothing without them', async () => {
    const fetch = jest.fn()
    const provider = createTwilioSmsProvider({ fetch: fetch as never })
    expect(provider.isConfigured()).toBe(false)
    withEnv({ ...ENV, TWILIO_MESSAGING_SERVICE_SID: undefined })
    expect(provider.isConfigured()).toBe(false)
    expect(await provider.send({ to: '+15555550100', body: 'hi' })).toEqual({
      ok: false,
      error: 'Twilio is not configured',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts through the Messaging Service with basic auth and reads the segments back', async () => {
    withEnv(ENV)
    const fetch = jest.fn(async () =>
      new Response(JSON.stringify({ sid: 'SM1', num_segments: '2' }), { status: 201 }),
    )
    const provider = createTwilioSmsProvider({ fetch: fetch as never })
    expect(await provider.send({ to: '+15555550100', body: 'Your order shipped' })).toEqual({
      ok: true,
      id: 'SM1',
      segments: 2,
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC123:secret-token').toString('base64')}`,
    )
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      To: '+15555550100',
      Body: 'Your order shipped',
      MessagingServiceSid: 'MG456',
    })
  })

  it('flags the codes that mean the number cannot be texted', async () => {
    withEnv(ENV)
    const fetch = jest.fn(async () =>
      new Response(JSON.stringify({ code: 21610, message: 'unsubscribed' }), { status: 400 }),
    )
    const provider = createTwilioSmsProvider({ fetch: fetch as never })
    expect(await provider.send({ to: '+15555550100', body: 'x' })).toEqual({
      ok: false,
      error: 'unsubscribed',
      invalidNumber: true,
    })
  })

  it('reports an unreachable API without throwing', async () => {
    withEnv(ENV)
    const provider = createTwilioSmsProvider({
      fetch: (async () => {
        throw new Error('ECONNRESET')
      }) as never,
    })
    expect(await provider.send({ to: '+1', body: 'x' })).toEqual({
      ok: false,
      error: 'Twilio unreachable: ECONNRESET',
    })
  })
})

describe('verifyTwilioSignature', () => {
  const url = 'https://console.example/api/sms/inbound'
  const params = { From: '+15555550100', Body: 'STOP', To: '+15555550199' }
  // Built by hand, in Twilio's documented order: URL, then each parameter
  // name immediately followed by its value, names sorted.
  const signed =
    'https://console.example/api/sms/inbound' +
    'BodySTOP' +
    'From+15555550100' +
    'To+15555550199'
  const signature = createHmac('sha1', 'secret-token').update(signed).digest('base64')

  it('accepts the signature Twilio would send', () => {
    expect(verifyTwilioSignature({ url, params, signature, authToken: 'secret-token' })).toBe(true)
  })

  it('refuses a changed body, a different URL, another token, or no token at all', () => {
    expect(
      verifyTwilioSignature({ url, params: { ...params, Body: 'START' }, signature, authToken: 'secret-token' }),
    ).toBe(false)
    expect(
      verifyTwilioSignature({ url: `${url}?x=1`, params, signature, authToken: 'secret-token' }),
    ).toBe(false)
    expect(verifyTwilioSignature({ url, params, signature, authToken: 'other' })).toBe(false)
    expect(verifyTwilioSignature({ url, params, signature })).toBe(false)
  })
})

describe('smsSegmentCount', () => {
  it('counts GSM-7 and UCS-2 the way carriers bill them', () => {
    expect(smsSegmentCount('')).toBe(0)
    expect(smsSegmentCount('a'.repeat(160))).toBe(1)
    expect(smsSegmentCount('a'.repeat(161))).toBe(2)
    expect(smsSegmentCount('€'.repeat(80))).toBe(1)
    expect(smsSegmentCount('€'.repeat(81))).toBe(2)
    expect(smsSegmentCount('Your order ✓')).toBe(1)
    expect(smsSegmentCount('✓'.repeat(71))).toBe(2)
  })
})
