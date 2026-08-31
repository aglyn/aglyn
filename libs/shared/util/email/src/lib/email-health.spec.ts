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

import {
  RESEND_DOMAINS_ENDPOINT,
  checkEmailCredentials,
  describeEmailConfig,
} from './email-health'
import { RESEND_SEND_ENDPOINT, sendEmail } from './send-email'

function configure(apiKey: string | null, from: string | null) {
  if (apiKey === null) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = apiKey
  if (from === null) delete process.env.USAGE_EMAIL_FROM
  else process.env.USAGE_EMAIL_FROM = from
}

describe('describeEmailConfig', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('reports configured when both vars are present', () => {
    configure('re_test', 'Aglyn <noreply@aglyn.com>')
    expect(describeEmailConfig()).toEqual({
      configured: true,
      hasApiKey: true,
      hasFrom: true,
      from: 'Aglyn <noreply@aglyn.com>',
      fromDomain: 'aglyn.com',
    })
  })

  it('never includes the API key', () => {
    configure('re_supersecret', 'Aglyn <noreply@aglyn.com>')
    expect(JSON.stringify(describeEmailConfig())).not.toContain('supersecret')
  })

  it('distinguishes a missing key from a missing sender', () => {
    configure(null, 'Aglyn <noreply@aglyn.com>')
    expect(describeEmailConfig()).toMatchObject({
      configured: false,
      hasApiKey: false,
      hasFrom: true,
    })

    configure('re_test', null)
    expect(describeEmailConfig()).toMatchObject({
      configured: false,
      hasApiKey: true,
      hasFrom: false,
      from: null,
      fromDomain: null,
    })
  })

  it('parses a bare address without display name', () => {
    configure('re_test', 'noreply@aglyn.com')
    expect(describeEmailConfig().fromDomain).toBe('aglyn.com')
  })

  it('surfaces a sender domain that is not aglyn.com', () => {
    configure('re_test', 'Aglyn <noreply@aglyn.app>')
    expect(describeEmailConfig().fromDomain).toBe('aglyn.app')
  })

  it('reports a null domain for an unparseable sender', () => {
    configure('re_test', 'not an address')
    expect(describeEmailConfig().fromDomain).toBeNull()
  })
})

describe('checkEmailCredentials', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  function mockStatus(status: number, body = '') {
    const fetchMock = jest.fn().mockResolvedValue({
      status,
      text: async () => body,
    })
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('returns unconfigured without probing when there is no key', async () => {
    configure(null, null)
    const fetchMock = mockStatus(422)

    expect(await checkEmailCredentials()).toEqual({ status: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /*
   * The probe must not aim at the send endpoint.
   *
   * It used to POST `{}` to `POST /emails`, which Resend answers `422
   * missing_required_field` — an API call spent, and a line in the account's
   * logs with no recipient, no subject and nothing naming the caller, which
   * an operator reading that dashboard can only read as failed mail. This
   * asserts the request itself, not the verdict, because every verdict below
   * was equally green while the probe was doing exactly that.
   */
  it('never touches the send endpoint', async () => {
    configure('re_test', null)
    const fetchMock = mockStatus(200, '{"data":[]}')

    await checkEmailCredentials()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(RESEND_DOMAINS_ENDPOINT)
    expect(url).not.toBe(RESEND_SEND_ENDPOINT)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    for (const [called] of fetchMock.mock.calls) {
      expect(String(called)).not.toContain('/emails')
    }
  })

  it('treats a readable domains list as a working key', async () => {
    configure('re_test', null)
    mockStatus(200, '{"data":[]}')

    expect(await checkEmailCredentials()).toEqual({
      status: 'ok',
      probeStatus: 200,
    })
  })

  it('treats a sending-scoped key denied the read as a working key', async () => {
    configure('re_test', null)
    mockStatus(
      401,
      '{"statusCode":401,"name":"restricted_api_key","message":"This API key is restricted to only send emails"}',
    )

    expect(await checkEmailCredentials()).toEqual({
      status: 'ok',
      probeStatus: 401,
    })
  })

  it('treats a 403 permission denial as a working key', async () => {
    configure('re_test', null)
    mockStatus(
      403,
      '{"statusCode":403,"name":"invalid_permission","message":"This API key is restricted"}',
    )

    expect(await checkEmailCredentials()).toMatchObject({ status: 'ok' })
  })

  it('treats a refused credential as an invalid key', async () => {
    configure('re_test', null)
    mockStatus(
      401,
      '{"statusCode":401,"name":"validation_error","message":"API key is invalid"}',
    )

    expect(await checkEmailCredentials()).toMatchObject({
      status: 'invalid-key',
      probeStatus: 401,
    })
  })

  it('treats a suspended key as an invalid key', async () => {
    configure('re_test', null)
    mockStatus(403, '{"statusCode":403,"name":"suspended_api_key"}')

    expect(await checkEmailCredentials()).toMatchObject({
      status: 'invalid-key',
      probeStatus: 403,
    })
  })

  it('reports unknown, not invalid-key, for an unrecognized rejection', async () => {
    configure('re_test', null)
    mockStatus(401, 'gateway said no')

    expect(await checkEmailCredentials()).toMatchObject({
      status: 'unknown',
      probeStatus: 401,
    })
  })

  it('reports unknown for an unexpected status', async () => {
    configure('re_test', null)
    mockStatus(500, 'upstream error')

    expect(await checkEmailCredentials()).toMatchObject({
      status: 'unknown',
      probeStatus: 500,
    })
  })

  it('reports unknown rather than throwing on a network failure', async () => {
    configure('re_test', null)
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('dns failure')) as unknown as typeof fetch

    expect(await checkEmailCredentials()).toEqual({
      status: 'unknown',
      detail: 'dns failure',
    })
  })

  /*
   * THE CONTROL.
   *
   * Everything above asserts that something does NOT reach the send endpoint,
   * and every one of those assertions would also pass if the send endpoint
   * had simply become unreachable. This proves real mail still goes out over
   * exactly the transport the probe was told to stop using.
   */
  it('still lets a well-formed send reach the send endpoint', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    configure('re_test', 'Aglyn <noreply@aglyn.com>')
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_123' }),
      text: async () => '',
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await sendEmail({
      to: 'someone@example.com',
      subject: 'Hi',
      text: 'Body',
      context: 'invite',
    })

    expect(result).toEqual({ sent: true, id: 'email_123' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(RESEND_SEND_ENDPOINT)
    expect(JSON.parse(init.body).to).toEqual(['someone@example.com'])
  })
})
