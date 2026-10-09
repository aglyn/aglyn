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

import { hashUserData, sha256Hex, type ConversionEvent } from './event'
import { ProviderError } from './http'
import { META_GRAPH_VERSION, metaEventBody, sendMetaEvent } from './meta'
import { pinterestEventBody, sendPinterestEvent } from './pinterest'
import { sendTikTokEvent, TIKTOK_EVENTS_URL } from './tiktok'
import { createMockHttp } from '../testing/mock-http'

/**
 * The three adapters against mocked HTTP (AGL-3694): the exact request each
 * vendor is sent, the hashing it is sent with, and how each vendor's refusal
 * is read. Nothing here reaches a network.
 */

const SHA = {
  email: '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b',
  phoneDigits: 'd6736136ea896c1bfdc553e0e86e702c70d060d805696ca3e4e9e0961353860a',
  phoneE164: '8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4',
  john: '96d9632f363564cc3032521409cf22a852f2032eec099ed5967c0d000cec607a',
  zip: 'c884a209ebe08750a7d13db63bd02233b375bd79786cbe329ab11586cc35dead',
  us: '79adb2a2fce5c6ba215fe5f27f532d4e7edbac4b6a5e09e1ef3a08084a904621',
}

const user = hashUserData({
  email: '  Test@Example.com ',
  phone: '(555) 123-4567',
  name: 'John Q. Public',
  postalCode: '94107-1234',
  country: 'US',
})

const purchase: ConversionEvent = {
  id: 'purchase.cs_live_abc',
  name: 'purchase',
  occurredAtMs: Date.UTC(2026, 9, 8, 12, 0, 0),
  url: 'https://shop.example.com/cart',
  currency: 'USD',
  valueCents: 2599,
  orderId: 'cs_live_abc',
  items: [{ id: 'prod-1', name: 'Mug', quantity: 2, unitCents: 1250 }],
  user,
  browser: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0', fbp: 'fb.1.1.2', fbc: 'fb.1.1.abc', ttp: 'ttp-1', epik: 'epik-1' },
}

describe('hashing, per the vendors’ normalization', () => {
  it('trims and lower-cases the address before SHA-256', () => {
    expect(user.em).toBe(SHA.email)
    expect(sha256Hex('test@example.com')).toBe(SHA.email)
  })

  it('gives the phone its country code: digits for Meta and Pinterest, E.164 for TikTok', () => {
    expect(user.ph).toBe(SHA.phoneDigits)
    expect(user.phE164).toBe(SHA.phoneE164)
  })

  it('splits a full name, lower-cases it and drops punctuation; a US postal code is five digits', () => {
    expect(user.fn).toBe(SHA.john)
    expect(user.zp).toBe(SHA.zip)
    expect(user.country).toBe(SHA.us)
  })

  it('never keeps a raw value', () => {
    for (const value of Object.values(user)) expect(value).toMatch(/^[0-9a-f]{64}$/)
  })

  it('leaves out what it was not given', () => {
    expect(hashUserData({ email: 'not an address' })).toEqual({})
  })
})

