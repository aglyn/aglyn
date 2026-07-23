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
  RESEND_SEND_ENDPOINT,
  isEmailConfigured,
  sendEmail,
} from './send-email'

const FROM = 'Aglyn <noreply@aglyn.com>'

/**
 * Every test sets or deletes both vars explicitly rather than trusting the
 * ambient environment: `nx test` injects the root `.env`, which would
 * otherwise hand the "unconfigured" cases a real key and turn a genuinely
 * broken guard green.
 */
function configure(apiKey: string | null, from: string | null) {
  if (apiKey === null) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = apiKey
  if (from === null) delete process.env.USAGE_EMAIL_FROM
  else process.env.USAGE_EMAIL_FROM = from
}

function mockFetch(response: Partial<Response> & { json?: () => unknown }) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'email_123' }),
    text: async () => '',
    ...response,
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function lastBody(fetchMock: jest.Mock) {
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

describe('sendEmail', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
  })

  describe('configuration guard', () => {
    it('skips without an API key and does not call Resend', async () => {
      configure(null, FROM)
      const fetchMock = mockFetch({})

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'unconfigured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips without a from address and does not call Resend', async () => {
      configure('re_test', null)
      const fetchMock = mockFetch({})

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'unconfigured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('treats empty-string env vars as unset', async () => {
      configure('', '')
      const fetchMock = mockFetch({})

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'unconfigured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports isEmailConfigured only when both vars are present', () => {
      configure(null, null)
      expect(isEmailConfigured()).toBe(false)
      configure('re_test', null)
      expect(isEmailConfigured()).toBe(false)
      configure(null, FROM)
      expect(isEmailConfigured()).toBe(false)
      configure('re_test', FROM)
      expect(isEmailConfigured()).toBe(true)
    })

    it('reads env at call time, not at module load', async () => {
      configure(null, null)
      expect(isEmailConfigured()).toBe(false)

      configure('re_test', FROM)
      const fetchMock = mockFetch({})
      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: true, id: 'email_123' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('recipients', () => {
    beforeEach(() => configure('re_test', FROM))

    it('normalizes a single address into an array', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({ to: 'a@example.com', subject: 'Hi' })
      expect(lastBody(fetchMock).to).toEqual(['a@example.com'])
    })

    it('trims and drops entries that are not addresses', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: [' a@example.com ', '', 'not-an-address', 'b@example.com'],
        subject: 'Hi',
      })
      expect(lastBody(fetchMock).to).toEqual([
        'a@example.com',
        'b@example.com',
      ])
    })

    it('skips the send when no recipient survives normalization', async () => {
      const fetchMock = mockFetch({})
      const result = await sendEmail({ to: ['', 'nope'], subject: 'Hi' })

      expect(result).toEqual({ sent: false, reason: 'no-recipient' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('request shape', () => {
    beforeEach(() => configure('re_test', FROM))

    it('posts to Resend with the configured sender and bearer auth', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Body' })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(RESEND_SEND_ENDPOINT)
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer re_test')
      expect(init.headers['Content-Type']).toBe('application/json')
      expect(lastBody(fetchMock)).toEqual({
        from: FROM,
        to: ['a@example.com'],
        subject: 'Hi',
        text: 'Body',
      })
    })

    it('omits optional fields that were not supplied', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      const body = lastBody(fetchMock)
      expect(body).not.toHaveProperty('html')
      expect(body).not.toHaveProperty('headers')
      expect(body).not.toHaveProperty('tags')
      expect(body).not.toHaveProperty('reply_to')
    })

    it('passes through html, headers, tags and reply-to', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        text: 'Body',
        html: '<p>Body</p>',
        headers: { 'List-Unsubscribe': '<https://example.com/u>' },
        tags: [{ name: 'hostId', value: 'host_1' }],
        replyTo: 'hello@aglyn.com',
      })

      expect(lastBody(fetchMock)).toEqual({
        from: FROM,
        to: ['a@example.com'],
        subject: 'Hi',
        text: 'Body',
        html: '<p>Body</p>',
        headers: { 'List-Unsubscribe': '<https://example.com/u>' },
        tags: [{ name: 'hostId', value: 'host_1' }],
        reply_to: 'hello@aglyn.com',
      })
    })

    it('lets an explicit from override the configured sender', async () => {
      const fetchMock = mockFetch({})
      await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        from: 'Support <help@aglyn.com>',
      })
      expect(lastBody(fetchMock).from).toBe('Support <help@aglyn.com>')
    })

    it('sends when only from is overridden and env has no sender', async () => {
      configure('re_test', null)
      const fetchMock = mockFetch({})
      const result = await sendEmail({
        to: 'a@example.com',
        subject: 'Hi',
        from: 'Support <help@aglyn.com>',
      })

      expect(result).toEqual({ sent: true, id: 'email_123' })
      expect(lastBody(fetchMock).from).toBe('Support <help@aglyn.com>')
    })
  })

  describe('failure handling', () => {
    beforeEach(() => configure('re_test', FROM))

    it('reports a rejection with status and detail', async () => {
      mockFetch({
        ok: false,
        status: 422,
        text: async () => 'The aglyn.com domain is not verified',
      })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({
        sent: false,
        reason: 'rejected',
        status: 422,
        detail: 'The aglyn.com domain is not verified',
      })
    })

    it('reports an invalid key as a rejection rather than throwing', async () => {
      mockFetch({ ok: false, status: 401, text: async () => 'Invalid key' })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toMatchObject({
        sent: false,
        reason: 'rejected',
        status: 401,
      })
    })

    it('never rejects when fetch itself throws', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('socket hang up')) as unknown as
        typeof fetch

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({
        sent: false,
        reason: 'network',
        detail: 'socket hang up',
      })
    })

    it('still reports sent when the success body has no id', async () => {
      mockFetch({ json: async () => ({}) })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: true, id: null })
    })

    it('still reports sent when the success body is not json', async () => {
      mockFetch({
        json: async () => {
          throw new Error('not json')
        },
      })

      const result = await sendEmail({ to: 'a@example.com', subject: 'Hi' })

      expect(result).toEqual({ sent: true, id: null })
    })

    it('labels log output with the caller context', async () => {
      const warn = jest.spyOn(console, 'warn')
      configure(null, null)

      await sendEmail({ to: 'a@example.com', subject: 'Hi', context: 'invite' })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invite email'))
    })
  })
})
