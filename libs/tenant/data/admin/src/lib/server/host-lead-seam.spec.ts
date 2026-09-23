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

/**
 * The lead seam (AGL-3275), and the four claims that make the migration safe.
 *
 *  1. A write ALWAYS targets the org, and never the host path. The AGL-1050
 *     note this migration is modeled on says a second writable path is a
 *     second boundary to enforce forever; a double that let a write land on
 *     the host row would make that regression green.
 *  2. A not-yet-backfilled lead is carried onto the org by the next write
 *     that touches it, stamped with the capturing site's consent scope — so a
 *     row written before the promotion cannot be amended in two places.
 *  3. The lookup is UNSCOPED. A sibling brand in the same consent group finds
 *     the person even when the row's `visibleTo` does not yet name it, which
 *     is the whole reason one person stopped being two records.
 *  4. Absence is absence: no org row and no host row answers `null`, not an
 *     empty document that a caller could mistake for a lead.
 *
 * The third is the one that fails quietly. A scoped lookup still returns a
 * lead most of the time — every single-brand org looks identical — and only a
 * multi-brand capture reveals that the second brand minted a duplicate.
 */

import {
  leadForWrite,
  legacyLeadExists,
  orgLeadsForHost,
  readLeadForHost,
} from './host-visitor-records'

const ORG = 'org-1'
const HOST_A = 'hostA'
const HOST_B = 'hostB'
/** `personKey` is the sha256 of the address; its value is irrelevant here. */
const KEY = 'a'.repeat(64)

/** path -> data. The whole database. */
let docs: Map<string, Record<string, unknown>>
/** Every path written, in order — claim 1 reads this. */
let writes: string[]

function docRef(path: string): any {
  return {
    path,
    get: async () => ({
      exists: docs.has(path),
      id: path.split('/').pop(),
      ref: docRef(path),
      data: () => docs.get(path),
      get: (field: string) => docs.get(path)?.[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push(path)
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : data)
    },
  }
}

function collectionRef(path: string): any {
  return { path, doc: (id: string) => docRef(`${path}/${id}`) }
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            collection: (child: string) => collectionRef(`${name}/${id}/${child}`),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('./organizations', () => ({
  __esModule: true,
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    collectionRef(`orgs/${ORG}/${name}`),
  resolveOrgIdForHost: async () => ORG,
  scopedToHost: (ref: unknown) => ref,
  // Both sites are one declared consent group — the multi-brand case. A
  // group of one would be the agency case and is `consentGroupScope`'s own
  // test; what matters here is that the seam asks for a group at all.
  consentGroupForSite: async () => ({
    groupId: 'group-1',
    hostIds: [HOST_A, HOST_B],
    declared: true,
    name: 'Two Brands',
  }),
}))

beforeEach(() => {
  docs = new Map()
  writes = []
})

const orgPath = `orgs/${ORG}/leads/${KEY}`
const hostPath = (hostId: string) => `hosts/${hostId}/leads/${KEY}`

describe('the write target', () => {
  it('is the org, and the host row is left untouched', async () => {
    docs.set(hostPath(HOST_A), { email: 'p@x.com', source: 'form:quote' })

    const { ref, existed, carried } = await leadForWrite(HOST_A, KEY)

    expect(ref.path).toBe(orgPath)
    expect(existed).toBe(true)
    expect(carried).toBe(true)
    // Claim 1: nothing was written to the legacy path.
    expect(writes).toEqual([orgPath])
    expect(await legacyLeadExists(HOST_A, KEY)).toBe(true)
  })

  it('carries the legacy row onto the org under the capturing group', async () => {
    docs.set(hostPath(HOST_A), { email: 'p@x.com', source: 'form:quote' })

    await leadForWrite(HOST_A, KEY)

    expect(docs.get(orgPath)).toEqual({
      email: 'p@x.com',
      source: 'form:quote',
      visibleTo: [`host:${HOST_A}`, `host:${HOST_B}`],
      migratedFromHostId: HOST_A,
    })
  })

  it('does not re-carry a lead the org already holds', async () => {
    docs.set(orgPath, { email: 'p@x.com', visibleTo: [`host:${HOST_A}`] })
    docs.set(hostPath(HOST_A), { email: 'stale@x.com' })

    const { existed, carried } = await leadForWrite(HOST_A, KEY)

    expect(existed).toBe(true)
    expect(carried).toBe(false)
    expect(writes).toEqual([])
    // The stale legacy row did not overwrite the org's.
    expect(docs.get(orgPath)).toEqual({
      email: 'p@x.com',
      visibleTo: [`host:${HOST_A}`],
    })
  })

  it('reports a brand-new lead as neither existing nor carried', async () => {
    const { ref, existed, carried } = await leadForWrite(HOST_A, KEY)

    expect(ref.path).toBe(orgPath)
    expect(existed).toBe(false)
    expect(carried).toBe(false)
    expect(writes).toEqual([])
  })
})

describe('the lookup', () => {
  it('prefers the org row over a legacy one', async () => {
    docs.set(orgPath, { email: 'current@x.com' })
    docs.set(hostPath(HOST_A), { email: 'stale@x.com' })

    expect((await readLeadForHost(HOST_A, KEY))?.get('email')).toBe('current@x.com')
  })

  it('falls back to a legacy row the backfill has not reached', async () => {
    docs.set(hostPath(HOST_A), { email: 'p@x.com' })

    expect((await readLeadForHost(HOST_A, KEY))?.get('email')).toBe('p@x.com')
  })

  /*
   * CLAIM 3. Host B is in the group but is not yet named on the row — the
   * state right after Host A captured this person. B must still FIND them, or
   * B's capture door concludes "no lead here" and mints the second record
   * this migration exists to prevent.
   *
   * Recognizing somebody and being allowed to read their row are different
   * acts: this asserts the first. The second is `orgLeadsQueryForHost`, which
   * goes through `scopedToHost` and would not return this row.
   */
  it('finds a sibling brand’s lead that does not name this site yet', async () => {
    docs.set(orgPath, { email: 'p@x.com', visibleTo: [`host:${HOST_A}`] })

    const found = await readLeadForHost(HOST_B, KEY)

    expect(found).not.toBeNull()
    expect(found?.get('email')).toBe('p@x.com')
  })

  it('answers null when neither path holds the address', async () => {
    expect(await readLeadForHost(HOST_A, KEY)).toBeNull()
  })
})

describe('the collection', () => {
  it('resolves to the org, not the host', async () => {
    expect((await orgLeadsForHost(HOST_A)).path).toBe(`orgs/${ORG}/leads`)
  })
})
