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
 *
 * @jest-environment node
 */

/**
 * The connector store's lifecycle, serially (AGL-4225): a code is spent once
 * and a second use revokes what it produced, a refresh token rotates and a
 * reused one revokes the connection, every token dies with its connection,
 * and nothing secret is ever written down.
 *
 * Against an in-memory double that commits a transaction's writes only when
 * its body resolves. What a double cannot prove — that two CONCURRENT
 * exchanges cannot both commit — is `connector-oauth-store.emulator.spec.ts`.
 */

type Data = Record<string, unknown>
const mockDocs = new Map<string, Data>()

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))

jest.mock('./organizations', () => ({
  resolveOrgMembership: jest.fn(),
  memberHasOrgPermission: jest.fn(),
}))
jest.mock('./lockdown', () => ({ getLockdownVerdict: jest.fn() }))

/** The durable limiter, as a plain counter per key: the rule under test is the caller's. */
const mockRateCounts = new Map<string, number>()
jest.mock('./rate-limit-store', () => ({
  consumeRateLimit: async (key: string, options: { limit: number }) => {
    const count = (mockRateCounts.get(key) ?? 0) + 1
    mockRateCounts.set(key, count)
    return { allowed: count <= options.limit, limit: options.limit, remaining: 0, resetMs: 0 }
  },
}))

jest.mock('./firebase-admin', () => {
  const ref = (collection: string, id: string) => {
    const key = `${collection}/${id}`
    const snapshot = () => {
      const data = mockDocs.get(key)
      return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined), ref: self }
    }
    const self = {
      id,
      key,
      get: async () => snapshot(),
      create: async (data: Data) => {
        if (mockDocs.has(key)) throw new Error(`already exists: ${key}`)
        mockDocs.set(key, { ...data })
      },
      set: async (data: Data) => void mockDocs.set(key, { ...data }),
      update: async (patch: Data) => {
        if (!mockDocs.has(key)) throw new Error(`no document: ${key}`)
        mockDocs.set(key, { ...mockDocs.get(key), ...patch })
      },
      delete: async () => void mockDocs.delete(key),
    }
    return self
  }
  const query = (collection: string, filters: Array<[string, unknown]>) => ({
    where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]]),
    get: async () => {
      const docs = [...mockDocs.entries()]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([key, data]) => ({ id: key.slice(collection.length + 1), data: () => ({ ...data }) }))
      return { docs, empty: docs.length === 0 }
    },
  })
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ref(name, id),
      ...query(name, []),
    }),
    runTransaction: async <T>(body: (tx: unknown) => Promise<T>): Promise<T> => {
      const writes: Array<() => Promise<void>> = []
      type R = ReturnType<typeof ref>
      const tx = {
        get: (target: R) => target.get(),
        create: (target: R, data: Data) => void writes.push(() => target.create(data)),
        update: (target: R, data: Data) => void writes.push(() => target.update(data)),
        set: (target: R, data: Data) => void writes.push(() => target.set(data)),
        delete: (target: R) => void writes.push(() => target.delete()),
      }
      const result = await body(tx)
      for (const write of writes) await write()
      return result
    },
  }
  return { firebaseAdmin: { app: () => ({ firestore: () => firestore }) } }
})

import {
  CONNECTOR_TOKEN_UNAVAILABLE,
  type ConnectorLiveness,
  disconnectConnectorGrant,
  exchangeConnectorCode,
  listConnectorGrants,
  mintConnectorCode,
  readConnectorClient,
  readConnectorGrantAsKey,
  refreshConnectorTokens,
  registerConnectorClient,
  reserveClientPromotion,
  revokeConnectorToken,
  verifyConnectorAccessToken,
} from './connector-oauth-store'
import {
  CONNECTOR_CLIENT_IDLE_TTL_MS,
  CONNECTOR_CLIENT_UNUSED_TTL_MS,
  CONNECTOR_CODE_TTL_MS,
  CONNECTOR_REFRESH_REUSE_GRACE_MS,
  CONNECTOR_REFRESH_TOKEN_TTL_MS,
  pkceS256Challenge,
} from './connector-oauth'

const NOW = Date.UTC(2026, 10, 16, 12)
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const VERIFIER = 'a'.repeat(20) + 'B'.repeat(23) + '-._~'
const CHALLENGE = pkceS256Challenge(VERIFIER)

