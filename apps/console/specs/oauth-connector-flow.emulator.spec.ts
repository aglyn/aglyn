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
 * AGL-4225 — the whole connector walk, as a client makes it, against the
 * Firestore and Auth emulators: discovery → register → consent (a real
 * Firebase ID token) → token → MCP `initialize` → `tools/list` → a read tool
 * → refresh → revoke → 401.
 *
 * Every step is the REAL route handler, the real store and the real
 * `/api/v1` pipeline; nothing is stubbed. What this does not cover is the
 * part a browser does — the middleware rewrite of the discovery paths and
 * the consent page itself — which `middleware.spec.ts` and the page's own
 * spec hold.
 *
 * Skipped unless BOTH emulators are named:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npx jest -c apps/console/jest.config.ts --testPathPatterns oauth-connector-flow.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createHash, randomBytes } from 'node:crypto'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST)
const describeEmulated = EMULATED ? describe : describe.skip
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { GET as protectedResource } from '../app/api/oauth/metadata/protected-resource/route'
import { GET as authorizationServer } from '../app/api/oauth/metadata/authorization-server/route'
import { POST as register } from '../app/api/oauth/register/route'
import { POST as consent } from '../app/api/oauth/consent/route'
import { POST as token } from '../app/api/oauth/token/route'
import { POST as revoke } from '../app/api/oauth/revoke/route'
import { POST as mcp } from '../app/api/mcp/route'

const ORIGIN = 'https://app.example.test'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const RUN = randomBytes(4).toString('hex')
const UID = `flow-user-${RUN}`
const ORG = `flow-org-${RUN}`

const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')

async function idTokenFor(uid: string): Promise<string> {
  const custom = await getAuth().createCustomToken(uid)
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  )
  return (await response.json()).idToken
}

const form = (path: string, body: Record<string, string>) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '192.0.2.10' },
    body: new URLSearchParams(body).toString(),
  })

const rpc = (credential: string | null, message: Record<string, unknown>) =>
  mcp(
    new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    }),
  )

