/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 *
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
 * AGL-1158: the Support request helper, which had no test until now.
 *
 * AGL-1157 put a body on a GET. `fetch` throws `TypeError` before opening a
 * connection, the bare `catch` turned that into an empty list, and it shipped —
 * invisible to typecheck and to the entire console suite, because nothing
 * exercised this code. One bad line took out the ticket list *and* the forum,
 * two independent features with one blast radius.
 *
 * So the first test below is that exact regression, asserted against a `fetch`
 * that throws the way the real one does rather than a mock that quietly
 * accepts anything.
 */

import { supportRequest, scopeToOrg } from '../utils/support-request'

const ok = (payload: unknown = { items: [] }) =>
  jest.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch

/** A `fetch` that enforces the real GET-may-not-have-a-body rule. */
const strictFetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
  const method = (init?.method ?? 'GET').toUpperCase()
  if ((method === 'GET' || method === 'HEAD') && init?.body != null) {
    throw new TypeError(
      `Request with ${method} method cannot have body.`,
    )
  }
  return { ok: true, json: async () => ({ items: [] }) }
}) as unknown as typeof fetch

const deps = (over: Partial<Parameters<typeof supportRequest>[0]> = {}) => ({
  getIdToken: async () => 'tok',
  orgId: 'org-1',
  onError: jest.fn(),
  ...over,
})

describe('supportRequest (AGL-1158)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('REGRESSION — a GET carries no body, even when an org is scoped', async () => {
    // The AGL-1157 bug exactly. Against a fetch that throws like the real one,
    // a helper that attached the org to the body would reject here and return
    // null — an empty list with no request, no status and no error text.
    const d = deps({ fetchImpl: strictFetch })
    const result = await supportRequest(d, '/api/support/tickets', 'GET')
    expect(result).toEqual({ items: [] })
    expect(d.onError).not.toHaveBeenCalled()
    const init = (strictFetch as unknown as jest.Mock).mock.calls[0][1]
    expect(init.body).toBeUndefined()
  })

  it('still scopes a GET to the org, on the QUERY', async () => {
    // Dropping the body must not drop the org — the routes read
    // `query.orgId ?? payload.orgId`, and AGL-1147 was the reverse mistake.
    const fetchImpl = ok()
    await supportRequest(deps({ fetchImpl }), '/api/support/tickets', 'GET')
    const url = (fetchImpl as unknown as jest.Mock).mock.calls[0][0]
    expect(url).toBe('/api/support/tickets?orgId=org-1')
  })

  it('CONTROL — a POST still sends the org in the body', async () => {
    // Without this, "GET has no body" is satisfied by a helper that never
    // sends a body at all, which would break every write on the page.
    const fetchImpl = ok({ ok: true })
    await supportRequest(deps({ fetchImpl }), '/api/support/tickets', 'POST', {
      subject: 'Help',
    })
    const init = (fetchImpl as unknown as jest.Mock).mock.calls[0][1]
    expect(JSON.parse(init.body)).toEqual({ subject: 'Help', orgId: 'org-1' })
  })

  it('reports a failed response instead of returning it', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Not entitled' }),
    })) as unknown as typeof fetch
    const d = deps({ fetchImpl })
    await expect(
      supportRequest(d, '/api/support/tickets', 'GET'),
    ).resolves.toBeNull()
    // The user is told which failure it was, not a generic toast.
    expect(d.onError).toHaveBeenCalledWith('Not entitled')
  })

  it('reports a thrown request rather than swallowing it', async () => {
    // The failure mode that let AGL-1157 ship: an empty list is
    // indistinguishable from "no tickets" unless something says otherwise.
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const d = deps({ fetchImpl })
    await expect(
      supportRequest(d, '/api/support/tickets', 'GET'),
    ).resolves.toBeNull()
    expect(d.onError).toHaveBeenCalledWith('An error has occurred')
  })

  it('survives a response that is not JSON', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      json: async () => {
        throw new Error('not json')
      },
    })) as unknown as typeof fetch
    const d = deps({ fetchImpl })
    await expect(
      supportRequest(d, '/api/support/tickets', 'GET'),
    ).resolves.toBeNull()
    expect(d.onError).toHaveBeenCalledWith('Request failed')
  })

  it('omits Authorization when there is no token', async () => {
    const fetchImpl = ok()
    await supportRequest(
      deps({ fetchImpl, getIdToken: async () => undefined }),
      '/api/support/forum',
      'GET',
    )
    const init = (fetchImpl as unknown as jest.Mock).mock.calls[0][1]
    expect(init.headers.Authorization).toBeUndefined()
  })

  describe('scopeToOrg', () => {
    it('uses ? or & correctly', () => {
      expect(scopeToOrg('/a', 'o1')).toBe('/a?orgId=o1')
      // The forum loader passes `?category=…`, so this branch is live.
      expect(scopeToOrg('/a?category=x', 'o1')).toBe('/a?category=x&orgId=o1')
    })

    it('leaves the path alone before the org resolves (AGL-1154)', () => {
      // A request fired before `orgId` lands must not invent one.
      expect(scopeToOrg('/a', undefined)).toBe('/a')
    })

    it('encodes an org id that needs it', () => {
      expect(scopeToOrg('/a', 'o 1&x')).toBe('/a?orgId=o%201%26x')
    })
  })
})
