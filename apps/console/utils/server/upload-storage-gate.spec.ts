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
 * A member's file kept outside the media library meets the library's storage
 * band (AGL-4096): the same pool, which already holds the site's kept quote
 * and form files, and the same verdict past it. The band and the gate are
 * the real ones; only the workspace and its counters are stood in for.
 */

const MB = 1024 * 1024

let mockOwner: { orgId: string; org: Record<string, unknown> } | null = null
let mockCounters: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin', () => {
  const doc = (path: string): Record<string, unknown> => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
  })
  return {
    __esModule: true,
    getOrgForHost: async () => mockOwner,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
          getAll: async (...refs: Array<{ path: string }>) =>
            refs.map((ref) => ({ get: (field: string) => mockCounters[ref.path]?.[field] })),
        }),
      }),
    },
  }
})

import { checkUploadStorage } from './upload-storage-gate'

const freeOrg = { plan: 'free', hosts: { 'host-1': true } }
const proOrg = { plan: 'pro', subscription: { status: 'active' }, hosts: { 'host-1': true } }

beforeEach(() => {
  mockOwner = { orgId: 'org-1', org: freeOrg }
  mockCounters = {}
})

describe('a member’s proof meets the workspace’s storage band', () => {
  it('fits under the band', async () => {
    mockCounters['hosts/host-1/counters/media'] = { bytes: 100 * MB }
    expect(await checkUploadStorage({ hostId: 'host-1', bytes: 2 * MB })).toBeNull()
  })

  it('is refused past the band on a plan that does not bill storage, in the library’s words', async () => {
    mockCounters['hosts/host-1/counters/media'] = { bytes: 249 * MB }
    expect(await checkUploadStorage({ hostId: 'host-1', bytes: 2 * MB })).toEqual({
      status: 403,
      code: 'plan_limit_reached',
      error: 'Storage limit reached (250 MB across your workspace) — see Billing to upgrade',
    })
  })

  it('counts the site’s kept quote and form files in the pool, as the band does', async () => {
    // 200 MB of library files and 49 MB of kept files: a 2 MB proof no longer fits.
    mockCounters['hosts/host-1/counters/media'] = { bytes: 249 * MB, uploadBytes: 49 * MB }
    expect(await checkUploadStorage({ hostId: 'host-1', bytes: 2 * MB })).toMatchObject({ code: 'plan_limit_reached' })
  })

  it('is taken past the band on a plan that bills storage', async () => {
    mockOwner = { orgId: 'org-1', org: proOrg }
    mockCounters['hosts/host-1/counters/media'] = { bytes: 10_000_000 * MB }
    expect(await checkUploadStorage({ hostId: 'host-1', bytes: 2 * MB })).toBeNull()
  })

  it('is refused past a storage cap the workspace set, citing it', async () => {
    mockOwner = { orgId: 'org-1', org: { ...proOrg, storageOverage: { capUsd: 1 } } }
    mockCounters['hosts/host-1/counters/media'] = { bytes: 10_000_000 * MB }
    const refused = await checkUploadStorage({ hostId: 'host-1', bytes: 2 * MB })
    expect(refused).toMatchObject({ status: 403, code: 'storage_cap_reached' })
    expect(refused?.error).toContain('monthly storage cap you set')
  })

  it('says nothing for a site no workspace owns', async () => {
    mockOwner = null
    expect(await checkUploadStorage({ hostId: 'host-1', bytes: 2 * MB })).toBeNull()
  })
})