let verdict: ConnectorLiveness = 'live'
const liveness = jest.fn(async () => verdict)
const opts = (now = NOW) => ({ now, liveness })

async function connect(scopes = ['contacts:read', 'contacts:write'], orgId = 'org-1', uid = 'user-1') {
  const client = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW)
  const code = await mintConnectorCode(
    {
      clientId: client.clientId,
      redirectUri: CLAUDE,
      codeChallenge: CHALLENGE,
      orgId,
      uid,
      email: 'owner@example.com',
      scopes: scopes as never,
      resource: 'https://app.example.com/api/mcp',
    },
    NOW,
  )
  return { client, code }
}

const exchange = (client: { clientId: string }, code: string, overrides: Record<string, unknown> = {}, now = NOW) =>
  exchangeConnectorCode(
    { code, clientId: client.clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER, ...overrides },
    opts(now),
  )

async function connected(scopes?: string[], orgId?: string, uid?: string) {
  const { client, code } = await connect(scopes, orgId, uid)
  const result = await exchange(client, code)
  if (!result.ok) throw new Error(result.description)
  return { client, code, result }
}

const grantDocs = () =>
  [...mockDocs.entries()].filter(([key]) => key.startsWith('oauthGrants/')).map(([, data]) => data)

beforeEach(() => {
  mockDocs.clear()
  mockRateCounts.clear()
  verdict = 'live'
  liveness.mockClear()
})

describe('promotions per account (AGL-4225)', () => {
  it('lets one account bring at most 20 never-approved clients to life a day, and never limits an approved one', async () => {
    const ids: string[] = []
    for (let i = 0; i < 21; i += 1) {
      const client = await registerConnectorClient({ clientName: `Junk ${i}`, redirectUris: [CLAUDE] }, NOW)
      ids.push(client?.clientId as string)
    }
    const answers = []
    for (const id of ids) answers.push(await reserveClientPromotion('user-1', id, NOW))
    expect(answers.filter(Boolean)).toHaveLength(20)
    expect(answers[20]).toBe(false)
    // Another account has its own allowance.
    expect(await reserveClientPromotion('user-2', ids[20], NOW)).toBe(true)
    // A client someone already approved is never counted.
    await mintConnectorCode(
      { clientId: ids[0], redirectUri: CLAUDE, codeChallenge: CHALLENGE, orgId: 'org-1', uid: 'user-3', email: null, scopes: ['contacts:read'], resource: null },
      NOW,
    )
    expect(await reserveClientPromotion('user-1', ids[0], NOW)).toBe(true)
  })
})

