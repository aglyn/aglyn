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
import {
  createOutreachOrgEraser,
  createOutreachUserEraser,
  type OutreachErasureDeps,
} from './mailbox-erasure'
import { outreachOAuthStateDocId } from './oauth-state'

/**
 * Outreach's share of a workspace erasure (AGL-2978): each grant the
 * organization holds is revoked at Google before the erasure deletes it,
 * unless another organization still uses the same Google account, and a plan
 * touches nothing. Google is a scripted `fetch`; no request leaves the test.
 */

const KEYRING = parseSecretBoxKeyring(Buffer.from(createSecretBoxKey(Buffer.alloc(32, 5)).material).toString('base64'))

/** Documents by path, as Firestore keys them. */
let docs: Map<string, Record<string, unknown>>
let revoked: string[]
let revokeStatus: number
let revokeBody: unknown

/**
 * The slice of Firestore the erasers use: equality queries on a collection
 * path, subcollections, and batched deletes.
 */
function fakeFirestore(): FirebaseFirestore.Firestore {
  const snapshot = (path: string) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    ref: { path },
    data: () => docs.get(path),
    get: (field: string) => docs.get(path)?.[field],
  })
  const query = (path: string, filters: Array<[string, unknown]>, limit = Infinity): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported operator ${op}`)
      return query(path, [...filters, [field, value]], limit)
    },
    limit: (count: number) => query(path, filters, count),
    get: async () => {
      const found = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) => filters.every(([field, value]) => docs.get(key)?.[field] === value))
        .sort()
        .slice(0, limit)
        .map(snapshot)
      return { docs: found, size: found.length, empty: !found.length }
    },
  })
  const doc = (path: string): any => ({
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (path: string): any => ({ ...query(path, []), doc: (id: string) => doc(`${path}/${id}`) })
  return {
    collection,
    batch: () => {
      const deletes: string[] = []
      return {
        delete: (ref: { path: string }) => void deletes.push(ref.path),
        commit: async () => deletes.forEach((path) => docs.delete(path)),
      }
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

/** A stored credential, as a connect writes it. */
function storeCredential(mailboxId: string, orgId: string, account: string, token: string, uid = 'uid-rep'): void {
  docs.set(`${OUTREACH_COLLECTIONS.mailboxCredentials}/${mailboxId}`, {
    id: mailboxId,
    orgId,
    mailboxId,
    provider: 'google',
    providerAccountId: account,
    connectedByUid: uid,
    email: 'avery@rep.example.com',
    scopes: [],
    ...sealMailboxRefreshToken(token, mailboxId, KEYRING),
    createdAtMs: 1,
    updatedAtMs: 1,
  })
}

/** A connected mailbox under its organization. */
function storeMailbox(orgId: string, mailboxId: string, uid = 'uid-rep'): void {
  docs.set(`orgs/${orgId}/${OUTREACH_COLLECTIONS.mailboxes}/${mailboxId}`, {
    id: mailboxId,
    email: 'avery@rep.example.com',
    connectedByUid: uid,
  })
}

beforeEach(() => {
  docs = new Map()
  revoked = []
  revokeStatus = 200
  revokeBody = {}
  fetchGoogle.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the workspace eraser (AGL-2978)', () => {
  it('revokes each of the erased org’s grants with its opened refresh token, and no other org’s', async () => {
    storeCredential('gm_a', 'org-erased', 'account-1', 'refresh-a')
    storeCredential('gm_b', 'org-erased', 'account-2', 'refresh-b')
    storeCredential('gm_c', 'org-still-here', 'account-3', 'refresh-c')
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
    storeCredential('gm_a', 'org-erased', 'shared-account', 'refresh-a')
    storeCredential('gm_b', 'org-erased', 'shared-account', 'refresh-b')
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toMatchObject({
      revoked: 2,
      kept: 0,
    })
    storeCredential('gm_c', 'org-still-here', 'shared-account', 'refresh-c')
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
    storeCredential('gm_a', 'org-erased', 'account-1', 'refresh-a')
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
    docs = new Map([[`${OUTREACH_COLLECTIONS.mailboxCredentials}/gm_x`, { orgId: 'org-erased' }]])
    await expect(createOutreachOrgEraser(deps())({ orgId: 'org-erased', dryRun: false })).resolves.toEqual({
      grants: 1,
      revoked: 0,
      alreadyInvalid: 0,
      kept: 0,
      failed: 1,
    })
  })

  it('counts a grant it cannot open, or a deployment with no mailbox OAuth config, as failed without asking Google', async () => {
    storeCredential('gm_a', 'org-erased', 'account-1', 'refresh-a')
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
    storeCredential('gm_a', 'org-erased', 'account-1', 'refresh-a')
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

describe('the account eraser (AGL-3106)', () => {
  const credentialPath = (mailboxId: string) => `${OUTREACH_COLLECTIONS.mailboxCredentials}/${mailboxId}`
  const mailboxPath = (orgId: string, mailboxId: string) =>
    `orgs/${orgId}/${OUTREACH_COLLECTIONS.mailboxes}/${mailboxId}`
  const pendingPath = (orgId: string, uid: string) =>
    `orgs/${orgId}/outreachOAuthStates/${outreachOAuthStateDocId(orgId, uid)}`

  it('revokes and deletes every mailbox the person connected, in an org they left too, and their pending connects', async () => {
    storeCredential('gm_a', 'org-1', 'account-1', 'refresh-a')
    storeMailbox('org-1', 'gm_a')
    storeCredential('gm_b', 'org-left', 'account-2', 'refresh-b')
    storeMailbox('org-left', 'gm_b')
    storeMailbox('org-1', 'gm_orphan')
    docs.set(pendingPath('org-1', 'uid-rep'), { orgId: 'org-1', uid: 'uid-rep' })
    // A teammate's mailbox in the same org stays.
    storeCredential('gm_t', 'org-1', 'account-9', 'refresh-t', 'uid-teammate')
    storeMailbox('org-1', 'gm_t', 'uid-teammate')

    await expect(createOutreachUserEraser(deps())({ uid: 'uid-rep', orgIds: ['org-1'] })).resolves.toEqual({
      mailboxes: 3,
      grants: 2,
      revoked: 2,
      alreadyInvalid: 0,
      kept: 0,
      failed: 0,
    })
    expect(revoked.sort()).toEqual(['refresh-a', 'refresh-b'])
    for (const path of [
      credentialPath('gm_a'),
      credentialPath('gm_b'),
      mailboxPath('org-1', 'gm_a'),
      mailboxPath('org-left', 'gm_b'),
      mailboxPath('org-1', 'gm_orphan'),
      pendingPath('org-1', 'uid-rep'),
    ]) {
      expect([path, docs.has(path)]).toEqual([path, false])
    }
    expect(docs.has(credentialPath('gm_t'))).toBe(true)
    expect(docs.has(mailboxPath('org-1', 'gm_t'))).toBe(true)
  })

  it('keeps a grant at Google a teammate still uses for the same account, and deletes the person’s copy', async () => {
    storeCredential('gm_a', 'org-1', 'shared-inbox', 'refresh-a')
    storeMailbox('org-1', 'gm_a')
    storeCredential('gm_t', 'org-1', 'shared-inbox', 'refresh-t', 'uid-teammate')
    await expect(createOutreachUserEraser(deps())({ uid: 'uid-rep', orgIds: ['org-1'] })).resolves.toMatchObject({
      grants: 1,
      kept: 1,
      revoked: 0,
    })
    expect(revoked).toEqual([])
    expect(docs.has(credentialPath('gm_a'))).toBe(false)
    expect(docs.has(credentialPath('gm_t'))).toBe(true)
  })

  it('does not count the person’s own other copies of an account as a use, and revokes it', async () => {
    storeCredential('gm_a', 'org-1', 'own-account', 'refresh-a')
    storeCredential('gm_b', 'org-2', 'own-account', 'refresh-b')
    await expect(createOutreachUserEraser(deps())({ uid: 'uid-rep', orgIds: ['org-1', 'org-2'] })).resolves.toMatchObject({
      grants: 2,
      revoked: 2,
      kept: 0,
    })
  })

  it('still deletes everything when the deployment cannot revoke, and says so', async () => {
    storeCredential('gm_a', 'org-1', 'account-1', 'refresh-a')
    storeMailbox('org-1', 'gm_a')
    await expect(
      createOutreachUserEraser(deps({ readConfig: () => ({ configured: false, missing: ['OUTREACH_TOKEN_KEY'] }) }))({
        uid: 'uid-rep',
        orgIds: ['org-1'],
      }),
    ).resolves.toMatchObject({ grants: 1, failed: 1, revoked: 0 })
    expect(fetchGoogle).not.toHaveBeenCalled()
    expect(docs.has(credentialPath('gm_a'))).toBe(false)
    expect(docs.has(mailboxPath('org-1', 'gm_a'))).toBe(false)
  })

  it('answers zeros for a person who never connected a mailbox', async () => {
    storeCredential('gm_t', 'org-1', 'account-9', 'refresh-t', 'uid-teammate')
    await expect(createOutreachUserEraser(deps())({ uid: 'uid-rep', orgIds: ['org-1'] })).resolves.toEqual({
      mailboxes: 0,
      grants: 0,
      revoked: 0,
      alreadyInvalid: 0,
      kept: 0,
      failed: 0,
    })
    expect(docs.has(credentialPath('gm_t'))).toBe(true)
  })
})