describeEmulated('connecting an app, end to end (emulators)', () => {
  let idToken: string

  beforeAll(async () => {
    await registerPluginServerDeclarations()
    const db = getFirestore()
    await getAuth().createUser({ uid: UID, email: `${UID}@example.com`, emailVerified: true })
    idToken = await idTokenFor(UID)
    await db.collection('orgs').doc(ORG).set({ name: 'Flow Co', slug: `flow-${RUN}`, plan: 'pro' })
    await db.collection('orgs').doc(ORG).collection('members').doc(UID).set({ role: 'owner', email: `${UID}@example.com` })
    await db.collection('users').doc(UID).collection('orgs').doc(ORG).set({ role: 'owner' })
  }, 120_000)

  it('walks register → consent → token → MCP → refresh → revoke → 401', async () => {
    // 0. An unauthenticated MCP call names where sign-in is described.
    const challenged = await rpc(null, { id: 0, method: 'initialize' })
    expect(challenged.status).toBe(401)
    expect(challenged.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    )

    // 1. Discovery.
    const resource = await (await protectedResource(new Request(`${ORIGIN}/x`))).json()
    expect(resource.resource).toBe(`${ORIGIN}/api/mcp`)
    const server = await (await authorizationServer(new Request(`${ORIGIN}/x`))).json()
    expect(server.issuer).toBe(ORIGIN)

    // 2. Registration.
    const registered = await register(
      new Request(`${ORIGIN}/api/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.10' },
        body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CLAUDE] }),
      }),
    )
    expect(registered.status).toBe(201)
    const { client_id: clientId } = await registered.json()

    // 3. Consent, as the page calls it, with a real ID token.
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: CLAUDE,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz-state',
      resource: `${ORIGIN}/api/mcp`,
    }).toString()
    const ask = (body: Record<string, unknown>) =>
      consent(
        new Request(`${ORIGIN}/api/oauth/consent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ ...body, query }),
        }),
      )
    const described = await (await ask({ action: 'describe' })).json()
    expect(described.app).toEqual({ name: 'Claude', returnsTo: 'claude.ai', kind: 'web', host: 'claude.ai', path: '/api/mcp/auth_callback' })
    expect(described.workspaces).toEqual([
      expect.objectContaining({ orgId: ORG, name: 'Flow Co', entitled: true }),
    ])
    const allowed = await ask({ action: 'allow', orgId: ORG, access: 'view' })
    expect(allowed.status).toBe(200)
    const back = new URL((await allowed.json()).redirectTo)
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE)
    expect(back.searchParams.get('state')).toBe('xyz-state')
    expect(back.searchParams.get('iss')).toBe(ORIGIN)
    const code = back.searchParams.get('code') as string

    // 4. Token exchange.
    const exchanged = await token(
      form('/api/oauth/token', {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: CLAUDE,
        code_verifier: verifier,
        resource: `${ORIGIN}/api/mcp`,
      }),
    )
    expect(exchanged.status).toBe(200)
    const first = await exchanged.json()
    expect(first).toMatchObject({ token_type: 'Bearer', expires_in: 3600 })
    expect(first.scope.split(' ').every((scope: string) => scope.endsWith(':read'))).toBe(true)

    // 5. MCP with the access token.
    const init = await rpc(first.access_token, { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(init.status).toBe(200)
    expect((await init.json()).result.protocolVersion).toBe('2025-06-18')

    const listed = await (await rpc(first.access_token, { id: 2, method: 'tools/list' })).json()
    const listSites = listed.result.tools.find((tool: { name: string }) => tool.name === 'listSites')
    expect(listSites).toMatchObject({ title: 'List sites', annotations: { readOnlyHint: true, destructiveHint: false } })

    const called = await (await rpc(first.access_token, { id: 3, method: 'tools/call', params: { name: 'listSites', arguments: {} } })).json()
    expect(called.result.isError).toBe(false)
    expect(JSON.parse(called.result.content[0].text)).toMatchObject({ object: 'list' })

    // The service tools answer from the same code the REST route uses
    // (AGL-4225). Until they did, each answered "Unknown endpoint".
    const service = async (id: number, name: string) => {
      const answer = await (await rpc(first.access_token, { id, method: 'tools/call', params: { name, arguments: {} } })).json()
      expect(answer.result.content[0].text).not.toMatch(/Unknown endpoint/)
      expect(answer.result.isError).toBe(false)
      return JSON.parse(answer.result.content[0].text)
    }
    expect(await service(30, 'getKeyIdentity')).toMatchObject({ object: 'connected_app', org: ORG })
    expect(await service(31, 'getApiRoot')).toMatchObject({ object: 'api', version: 'v1', mcp: '/api/mcp' })
    expect(await service(32, 'getUsage')).toBeTruthy()
    // The whole OpenAPI document is deliberately not a tool; it is refused as
    // an unknown tool, never as an unknown endpoint.
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).not.toContain('getApiDescription')
    const describedTool = await (await rpc(first.access_token, { id: 33, method: 'tools/call', params: { name: 'getApiDescription', arguments: {} } })).json()
    expect(describedTool.error.message).toBe('No tool named getApiDescription')

    // "View only": a write tool is refused by the scope check, as a tool error.
    const write = await (await rpc(first.access_token, { id: 4, method: 'tools/call', params: { name: 'createSite', arguments: { body: { name: 'Nope' } } } })).json()
    expect(write.result.isError).toBe(true)
    expect(write.result.content[0].text).toContain('insufficient_scope')

    // 6. Refresh rotates.
    const refreshed = await token(form('/api/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token }))
    expect(refreshed.status).toBe(200)
    const second = await refreshed.json()
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect((await rpc(second.access_token, { id: 5, method: 'ping' })).status).toBe(200)

    // 7. Revoke the refresh token: the connection ends, every token with it.
    expect((await revoke(form('/api/oauth/revoke', { token: second.refresh_token, client_id: clientId }))).status).toBe(200)
    const after = await rpc(second.access_token, { id: 6, method: 'ping' })
    expect(after.status).toBe(401)
    expect(after.headers.get('www-authenticate')).toContain('resource_metadata=')
  }, 120_000)
})