describe('registration', () => {
  const clientDocs = () => [...mockDocs.keys()].filter((key) => key.startsWith('oauthClients/'))

  it('is idempotent: the same registration is the same client and one document, touched at most daily', async () => {
    const first = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW)
    expect(first.created).toBe(true)
    const stored = mockDocs.get(`oauthClients/${first.clientId}`)
    const again = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW + 60_000)
    expect(again).toEqual({ ...first, created: false })
    expect(clientDocs()).toHaveLength(1)
    // Within the day: nothing written at all.
    expect(mockDocs.get(`oauthClients/${first.clientId}`)).toEqual(stored)
    // Approved once, a repeat a day on moves the idle clock and nothing else.
    await mintConnectorCode(
      { clientId: first.clientId, redirectUri: CLAUDE, codeChallenge: CHALLENGE, orgId: 'org-1', uid: 'user-1', email: null, scopes: ['contacts:read'], resource: null },
      NOW + 120_000,
    )
    const DAY = 24 * 60 * 60 * 1000
    const later = NOW + 120_000 + DAY
    const repeat = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, later)
    expect(repeat).toMatchObject({ clientId: first.clientId, created: false, issuedAtMs: NOW })
    const touched = mockDocs.get(`oauthClients/${first.clientId}`) as Record<string, { toMillis: () => number }>
    expect(touched.expiresAt.toMillis()).toBe(later + CONNECTOR_CLIENT_IDLE_TTL_MS)
    expect(touched.createdAt.toMillis()).toBe(NOW)
    expect(clientDocs()).toHaveLength(1)
  })

  it('keeps an unapproved registration a day, and a first approval gives it the full idle life', async () => {
    const client = await registerConnectorClient({ clientName: 'Some app', redirectUris: [CLAUDE] }, NOW)
    expect(await readConnectorClient(client.clientId, NOW + CONNECTOR_CLIENT_UNUSED_TTL_MS)).toBeNull()

    const used = await registerConnectorClient({ clientName: 'Used app', redirectUris: [CLAUDE] }, NOW)
    await mintConnectorCode(
      { clientId: used.clientId, redirectUri: CLAUDE, codeChallenge: CHALLENGE, orgId: 'org-1', uid: 'user-1', email: null, scopes: ['contacts:read'], resource: null },
      NOW + 60_000,
    )
    expect(await readConnectorClient(used.clientId, NOW + CONNECTOR_CLIENT_UNUSED_TTL_MS + 60_000)).not.toBeNull()
    expect(await readConnectorClient(used.clientId, NOW + CONNECTOR_CLIENT_IDLE_TTL_MS)).not.toBeNull()
  })

  it('never extends an unapproved registration by repeating it, so the storage bound holds', async () => {
    const DAY = 24 * 60 * 60 * 1000
    expect(CONNECTOR_CLIENT_UNUSED_TTL_MS).toBe(7 * DAY)
    const client = await registerConnectorClient({ clientName: 'Junk', redirectUris: [CLAUDE] }, NOW)
    for (let day = 1; day < 7; day += 1) {
      await registerConnectorClient({ clientName: 'Junk', redirectUris: [CLAUDE] }, NOW + day * DAY)
    }
    expect(await readConnectorClient(client?.clientId, NOW + 7 * DAY)).toBeNull()
  })

  it('answers a repeat but creates nothing when creation is not allowed', async () => {
    const first = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW)
    expect(await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW, { mayCreate: false })).toMatchObject({
      clientId: first?.clientId,
      created: false,
    })
    expect(await registerConnectorClient({ clientName: 'New', redirectUris: [CLAUDE] }, NOW, { mayCreate: false })).toBeNull()
    expect(clientDocs()).toHaveLength(1)
  })

  it('gives a different name or different addresses a different client', async () => {
    const a = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW)
    const b = await registerConnectorClient({ clientName: 'Claude Code', redirectUris: [CLAUDE] }, NOW)
    const c = await registerConnectorClient({ clientName: 'Claude', redirectUris: ['http://localhost:9/cb'] }, NOW)
    expect(new Set([a.clientId, b.clientId, c.clientId]).size).toBe(3)
    expect(clientDocs()).toHaveLength(3)
  })

  it('registers a lapsed client afresh, in place', async () => {
    const first = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW)
    const later = NOW + CONNECTOR_CLIENT_IDLE_TTL_MS + 1
    const again = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, later)
    expect(again).toMatchObject({ clientId: first.clientId, created: true, issuedAtMs: later })
    expect(await readConnectorClient(first.clientId, later)).not.toBeNull()
  })

  it('reads back a live client and forgets a lapsed one', async () => {
    const client = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW)
    expect(await readConnectorClient(client.clientId, NOW)).toEqual({
      clientId: client.clientId,
      clientName: 'Claude',
      redirectUris: [CLAUDE],
    })
    expect(await readConnectorClient(client.clientId, NOW + CONNECTOR_CLIENT_IDLE_TTL_MS)).toBeNull()
    expect(await readConnectorClient('aglyn_client_nope', NOW)).toBeNull()
  })
})