describe('Meta Conversions API', () => {
  it('posts the event to the pixel with the shared event id, the token in the BODY', async () => {
    const { http, requests } = createMockHttp([[200, { events_received: 1 }]])
    await sendMetaEvent(http, { token: 'EAAB-secret', pixelId: '1234567890', adAccountId: null, test: null }, purchase)
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/1234567890/events`)
    expect(request.url).not.toContain('EAAB-secret')
    expect(request.body.access_token).toBe('EAAB-secret')
    expect(request.body.test_event_code).toBeUndefined()
    const [event] = request.body.data
    expect(event).toMatchObject({
      event_name: 'Purchase',
      event_id: 'purchase.cs_live_abc',
      event_time: Math.floor(purchase.occurredAtMs / 1000),
      action_source: 'website',
      event_source_url: 'https://shop.example.com/cart',
      user_data: {
        em: [SHA.email],
        ph: [SHA.phoneDigits],
        client_ip_address: '203.0.113.9',
        client_user_agent: 'Mozilla/5.0',
        fbp: 'fb.1.1.2',
        fbc: 'fb.1.1.abc',
      },
      custom_data: { currency: 'USD', value: 25.99, order_id: 'cs_live_abc', content_ids: ['prod-1'] },
    })
  })

  it('a test carries the test event code; a test with no code is refused, never sent live', async () => {
    expect(metaEventBody({ token: 't', pixelId: '1', adAccountId: null, test: 'TEST123' }, purchase).test_event_code).toBe('TEST123')
    const { http, requests } = createMockHttp()
    await expect(sendMetaEvent(http, { token: 't', pixelId: '1234567890', adAccountId: null, test: true }, purchase)).rejects.toThrow(ProviderError)
    expect(requests).toHaveLength(0)
  })

  it('reads Graph error 190 as a token to replace', async () => {
    const { http } = createMockHttp([[400, { error: { code: 190, message: 'Invalid OAuth access token' } }]])
    await expect(
      sendMetaEvent(http, { token: 't', pixelId: '1234567890', adAccountId: null, test: null }, purchase),
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  it('reads any other 400 as a refused event', async () => {
    const { http } = createMockHttp([[400, { error: { code: 100, message: 'Invalid parameter' } }]])
    await expect(
      sendMetaEvent(http, { token: 't', pixelId: '1234567890', adAccountId: null, test: null }, purchase),
    ).rejects.toMatchObject({ kind: 'invalid', message: 'Invalid parameter' })
  })
})

describe('TikTok Events API', () => {
  it('posts a web event to the pixel code, the token in Access-Token, the phone in E.164', async () => {
    const { http, requests } = createMockHttp([[200, { code: 0, message: 'OK' }]])
    await sendTikTokEvent(http, { token: 'tt-secret', pixelId: 'C4ABCDEFGH1234567890', adAccountId: null, test: 'TEST9' }, purchase)
    const [request] = requests
    expect(request.url).toBe(TIKTOK_EVENTS_URL)
    expect(request.headers['Access-Token']).toBe('tt-secret')
    expect(JSON.stringify(request.body)).not.toContain('tt-secret')
    expect(request.body).toMatchObject({ event_source: 'web', event_source_id: 'C4ABCDEFGH1234567890', test_event_code: 'TEST9' })
    expect(request.body.data[0]).toMatchObject({
      event: 'CompletePayment',
      event_id: 'purchase.cs_live_abc',
      user: { email: SHA.email, phone: SHA.phoneE164, ip: '203.0.113.9', user_agent: 'Mozilla/5.0', ttp: 'ttp-1' },
      properties: { currency: 'USD', value: 25.99, order_id: 'cs_live_abc' },
    })
  })

  it('reads a 200 with a non-zero code as the refusal it is', async () => {
    const { http } = createMockHttp([[200, { code: 40001, message: 'Access token is invalid' }]])
    await expect(
      sendTikTokEvent(http, { token: 't', pixelId: 'C4ABCDEFGH1234567890', adAccountId: null, test: null }, purchase),
    ).rejects.toMatchObject({ kind: 'auth' })
    const refused = createMockHttp([[200, { code: 40002, message: 'event_time is invalid' }]])
    await expect(
      sendTikTokEvent(refused.http, { token: 't', pixelId: 'C4ABCDEFGH1234567890', adAccountId: null, test: null }, purchase),
    ).rejects.toMatchObject({ kind: 'invalid' })
  })
})

describe('Pinterest Conversions API', () => {
  it('posts to the ad account with the bearer token, money as decimal strings, the click id from _epik', async () => {
    const { http, requests } = createMockHttp([[200, { events: [{ status: 'processed' }] }]])
    await sendPinterestEvent(http, { token: 'pina-secret', pixelId: null, adAccountId: '549755885175', test: null }, purchase)
    const [request] = requests
    expect(request.url).toBe('https://api.pinterest.com/v5/ad_accounts/549755885175/events')
    expect(request.headers.Authorization).toBe('Bearer pina-secret')
    expect(request.body.data[0]).toMatchObject({
      event_name: 'checkout',
      action_source: 'web',
      event_id: 'purchase.cs_live_abc',
      user_data: { em: [SHA.email], ph: [SHA.phoneDigits], click_id: 'epik-1', client_ip_address: '203.0.113.9' },
      custom_data: { currency: 'USD', value: '25.99', order_id: 'cs_live_abc' },
    })
  })

  it('marks a test with Pinterest’s own test flag', async () => {
    const { http, requests } = createMockHttp([[200, { events: [{ status: 'processed' }] }]])
    await sendPinterestEvent(http, { token: 't', pixelId: null, adAccountId: '549755885175', test: true }, purchase)
    expect(requests[0].url).toMatch(/\?test=true$/)
  })

  it('reads a failed event in a 200 as refused', async () => {
    const { http } = createMockHttp([[200, { events: [{ status: 'failed', error_message: 'event_time too old' }] }]])
    await expect(
      sendPinterestEvent(http, { token: 't', pixelId: null, adAccountId: '549755885175', test: null }, purchase),
    ).rejects.toMatchObject({ kind: 'invalid', message: 'event_time too old' })
  })

  it('a lead carries no custom data', () => {
    const body: any = pinterestEventBody({ ...purchase, name: 'lead', orderId: null, items: [], valueCents: null })
    expect(body.data[0].event_name).toBe('lead')
    expect(body.data[0].custom_data).toBeUndefined()
  })
})
