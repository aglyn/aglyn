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

import { checkEmailCredentials, describeEmailConfig } from './email-health'

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

  it('treats a validation rejection as a working key', async () => {
    configure('re_test', null)
    mockStatus(422, 'Missing required field: from')

    expect(await checkEmailCredentials()).toEqual({
      status: 'ok',
      probeStatus: 422,
    })
  })

  it('treats 401 as an invalid key', async () => {
    configure('re_test', null)
    mockStatus(401, 'API key is invalid')

    expect(await checkEmailCredentials()).toEqual({
      status: 'invalid-key',
      probeStatus: 401,
      detail: 'API key is invalid',
    })
  })

  it('treats 403 as an invalid key', async () => {
    configure('re_test', null)
    mockStatus(403, 'restricted')

    expect(await checkEmailCredentials()).toMatchObject({
      status: 'invalid-key',
      probeStatus: 403,
    })
  })

  it('probes with an empty body so no message can be created', async () => {
    configure('re_test', null)
    const fetchMock = mockStatus(422)
    await checkEmailCredentials()

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    const payload = JSON.parse(init.body)
    expect(payload.to).toBeUndefined()
    expect(payload.from).toBeUndefined()
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
})