describe('the code exchange', () => {
  it('creates one connection and resolves its access token to the workspace, the app and the person', async () => {
    const { result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    expect(result.tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'contacts:read contacts:write',
    })
    expect(result.connected).toMatchObject({ orgId: 'org-1', uid: 'user-1', clientName: 'Claude' })
    const verified = await verifyConnectorAccessToken(result.tokens.access_token, opts())
    expect(verified).toEqual({
      orgId: 'org-1',
      keyId: result.connected?.grantId,
      scopes: ['contacts:read', 'contacts:write'],
      name: 'Claude',
      uid: 'user-1',
    })
    // The full check at exchange: lock and plan as well as membership.
    expect(liveness).toHaveBeenCalledWith('org-1', 'user-1', { lockdown: true, entitlement: true })
  })

  it('refuses a wrong verifier, client or address WITHOUT spending the code', async () => {
    const { client, code } = await connect()
    expect(await exchange(client, code, { codeVerifier: 'b'.repeat(43) })).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(await exchange(client, code, { clientId: 'aglyn_client_someoneelse0000' })).toMatchObject({ ok: false })
    expect(await exchange(client, code, { redirectUri: 'http://localhost:9/cb' })).toMatchObject({ ok: false })
    expect(await exchange(client, code, { resource: 'https://app.example.com/api/other' })).toMatchObject({ ok: false })
    expect(grantDocs()).toHaveLength(0)
    expect((await exchange(client, code)).ok).toBe(true)
  })

  it('a spent code alone — no client, address or verifier — revokes nothing', async () => {
    const { client, code, result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    for (const overrides of [
      { clientId: 'aglyn_client_someoneelse0000' },
      { codeVerifier: 'b'.repeat(43) },
      { codeVerifier: undefined },
      { redirectUri: 'http://localhost:9/cb' },
    ]) {
      expect(await exchange(client, code, overrides)).toMatchObject({ ok: false, error: 'invalid_grant' })
    }
    expect(grantDocs()[0].revokedAt).toBeNull()
    expect(await verifyConnectorAccessToken(result.tokens.access_token, opts())).not.toBeNull()
  })

  it('spends a code once, and a second use revokes the connection the first produced', async () => {
    const { client, code, result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    const replay = await exchange(client, code)
    expect(replay).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(grantDocs()[0]).toMatchObject({ revokedReason: 'code_replayed' })
    expect(await verifyConnectorAccessToken(result.tokens.access_token, opts())).toBeNull()
    expect(await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts())).toMatchObject({ ok: false })
  })

  it('marks a well-formed secret that resolves to nothing as unknown, and nothing else', async () => {
    const { client, code } = await connect()
    const missing = await exchange(client, `aglyn_ac_${'z'.repeat(43)}`)
    expect(missing).toMatchObject({ ok: false, error: 'invalid_grant', unknown: true })
    expect((await exchange(client, code, { codeVerifier: 'b'.repeat(43) })).unknown).toBeUndefined()
    expect((await exchange(client, 'aglyn_ac_short')).unknown).toBeUndefined()
    expect(
      await refreshConnectorTokens({ refreshToken: `aglyn_rt_${'z'.repeat(43)}`, clientId: client.clientId }, opts()),
    ).toMatchObject({ unknown: true })
  })

  it('refuses an expired code', async () => {
    const { client, code } = await connect()
    expect(await exchange(client, code, {}, NOW + CONNECTOR_CODE_TTL_MS)).toMatchObject({ ok: false, error: 'invalid_grant' })
  })

  it('creates nothing when the person no longer may connect the workspace', async () => {
    const { client, code } = await connect()
    verdict = 'no_permission'
    expect(await exchange(client, code)).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(grantDocs()).toHaveLength(0)
  })

  it('replaces an earlier connection of the same app, workspace and person — and nothing else', async () => {
    const client = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] }, NOW)
    const approve = async (orgId: string) => {
      const code = await mintConnectorCode(
        { clientId: client.clientId, redirectUri: CLAUDE, codeChallenge: CHALLENGE, orgId, uid: 'user-1', email: null, scopes: ['contacts:read'], resource: null },
        NOW,
      )
      const result = await exchange(client, code)
      if (!result.ok) throw new Error(result.description)
      return result
    }
    const first = await approve('org-1')
    const other = await approve('org-2')
    const second = await approve('org-1')
    expect(await verifyConnectorAccessToken(first.tokens.access_token, opts())).toBeNull()
    expect(await verifyConnectorAccessToken(other.tokens.access_token, opts())).not.toBeNull()
    expect(await verifyConnectorAccessToken(second.tokens.access_token, opts())).not.toBeNull()
    expect(await listConnectorGrants('org-1', NOW)).toHaveLength(1)
  })
})

