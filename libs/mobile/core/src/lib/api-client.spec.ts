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

import { ConsoleApiError, consoleErrorMessage, createConsoleApiClient } from './api-client'

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function client(responses: Array<Response | Error>, tokens: Array<string | null> = ['t1', 't2', 't3']) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const tokenCalls: boolean[] = []
  const api = createConsoleApiClient({
    origin: 'https://app.aglyn.com/',
    getIdToken: async (force) => {
      tokenCalls.push(Boolean(force))
      return tokens[Math.min(tokenCalls.length - 1, tokens.length - 1)]
    },
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} })
      const next = responses.shift()
      if (!next) throw new Error('no response queued')
      if (next instanceof Error) throw next
      return next
    },
    sleep: async () => undefined,
  })
  return { api, calls, tokenCalls }
}

describe('createConsoleApiClient', () => {
  it('sends the ID token as a bearer and JSON both ways', async () => {
    const { api, calls } = client([json(200, { ok: 1 })])
    await expect(
      api.request('/api/commerce/pos-terminal-connection-token', { method: 'POST', body: { hostId: 'h1' } }),
    ).resolves.toEqual({ ok: 1 })
    expect(calls[0].url).toBe('https://app.aglyn.com/api/commerce/pos-terminal-connection-token')
    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer t1',
      'Content-Type': 'application/json',
    })
    expect(calls[0].init.body).toBe('{"hostId":"h1"}')
  })

  it('encodes the query', () => {
    const { api } = client([])
    expect(api.urlFor('/api/x', { a: 'b c', skip: undefined, n: 2 })).toBe('https://app.aglyn.com/api/x?a=b%20c&n=2')
  })

  it('refuses a path that could leave the console origin', () => {
    const { api } = client([])
    expect(() => api.urlFor('//evil.com/x')).toThrow()
    expect(() => api.urlFor('https://evil.com/x')).toThrow()
  })

  it('refreshes the token once on a 401, then gives up with the route words', async () => {
    const { api, tokenCalls } = client([json(401, {}), json(401, { error: 'Unauthenticated' })])
    await expect(api.request('/api/x')).rejects.toMatchObject({ status: 401, message: 'Unauthenticated' })
    expect(tokenCalls).toEqual([false, true])
  })

  it('retries a GET on a 503 and a network error', async () => {
    const { api, calls } = client([json(503, {}), new Error('offline'), json(200, { done: true })])
    await expect(api.request('/api/x')).resolves.toEqual({ done: true })
    expect(calls).toHaveLength(3)
  })

  it('never retries a POST without an idempotency key', async () => {
    const { api, calls } = client([json(503, { error: 'Busy' })])
    await expect(api.request('/api/x', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ConsoleApiError)
    expect(calls).toHaveLength(1)
  })

  it('retries a keyed POST and sends the key every time', async () => {
    const { api, calls } = client([json(502, {}), json(200, { id: 1 })])
    await api.request('/api/x', { method: 'POST', body: {}, idempotencyKey: 'k1' })
    expect(calls.map((call) => (call.init.headers as Record<string, string>)['Idempotency-Key'])).toEqual(['k1', 'k1'])
  })

  it('does not retry a 4xx', async () => {
    const { api, calls } = client([json(403, { error: 'Not permitted' })])
    await expect(api.request('/api/x')).rejects.toMatchObject({ status: 403, message: 'Not permitted' })
    expect(calls).toHaveLength(1)
  })

  it('asks for sign-in when there is no user', async () => {
    const { api, calls } = client([], [null])
    await expect(api.request('/api/x')).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(0)
  })

  it('reports an unreachable server after the last attempt', async () => {
    const { api } = client([new Error('a'), new Error('b'), new Error('c')])
    await expect(api.request('/api/x')).rejects.toMatchObject({ status: 0 })
  })
})

describe('consoleErrorMessage', () => {
  it('prefers the route message, then a plain one per status', () => {
    expect(consoleErrorMessage(400, { error: 'Missing hostId' })).toBe('Missing hostId')
    expect(consoleErrorMessage(403, null)).toMatch(/permission/)
    expect(consoleErrorMessage(500, 'x')).toMatch(/could not be reached/)
  })
})
