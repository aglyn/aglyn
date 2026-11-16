/**
 * @jest-environment node
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
 * The MCP endpoint's 401 tells a client where sign-in is described
 * (AGL-4225, RFC 9728 §5.1) — and nothing else about the refusal changes.
 * A client handed only `<console>/api/mcp` learns from this header alone
 * that it can sign in, and which server to ask.
 */

const mockAuthenticate = jest.fn()
jest.mock('../utils/api-v1', () => ({
  authenticateApiV1: (...args: unknown[]) => mockAuthenticate(...args),
}))
jest.mock('../utils/api-v1-resources', () => ({
  describePluginApiV1Resources: async () => [],
  dispatchResource: jest.fn(),
}))

import { ApiErrors } from '@aglyn/tenant-data-admin'
import { POST } from '../app/api/mcp/route'

const call = (origin = 'https://app.aglyn.com') =>
  POST(
    new Request(`${origin}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    }),
  )

describe('the MCP sign-in challenge (AGL-4225)', () => {
  it('names the resource metadata on a 401, on this origin, and keeps the body', async () => {
    mockAuthenticate.mockResolvedValue(ApiErrors.unauthorized({ headers: { 'X-RateLimit-Limit': '60' } }))
    const response = await call()
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://app.aglyn.com/.well-known/oauth-protected-resource/api/mcp"',
    )
    expect(response.headers.get('x-ratelimit-limit')).toBe('60')
    expect(await response.json()).toEqual({
      error: { type: 'unauthorized', message: 'Invalid or missing API key' },
    })
  })

  it('names the origin it was asked on, never a fixed host', async () => {
    mockAuthenticate.mockResolvedValue(ApiErrors.unauthorized())
    const response = await call('http://localhost:4200')
    expect(response.headers.get('www-authenticate')).toContain(
      'http://localhost:4200/.well-known/oauth-protected-resource/api/mcp',
    )
  })

  it('sends no challenge on a refusal that is not about the credential', async () => {
    mockAuthenticate.mockResolvedValue(ApiErrors.planRequired())
    const planRefusal = await call()
    expect(planRefusal.status).toBe(403)
    expect(planRefusal.headers.get('www-authenticate')).toBeNull()
  })
})
