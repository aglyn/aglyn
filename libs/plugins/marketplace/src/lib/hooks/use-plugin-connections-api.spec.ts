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

const mockAuthorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: null }) }))

import { callPluginConnectionsRoute, PluginConnectionRouteError } from './use-plugin-connections-api'

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

describe('callPluginConnectionsRoute (AGL-4196)', () => {
  beforeEach(() => mockAuthorizedFetch.mockReset())

  it('GETs with the query and answers the body', async () => {
    mockAuthorizedFetch.mockResolvedValueOnce(json(200, { configured: true }))
    await expect(
      callPluginConnectionsRoute(null, 'plugin-connections/status', { method: 'GET', query: { hostId: 'h', listingId: 'l' } }),
    ).resolves.toEqual({ configured: true })
    expect(mockAuthorizedFetch).toHaveBeenCalledWith(null, '/api/plugin-connections/status?hostId=h&listingId=l', { method: 'GET' })
  })

  it('POSTs JSON', async () => {
    mockAuthorizedFetch.mockResolvedValueOnce(json(200, { connection: null }))
    await callPluginConnectionsRoute(null, 'plugin-connections/disconnect', { method: 'POST', body: { hostId: 'h' } })
    expect(mockAuthorizedFetch).toHaveBeenCalledWith(null, '/api/plugin-connections/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"hostId":"h"}',
    })
  })

  it('a refusal carries the route’s sentence, status and reason', async () => {
    mockAuthorizedFetch.mockResolvedValueOnce(json(403, { error: 'No plan', reason: 'plan' }))
    const error = await callPluginConnectionsRoute(null, 'x', { method: 'GET' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PluginConnectionRouteError)
    expect(error).toMatchObject({ message: 'No plan', status: 403, reason: 'plan' })
  })

  it('a route that is not there yet (no JSON) is a plain error, never a crash', async () => {
    mockAuthorizedFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => {
        throw new SyntaxError('not json')
      },
    })
    await expect(callPluginConnectionsRoute(null, 'plugin-connections/sync', { method: 'POST', body: {} })).rejects.toMatchObject({
      message: 'That did not work. Try again.',
      status: 404,
      reason: null,
    })
  })

  it('an unknown reason is dropped, and a network failure is a plain error', async () => {
    mockAuthorizedFetch.mockResolvedValueOnce(json(409, { error: 'Odd', reason: 'something-else' }))
    await expect(callPluginConnectionsRoute(null, 'x', { method: 'GET' })).rejects.toMatchObject({ reason: null })
    mockAuthorizedFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(callPluginConnectionsRoute(null, 'x', { method: 'GET' })).rejects.toMatchObject({ status: 0 })
  })
})
