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
 * `readApiKeyGrant` (AGL-3643): what a key set up earlier may still do, by
 * its public id — nothing once it is revoked or expired, and never another
 * organization's key.
 */

const KEYS: Array<Record<string, unknown>> = []
const queries: Array<Array<[string, unknown]>> = []

jest.mock('./firebase-admin', () => {
  const query = (filters: Array<[string, unknown]>) => ({
    where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]]),
    limit: () => query(filters),
    get: async () => {
      queries.push(filters)
      const docs = KEYS.filter((key) => filters.every(([field, value]) => key[field] === value)).map((key) => ({
        data: () => key,
      }))
      return { docs, empty: docs.length === 0 }
    },
  })
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => ({ collection: (name: string) => (expect(name).toBe('apiKeys'), query([])) }) }),
    },
  }
})

import { readApiKeyGrant } from './api-keys'

const NOW = Date.UTC(2026, 9, 7)
const stamp = (ms: number) => ({ toMillis: () => ms })

beforeEach(() => {
  KEYS.length = 0
  queries.length = 0
  KEYS.push(
    { keyId: 'key_live', orgId: 'org1', name: 'Zapier', scopes: ['orders:read', 'nonsense', 'contacts:read'], revokedAt: null, expiresAt: null },
    { keyId: 'key_revoked', orgId: 'org1', name: 'Old', scopes: ['orders:read'], revokedAt: stamp(NOW - 1), expiresAt: null },
    { keyId: 'key_expired', orgId: 'org1', name: 'Trial', scopes: ['orders:read'], revokedAt: null, expiresAt: stamp(NOW - 1) },
    { keyId: 'key_theirs', orgId: 'org2', name: 'Theirs', scopes: ['orders:read'], revokedAt: null, expiresAt: null },
  )
})

describe('readApiKeyGrant (AGL-3643)', () => {
  it('answers a live key’s name and its known scopes, asking by organization and id', async () => {
    expect(await readApiKeyGrant('org1', 'key_live', NOW)).toEqual({
      keyId: 'key_live',
      name: 'Zapier',
      scopes: ['contacts:read', 'orders:read'],
    })
    expect(queries[0]).toEqual([
      ['orgId', 'org1'],
      ['keyId', 'key_live'],
    ])
  })

  it('answers null for a revoked key, an expired key, another org’s key and an unknown one', async () => {
    expect(await readApiKeyGrant('org1', 'key_revoked', NOW)).toBeNull()
    expect(await readApiKeyGrant('org1', 'key_expired', NOW)).toBeNull()
    expect(await readApiKeyGrant('org1', 'key_theirs', NOW)).toBeNull()
    expect(await readApiKeyGrant('org1', 'key_nope', NOW)).toBeNull()
  })

  it('reads nothing without an organization or a key id', async () => {
    expect(await readApiKeyGrant('', 'key_live', NOW)).toBeNull()
    expect(await readApiKeyGrant('org1', '', NOW)).toBeNull()
    expect(queries).toEqual([])
  })
})