describe('refresh', () => {
  it('rotates: the new pair works and the old refresh token is spent', async () => {
    const { client, result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    const next = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts(NOW + 1000))
    if (!next.ok) throw new Error(next.description)
    expect(next.tokens.refresh_token).not.toBe(result.tokens.refresh_token)
    expect(await verifyConnectorAccessToken(next.tokens.access_token, opts(NOW + 1000))).not.toBeNull()
    expect(liveness).toHaveBeenLastCalledWith('org-1', 'user-1')
  })

  it('a reused refresh token revokes the whole connection, including the token that replaced it', async () => {
    const { client, result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    const next = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts())
    if (!next.ok) throw new Error(next.description)
    const later = NOW + CONNECTOR_REFRESH_REUSE_GRACE_MS
    const reuse = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts(later))
    expect(reuse).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(grantDocs()[0]).toMatchObject({ revokedReason: 'refresh_replayed' })
    expect(await refreshConnectorTokens({ refreshToken: next.tokens.refresh_token, clientId: client.clientId }, opts())).toMatchObject({ ok: false })
    expect(await verifyConnectorAccessToken(next.tokens.access_token, opts())).toBeNull()
  })

  it('a retry inside the grace window is refused but ends nothing, and the new pair keeps working', async () => {
    const { client, result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    const next = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts())
    if (!next.ok) throw new Error(next.description)
    const retry = await refreshConnectorTokens(
      { refreshToken: result.tokens.refresh_token, clientId: client.clientId },
      opts(NOW + CONNECTOR_REFRESH_REUSE_GRACE_MS - 1),
    )
    expect(retry).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(retry.tokens).toBeUndefined()
    expect(grantDocs()[0].revokedAt).toBeNull()
    expect(await verifyConnectorAccessToken(next.tokens.access_token, opts())).not.toBeNull()
    expect((await refreshConnectorTokens({ refreshToken: next.tokens.refresh_token, clientId: client.clientId }, opts())).ok).toBe(true)
  })

  it('keeps the client alive past every refresh token it holds, however close to lapsing it was', async () => {
    const { client, result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    // Refresh at the last minute the refresh token is good for.
    const late = NOW + CONNECTOR_REFRESH_TOKEN_TTL_MS - 60_000
    const next = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts(late))
    if (!next.ok) throw new Error(next.description)
    // The token just issued lives CONNECTOR_REFRESH_TOKEN_TTL_MS; the client outlives it.
    expect(await readConnectorClient(client.clientId, late + CONNECTOR_REFRESH_TOKEN_TTL_MS)).not.toBeNull()
  })

  it('refuses another client’s refresh token without revoking anything', async () => {
    const { result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    expect(
      await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: 'aglyn_client_someoneelse0000' }, opts()),
    ).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(grantDocs()[0].revokedAt).toBeNull()
  })

  it('may narrow the access, never widen it', async () => {
    const { client, result } = await connected(['contacts:read'])
    if (!result.ok) throw new Error('unreachable')
    expect(
      await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId, scope: 'contacts:read contacts:write' }, opts()),
    ).toMatchObject({ ok: false, error: 'invalid_scope' })
    const narrowed = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId, scope: 'contacts:read' }, opts())
    expect(narrowed).toMatchObject({ ok: true, tokens: { scope: 'contacts:read' } })
  })

  it('a lock refuses the refresh but ends nothing; losing access ends the connection', async () => {
    const { client, result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    verdict = 'locked'
    expect(
      await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts()),
    ).toMatchObject({ ok: false, error: 'temporarily_unavailable', retryAfterSec: 300 })
    expect(grantDocs()[0].revokedAt).toBeNull()
    // Lifted: the same refresh token still works.
    verdict = 'live'
    const after = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts())
    if (!after.ok) throw new Error(after.description)
    verdict = 'no_permission'
    expect(
      await refreshConnectorTokens({ refreshToken: after.tokens.refresh_token, clientId: client.clientId }, opts()),
    ).toMatchObject({ ok: false })
    expect(grantDocs()[0]).toMatchObject({ revokedReason: 'no_permission' })
  })

  it('a lock seen on a call ends nothing either', async () => {
    const { result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    verdict = 'locked'
    expect(await verifyConnectorAccessToken(result.tokens.access_token, opts())).toBeNull()
    expect(grantDocs()[0].revokedAt).toBeNull()
  })

})

