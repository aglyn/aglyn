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

import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore'

/**
 * `editAccessMintRefusal` — the one gate both admin bar token mints run
 * (the console's `/api/edit-access/token` and the tenant's
 * `/api/edit-access/exchange`) — decides reach to the ONE host being minted
 * for (AGL-3062).
 *
 * The org roster holds managers and site collaborators alike, and a
 * collaborator can carry the org role `editor` with `allHosts: false` and a
 * `hostAccess` map naming only their own sites. Reading that org role on its
 * own minted the collaborator a token for every site in the org, and the
 * admin bar then showed them another site's screens and today's traffic.
 * The presence broker was narrowed the same way in AGL-1881.
 *
 * The gate runs for real here; only its leaf dependencies (the release flag,
 * the lockdown verdict and the org doc) and Firestore are doubles. Each case
 * holds the host fixed and changes only the member row, so a verdict can only
 * come from the gate reading that row.
 */

let mockFlagOn = true
let mockLockdownResponse: Response | null = null

jest.mock('./release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: jest.fn(async () => mockFlagOn),
}))
jest.mock('./lockdown', () => ({
  __esModule: true,
  lockdownRefusal: jest.fn(async () => mockLockdownResponse),
}))
jest.mock('./organizations', () => ({
  __esModule: true,
  getOrgDoc: jest.fn(async () => ({})),
}))

import { editAccessMintRefusal } from './edit-access-authz'

const ORG = 'org-1'
const HOST = 'host-this'
const OTHER_HOST = 'host-other'
const UID = 'uid-1'

type Row = Record<string, unknown>

function snapshot(id: string, data: Row | null): DocumentSnapshot {
  return {
    id,
    exists: data !== null,
    data: () => data ?? undefined,
    get: (field: string) => (data ? data[field] : undefined),
  } as unknown as DocumentSnapshot
}

/** A Firestore whose only document is this uid's org roster row. */
function firestoreWithMember(member: Row | null): Firestore {
  return {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: (uid: string) => ({
            get: async () => snapshot(uid, uid === UID ? member : null),
          }),
        }),
      }),
    }),
  } as unknown as Firestore
}

/** The HTTP status the gate refuses with, or `'admitted'`. */
async function verdict(
  member: Row | null,
  memberRoles: Record<string, string> = {},
): Promise<number | 'admitted'> {
  const refusal = await editAccessMintRefusal({
    request: new Request('https://this-site.aglyn.app/api/edit-access/exchange', {
      method: 'POST',
    }),
    firestore: firestoreWithMember(member),
    host: snapshot(HOST, { orgId: ORG, memberRoles }),
    orgId: ORG,
    uid: UID,
  })
  return refusal ? refusal.status : 'admitted'
}

describe('the edit-access mint gate decides reach to this host (AGL-3062)', () => {
  beforeEach(() => {
    mockFlagOn = true
    mockLockdownResponse = null
  })

  it.each<[string, Row]>([
    ['a workspace owner', { role: 'owner' }],
    ['a workspace admin', { role: 'admin', allHosts: false }],
    ['an org-wide editor', { role: 'editor', allHosts: true }],
    [
      'a legacy editor row, with neither allHosts nor hostAccess',
      { role: 'editor' },
    ],
    [
      'a site collaborator who edits this site',
      { role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'editor' } },
    ],
    [
      'a site collaborator who is an author on this site',
      { role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'author' } },
    ],
    [
      'a collaborator holding the org role editor, scoped to this site',
      { role: 'editor', allHosts: false, hostAccess: { [HOST]: 'editor' } },
    ],
  ])('admits %s', async (_who, member) => {
    await expect(verdict(member)).resolves.toBe('admitted')
  })

  it.each<[string, Row]>([
    [
      // The reported shape: the org role alone used to admit it.
      'a collaborator holding the org role editor, scoped to another site',
      { role: 'editor', allHosts: false, hostAccess: { [OTHER_HOST]: 'editor' } },
    ],
    [
      'an editor scoped to no site at all',
      { role: 'editor', allHosts: false, hostAccess: {} },
    ],
    [
      'a site collaborator who edits another site',
      { role: 'viewer', allHosts: false, hostAccess: { [OTHER_HOST]: 'editor' } },
    ],
    [
      'a site collaborator who only views this site',
      { role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'viewer' } },
    ],
    ['an org-wide viewer', { role: 'viewer', allHosts: true }],
    ['a legacy viewer row', { role: 'viewer' }],
  ])('refuses %s with a 403', async (_who, member) => {
    await expect(verdict(member)).resolves.toBe(403)
  })

  it("admits a grant in the host's own memberRoles on its own", async () => {
    await expect(
      verdict(
        { role: 'viewer', allHosts: false, hostAccess: { [OTHER_HOST]: 'viewer' } },
        { [UID]: 'editor' },
      ),
    ).resolves.toBe('admitted')
  })

  it('refuses a uid with no roster row, whatever the host lists', async () => {
    await expect(verdict(null, { [UID]: 'editor' })).resolves.toBe(403)
  })

  it('answers 404 while release_edit_bar is off for the org, before reading anyone', async () => {
    mockFlagOn = false
    await expect(verdict({ role: 'owner' })).resolves.toBe(404)
  })

  it('hands an admitted member on to the lockdown verdict', async () => {
    mockLockdownResponse = Response.json({ error: 'Locked' }, { status: 423 })
    await expect(verdict({ role: 'owner' })).resolves.toBe(423)
    // A refused member never reaches it: the reach answer comes first.
    await expect(
      verdict({
        role: 'editor',
        allHosts: false,
        hostAccess: { [OTHER_HOST]: 'editor' },
      }),
    ).resolves.toBe(403)
  })
})
