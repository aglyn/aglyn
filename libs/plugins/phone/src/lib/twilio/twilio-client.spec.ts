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

import { createTwilioClient, signTwilioWebhook, TwilioError, verifyTwilioWebhookSignature } from './twilio-client'
import { escapeXml, twiml } from './twiml'

function fakeFetch(answer: unknown = {}, status = 200) {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    return new Response(JSON.stringify(answer), { status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests }
}

const basic = (init: RequestInit) =>
  Buffer.from(String((init.headers as Record<string, string>)['Authorization']).slice(6), 'base64').toString()

describe('Twilio client (AGL-4251)', () => {
  it('reports itself unconfigured and refuses to call without the parent credentials', async () => {
    const { fetch, requests } = fakeFetch()
    const client = createTwilioClient({ fetch, accountSid: '', authToken: '' })
    expect(client.isConfigured()).toBe(false)
    await expect(client.createSubaccount('x')).rejects.toBeInstanceOf(TwilioError)
    expect(requests).toHaveLength(0)
  })

  it('sends a text in the subaccount with the parent credentials', async () => {
    const { fetch, requests } = fakeFetch({ sid: 'SM1', status: 'queued', num_segments: '2' })
    const client = createTwilioClient({ fetch, accountSid: 'AC_parent', authToken: 'tok' })
    const sent = await client.sendMessage('AC_sub', { from: '+1', to: '+2', body: 'hi', statusCallback: 'https://x/cb' })
    expect(sent).toEqual({ sid: 'SM1', status: 'queued', segments: 2 })
    expect(requests[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC_sub/Messages.json')
    expect(basic(requests[0].init)).toBe('AC_parent:tok')
    expect(String(requests[0].init.body)).toContain('StatusCallback=https%3A%2F%2Fx%2Fcb')
  })

  it('authenticates a v1 call as the subaccount', async () => {
    const { fetch, requests } = fakeFetch({ status: 'APPROVED' })
    const client = createTwilioClient({ fetch, accountSid: 'AC_parent', authToken: 'tok' })
    await client.readA2pBrand('AC_sub', 'BN1')
    expect(requests[0].url).toBe('https://messaging.twilio.com/v1/a2p/BrandRegistrations/BN1')
    expect(basic(requests[0].init)).toBe('AC_sub:tok')
  })

  it('turns a refusal into a TwilioError with its code', async () => {
    const { fetch } = fakeFetch({ code: 21211, message: 'Invalid To' }, 400)
    const client = createTwilioClient({ fetch, accountSid: 'AC', authToken: 't' })
    await expect(client.sendMessage('AC', { from: '+1', to: 'x', body: 'b', statusCallback: '' })).rejects.toMatchObject({
      status: 400,
      code: 21211,
    })
  })

  it('verifies a webhook signature only with the right token and URL', () => {
    const params = { Body: 'hi', From: '+1' }
    const signature = signTwilioWebhook('https://app/x', params, 'tok')
    expect(verifyTwilioWebhookSignature({ url: 'https://app/x', params, signature, authToken: 'tok' })).toBe(true)
    expect(verifyTwilioWebhookSignature({ url: 'https://app/y', params, signature, authToken: 'tok' })).toBe(false)
    expect(verifyTwilioWebhookSignature({ url: 'https://app/x', params, signature, authToken: '' })).toBe(false)
  })
})

describe('TwiML (AGL-4251)', () => {
  it('escapes every value', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
    expect(twiml([{ verb: 'Say', text: 'Tom & Jerry <3' }])).toContain('Tom &amp; Jerry &lt;3')
  })
})