describe('verification', () => {
  it('a removed member’s app stops on its next call, and the connection is ended', async () => {
    const { result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    verdict = 'not_member'
    expect(await verifyConnectorAccessToken(result.tokens.access_token, opts())).toBeNull()
    expect(grantDocs()[0]).toMatchObject({ revokedReason: 'not_member' })
  })

  it('an access token lasts an hour', async () => {
    const { result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    expect(await verifyConnectorAccessToken(result.tokens.access_token, opts(NOW + 3_599_000))).not.toBeNull()
    expect(await verifyConnectorAccessToken(result.tokens.access_token, opts(NOW + 3_600_000))).toBeNull()
  })

  it('answers UNAVAILABLE without revoking when a read fails', async () => {
    const { result } = await connected()
    if (!result.ok) throw new Error('unreachable')
    const failing = jest.fn(async () => {
      throw new Error('firestore unavailable')
    })
    expect(await verifyConnectorAccessToken(result.tokens.access_token, { now: NOW, liveness: failing })).toBe(
      CONNECTOR_TOKEN_UNAVAILABLE,
    )
    expect(grantDocs()[0].revokedAt).toBeNull()
  })
})

describe('revocation endpoint', () => {
  it('a refresh token ends the connection; an access token ends only itself; another client changes nothing', async () => {
    const a = await connected()
    if (!a.result.ok) throw new Error('unreachable')
    await revokeConnectorToken({ token: a.result.tokens.refresh_token, clientId: 'aglyn_client_someoneelse0000' }, NOW)
    expect(await verifyConnectorAccessToken(a.result.tokens.access_token, opts())).not.toBeNull()

    await revokeConnectorToken({ token: a.result.tokens.access_token, clientId: a.client.clientId }, NOW)
    expect(await verifyConnectorAccessToken(a.result.tokens.access_token, opts())).toBeNull()
    const again = await refreshConnectorTokens({ refreshToken: a.result.tokens.refresh_token, clientId: a.client.clientId }, opts())
    if (!again.ok) throw new Error(again.description)

    await revokeConnectorToken({ token: again.tokens.refresh_token, clientId: a.client.clientId }, NOW)
    expect(await verifyConnectorAccessToken(again.tokens.access_token, opts())).toBeNull()
    expect(grantDocs()[0]).toMatchObject({ revokedReason: 'client_revoked' })
  })

  it('ignores junk and unknown tokens', async () => {
    await expect(revokeConnectorToken({ token: 'nope', clientId: 'x' }, NOW)).resolves.toBeUndefined()
  })
})

describe('Connected apps', () => {
  it('lists live connections without secrets, and disconnects only this workspace’s', async () => {
    const { result } = await connected(['contacts:read'])
    if (!result.ok) throw new Error('unreachable')
    const listed = await listConnectorGrants('org-1', NOW)
    expect(listed).toEqual([
      {
        grantId: result.connected?.grantId,
        appName: 'Claude',
        returnsTo: 'claude.ai',
        connectedBy: 'owner@example.com',
        connectedAt: new Date(NOW).toISOString(),
        lastUsedAt: new Date(NOW).toISOString(),
        access: 'view',
      },
    ])
    expect(JSON.stringify(listed)).not.toMatch(/aglyn_(at|rt|ac)_/)

    expect(await disconnectConnectorGrant('org-2', result.connected?.grantId, NOW)).toEqual({ disconnected: false, appName: null })
    expect(await disconnectConnectorGrant('org-1', result.connected?.grantId, NOW)).toEqual({ disconnected: true, appName: 'Claude' })
    expect(await listConnectorGrants('org-1', NOW)).toEqual([])
    expect(await verifyConnectorAccessToken(result.tokens.access_token, opts())).toBeNull()
    expect(await disconnectConnectorGrant('org-1', result.connected?.grantId, NOW)).toEqual({ disconnected: false, appName: null })
  })

  it('reads a connection the way a REST hook reads its key, until it ends', async () => {
    const { result } = await connected(['contacts:read'])
    if (!result.ok) throw new Error('unreachable')
    const grantId = result.connected?.grantId as string
    expect(await readConnectorGrantAsKey('org-1', grantId, opts())).toEqual({ keyId: grantId, name: 'Claude', scopes: ['contacts:read'] })
    expect(await readConnectorGrantAsKey('org-2', grantId, opts())).toBeNull()
    await disconnectConnectorGrant('org-1', grantId, NOW)
    expect(await readConnectorGrantAsKey('org-1', grantId, opts())).toBeNull()
  })
})

it('never writes a code, a token or a verifier down — only their hashes', async () => {
  const { client, code, result } = await connected()
  if (!result.ok) throw new Error('unreachable')
  const next = await refreshConnectorTokens({ refreshToken: result.tokens.refresh_token, clientId: client.clientId }, opts())
  if (!next.ok) throw new Error(next.description)
  const stored = JSON.stringify([...mockDocs.entries()])
  for (const secret of [code, VERIFIER, result.tokens.access_token, result.tokens.refresh_token, next.tokens.access_token, next.tokens.refresh_token]) {
    expect(stored).not.toContain(secret)
  }
})
