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
import { smsInboundRoute } from './inbound-route'

/** Twilio's inbound webhook records STOP and START only when signed (AGL-3610). */

const URL_ = 'https://console.example/api/sms/inbound'

function sign(params: Record<string, string>, token = 'secret-token') {
  const payload =
    URL_ +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join('')
  return createHmac('sha1', token).update(payload).digest('base64')
}

function post(params: Record<string, string>, signature: string) {
  return new Request(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    body: new URLSearchParams(params).toString(),
  })
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = 'secret-token'
})
afterEach(() => {
  delete process.env.TWILIO_AUTH_TOKEN
})

describe('smsInboundRoute', () => {
  const params = { From: '+15555550100', Body: 'STOP', To: '+15555550199' }

  it('records a signed STOP and answers empty TwiML', async () => {
    const applyKeyword = jest.fn(async () => ({ verdict: 'stop', applied: true }))
    const response = await smsInboundRoute(post(params, sign(params)), { applyKeyword })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<Response></Response>')
    expect(applyKeyword).toHaveBeenCalledWith({ from: '+15555550100', body: 'STOP' })
  })

  it('refuses an unsigned or forged request without touching the list', async () => {
    const applyKeyword = jest.fn()
    expect((await smsInboundRoute(post(params, ''), { applyKeyword })).status).toBe(403)
    expect(
      (await smsInboundRoute(post(params, sign(params, 'wrong')), { applyKeyword })).status,
    ).toBe(403)
    expect(
      (
        await smsInboundRoute(post({ ...params, Body: 'START' }, sign(params)), {
          applyKeyword,
        })
      ).status,
    ).toBe(403)
    expect(applyKeyword).not.toHaveBeenCalled()
  })

  it('answers 500 so Twilio retries when the opt-out could not be recorded', async () => {
    const response = await smsInboundRoute(post(params, sign(params)), {
      applyKeyword: async () => {
        throw new Error('firestore down')
      },
    })
    expect(response.status).toBe(500)
  })

  it('takes POST only', async () => {
    expect((await smsInboundRoute(new Request(URL_))).status).toBe(405)
  })
})
