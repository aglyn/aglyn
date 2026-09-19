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

import { createSecretBoxKey, parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import { GOOGLE_OAUTH_ENDPOINTS } from '../transport/google-oauth'
import { sealMailboxRefreshToken } from './mailbox-credentials'
import { createOutreachOrgEraser, type OutreachErasureDeps } from './mailbox-erasure'

/**
 * Outreach's share of a workspace erasure (AGL-2978): each grant the
 * organization holds is revoked at Google before the erasure deletes it,
 * unless another organization still uses the same Google account, and a plan
 * touches nothing. Google is a scripted `fetch`; no request leaves the test.
 */

const KEYRING = parseSecretBoxKeyring(Buffer.from(createSecretBoxKey(Buffer.alloc(32, 5)).material).toString('base64'))

interface Row {
  id: string
  data: Record<string, unknown>
}

let rows: Row[]
let revoked: string[]
let revokeStatus: number
let revokeBody: unknown

/** The credential collection, queried by field as the eraser and the revoke do. */
function fakeFirestore(): FirebaseFirestore.Firestore {
  const query = (filters: Array<[string, unknown]>, limit = Infinity): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported operator ${op}`)
      return query([...filters, [field, value]], limit)
    },
    limit: (count: number) => query(filters, count),
    get: async () => {
      const docs = rows
        .filter((row) => filters.every(([field, value]) => row.data[field] === value))
        .slice(0, limit)
        .map((row) => ({ id: row.id, data: () => row.data, get: (field: string) => row.data[field] }))
      return { docs, size: docs.length, empty: !docs.length }
    },
  })
  return {
    collection: (name: string) => {
      if (name !== OUTREACH_COLLECTIONS.mailboxCredentials) throw new Error(`unexpected collection ${name}`)
      return query([])
    },
  } as unknown as FirebaseFirestore.Firestore
}

const fetchGoogle = jest.fn(async (url: string, init?: RequestInit) => {
  if (url !== GOOGLE_OAUTH_ENDPOINTS.revoke) throw new Error(`unscripted ${url}`)
  revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '')
  return new Response(JSON.stringify(revokeBody), { status: revokeStatus })
})

function deps(overrides: Partial<OutreachErasureDeps> = {}): OutreachErasureDeps {
  return {
    firestore: fakeFirestore,
    readConfig: () => ({ configured: true, config: { clientId: 'cid', clientSecret: 'secret', keyring: KEYRING } }),
    transport: { fetch: fetchGoogle as unknown as typeof fetch, sleep: async () => undefined, maxAttempts: 1 },
    ...overrides,
  }
}

const stored = (mailboxId: string, orgId: string, account: string, token: string): Row => ({
  id: mailboxId,
  data: {
    id: mailboxId,
    orgId,
    mailboxId,
    provider: 'google',
    providerAccountId: account,
    connectedByUid: 'uid-rep',
    email: 'avery@rep.example.com',
    scopes: [],
    ...sealMailboxRefreshToken(token, mailboxId, KEYRING),
    createdAtMs: 1,
    updatedAtMs: 1,
  },
})

beforeEach(() => {
  rows = []
  revoked = []
  revokeStatus = 200
  revokeBody = {}
  fetchGoogle.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the workspace eraser (AGL-2978)', () => {
  it('revokes each of the erased org’s grants with its opened refresh token, and no other org’s', async () => {
    rows = [
      stored('gm_a', 'org-erased', 'account-1', 'refresh-a'),
      stored('gm_b', 'org-erased', 'account-2', 'refresh-b'),
      stored('gm_c', 'org-still-here', 'account-3', 'refresh-c'),
    ]
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toEqual({
      grants: 2,
      revoked: 2,
      alreadyInvalid: 0,
      kept: 0,
      failed: 0,
    })
    expect(revoked).toEqual(['refresh-a', 'refresh-b'])
  })

  it('keeps a grant another organization still uses, and does not count the erased org’s own twin', async () => {
    rows = [
      stored('gm_a', 'org-erased', 'shared-account', 'refresh-a'),
      stored('gm_b', 'org-erased', 'shared-account', 'refresh-b'),
    ]
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toMatchObject({
      revoked: 2,
      kept: 0,
    })
    rows.push(stored('gm_c', 'org-still-here', 'shared-account', 'refresh-c'))
    revoked = []
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toEqual({
      grants: 2,
      revoked: 0,
      alreadyInvalid: 0,
      kept: 2,
      failed: 0,
    })
    expect(revoked).toEqual([])
  })

  it('counts a grant Google already dropped, a Google outage and a document that is not a credential', async () => {
    rows = [stored('gm_a', 'org-erased', 'account-1', 'refresh-a')]
    revokeStatus = 400
    revokeBody = { error: 'invalid_token' }
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toMatchObject({
      alreadyInvalid: 1,
    })
    revokeStatus = 503
    revokeBody = { error: 'backend' }
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toMatchObject({
      failed: 1,
    })
    rows = [{ id: 'gm_x', data: { orgId: 'org-erased' } }]
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toEqual({
      grants: 1,
      revoked: 0,
      alreadyInvalid: 0,
      kept: 0,
      failed: 1,
    })
  })

  it('counts a grant it cannot open, or a deployment with no Outreach config, as failed without asking Google', async () => {
    rows = [stored('gm_a', 'org-erased', 'account-1', 'refresh-a')]
    const otherKeyring = parseSecretBoxKeyring(
      Buffer.from(createSecretBoxKey(Buffer.alloc(32, 9)).material).toString('base64'),
    )
    await expect(
      createOutreachOrgEraser(
        deps({ readConfig: () => ({ configured: true, config: { clientId: 'cid', clientSecret: 's', keyring: otherKeyring } }) }),
      )({ orgId: 'org-erased', dryRun: false }),
    ).resolves.toMatchObject({ failed: 1 })
    await expect(
      createOutreachOrgEraser(deps({ readConfig: () => ({ configured: false, missing: ['OUTREACH_TOKEN_KEY'] }) }))({
        orgId: 'org-erased',
        dryRun: false,
      }),
    ).resolves.toMatchObject({ failed: 1 })
    expect(fetchGoogle).not.toHaveBeenCalled()
  })

  it('on a plan, counts the grants and touches no provider: its revocation figures are not measured', async () => {
    rows = [stored('gm_a', 'org-erased', 'account-1', 'refresh-a')]
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: true })).resolves.toEqual({
      grants: 1,
      revoked: null,
      alreadyInvalid: null,
      kept: null,
      failed: null,
    })
    expect(fetchGoogle).not.toHaveBeenCalled()
  })
})
