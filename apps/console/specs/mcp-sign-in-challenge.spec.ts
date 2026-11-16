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
import { GET, OPTIONS, POST } from '../app/api/mcp/route'

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

describe('the MCP endpoint’s own limits and answers (AGL-4225)', () => {
  const context = {
    orgId: 'org-1',
    keyId: 'grant_x',
    keyName: 'Claude',
    scopes: [],
    org: {},
    firestore: {},
    headers: { 'X-RateLimit-Limit': '120' },
  }
  const send = (body: string, headers: Record<string, string> = {}) =>
    POST(
      new Request('https://app.aglyn.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      }),
    )

  beforeEach(() => mockAuthenticate.mockResolvedValue({ context }))

  it('is not served on the auth origin, and spends no credential check there', async () => {
    mockAuthenticate.mockClear()
    const onAuth = await POST(
      new Request('https://auth.aglyn.com/api/mcp', {
        method: 'POST',
        headers: { 'x-forwarded-host': 'auth.aglyn.com' },
        body: '{}',
      }),
    )
    expect(onAuth.status).toBe(404)
    expect(onAuth.headers.get('www-authenticate')).toBeNull()
    expect(GET(new Request('https://auth.aglyn.com/api/mcp', { headers: { 'x-forwarded-host': 'auth.aglyn.com' } })).status).toBe(404)
    expect(mockAuthenticate).not.toHaveBeenCalled()
  })

  it('refuses a body over the cap and a batch over 20 messages', async () => {
    expect((await send(' '.repeat(6 * 1024 * 1024 + 1))).status).toBe(413)
    const ping = (id: number) => ({ jsonrpc: '2.0', id, method: 'ping' })
    const tooMany = await send(JSON.stringify(Array.from({ length: 21 }, (_, i) => ping(i))))
    expect(tooMany.status).toBe(400)
    expect((await send(JSON.stringify([]))).status).toBe(400)
    const twenty = await send(JSON.stringify(Array.from({ length: 20 }, (_, i) => ping(i))))
    expect(twenty.status).toBe(200)
    expect(await twenty.json()).toHaveLength(20)
  })

  it('names the revision it answered in', async () => {
    const init = await send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }))
    expect(init.headers.get('mcp-protocol-version')).toBe('2025-03-26')
    const later = await send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }), { 'mcp-protocol-version': '2025-03-26' })
    expect(later.headers.get('mcp-protocol-version')).toBe('2025-03-26')
    const unknown = await send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }), { 'mcp-protocol-version': '1999-01-01' })
    expect(unknown.headers.get('mcp-protocol-version')).toBe('2025-06-18')
  })
})

describe('a browser-based MCP client can use the endpoint (AGL-4225)', () => {
  it('answers a preflight for the headers an MCP client sends, without credentials', () => {
    const preflight = OPTIONS(new Request('https://app.aglyn.com/api/mcp', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()
    for (const header of ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Session-Id']) {
      expect(preflight.headers.get('access-control-allow-headers')).toContain(header)
    }
  })

  it('lets the browser read the 401 challenge and the negotiated revision', async () => {
    mockAuthenticate.mockResolvedValue(ApiErrors.unauthorized())
    const challenged = await call()
    expect(challenged.headers.get('access-control-allow-origin')).toBe('*')
    expect(challenged.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate')
    expect(challenged.headers.get('access-control-expose-headers')).toContain('MCP-Protocol-Version')
    expect(challenged.headers.get('www-authenticate')).toContain('resource_metadata=')
  })
})

