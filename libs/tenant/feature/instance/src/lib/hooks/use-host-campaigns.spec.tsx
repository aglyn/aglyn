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
 * THE CAMPAIGN PICKERS' READS, AT BOTH LEVELS.
 *
 * Campaign containers are the organization's (`orgs/{orgId}/emailCampaigns`)
 * and each is placed on some of its sites by `visibleTo`. The properties
 * pinned here are the ones a second copy would get wrong: a site's picker
 * reads the ORG collection narrowed to the campaigns placed on that site —
 * the clause a scoped collaborator's read has to carry to be provable — and
 * the org's picker reads every one; neither reads until asked; a deleted
 * campaign is never offered; and each option says which sites it runs on.
 */

import { renderHook } from '@testing-library/react'
import {
  hostCampaignOptions,
  HOST_CAMPAIGN_CEILING,
  useHostCampaigns,
  useOrgCampaigns,
} from './use-host-campaigns'

/** Every query the hooks built: its path and its constraints. */
const mockQueries: Array<{ path: string; constraints: unknown[] }> = []
/** What the listener answers with. */
let mockRows: Array<Record<string, unknown>> = []
/** What the site's `hostIndex` lookup has settled to. */
let mockOrgState: { orgId: string | null; loaded: boolean } = {
  orgId: 'org-1',
  loaded: true,
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (
    base: { path: string; constraints: unknown[] },
    ...constraints: unknown[]
  ) => ({ path: base.path, constraints: [...base.constraints, ...constraints] }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  limit: (count: number) => ({ limit: count }),
  documentId: () => '__name__',
}))
jest.mock('./firebase/firebase-services', () => ({
  useFirestore: () => ({}),
}))
jest.mock('./use-host-org-id', () => ({
  useHostOrgIdState: (hostId: string | undefined) =>
    hostId ? mockOrgState : { orgId: null, loaded: true },
}))
jest.mock('./use-firestore-collection', () => ({
  useFirestoreCollection: (
    factory: () => { path: string; constraints: unknown[] } | null,
  ) => {
    const built = factory()
    if (built) mockQueries.push(built)
    return { data: built ? mockRows : [], status: built ? 'success' : 'loading' }
  },
}))

beforeEach(() => {
  mockQueries.length = 0
  mockRows = []
  mockOrgState = { orgId: 'org-1', loaded: true }
})

describe("a site's campaigns", () => {
  it('reads the ORG collection, narrowed to the campaigns placed on the site', () => {
    renderHook(() => useHostCampaigns('site-1', { enabled: true }))
    expect(mockQueries).toHaveLength(1)
    expect(mockQueries[0].path).toBe('orgs/org-1/emailCampaigns')
    expect(mockQueries[0].constraints).toEqual([
      { where: ['visibleTo', 'array-contains-any', ['org', 'host:site-1']] },
      { orderBy: '__name__' },
      { limit: HOST_CAMPAIGN_CEILING + 1 },
    ])
  })

  it('reads nothing until a caller asks, or while the org is unknown', () => {
    renderHook(() => useHostCampaigns('site-1'))
    mockOrgState = { orgId: null, loaded: false }
    const { result } = renderHook(() => useHostCampaigns('site-1', { enabled: true }))
    expect(mockQueries).toEqual([])
    expect(result.current.ready).toBe(false)
  })

  it('settles empty, not loading, for a site with no org', () => {
    mockOrgState = { orgId: null, loaded: true }
    const { result } = renderHook(() => useHostCampaigns('site-1', { enabled: true }))
    expect(mockQueries).toEqual([])
    expect(result.current).toEqual({ options: [], truncated: false, ready: true })
  })
})

describe("the org's campaigns", () => {
  it('reads every campaign in the org, with no site clause', () => {
    mockRows = [
      { $id: 'b', name: 'Beta', visibleTo: ['host:site-1', 'host:site-2'] },
      { $id: 'a', name: 'Alpha', visibleTo: ['org'] },
      { $id: 'gone', name: 'Gone', visibleTo: ['org'], deletedAt: 1 },
    ]
    const { result } = renderHook(() => useOrgCampaigns('org-1', { enabled: true }))
    expect(mockQueries).toEqual([
      {
        path: 'orgs/org-1/emailCampaigns',
        constraints: [{ orderBy: '__name__' }, { limit: HOST_CAMPAIGN_CEILING + 1 }],
      },
    ])
    expect(result.current.ready).toBe(true)
    expect(result.current.options.map((option) => [option.label, option.siteIds])).toEqual([
      ['Alpha', null],
      ['Beta', ['site-1', 'site-2']],
    ])
  })

  it('reads nothing until a caller asks, or with no org', () => {
    renderHook(() => useOrgCampaigns('org-1'))
    renderHook(() => useOrgCampaigns(null, { enabled: true }))
    expect(mockQueries).toEqual([])
  })
})

describe('the options', () => {
  it('drop the probe row and say the ceiling bit', () => {
    const rows = Array.from({ length: HOST_CAMPAIGN_CEILING + 1 }, (_, index) => ({
      $id: `c-${String(index).padStart(3, '0')}`,
      name: `Campaign ${String(index).padStart(3, '0')}`,
      visibleTo: ['org'],
    }))
    const picked = hostCampaignOptions(rows, true)
    expect(picked.truncated).toBe(true)
    expect(picked.options).toHaveLength(HOST_CAMPAIGN_CEILING)
  })

  it('read an unscoped campaign as on no site, not every site', () => {
    const [option] = hostCampaignOptions([{ $id: 'x', name: 'X' }], true).options
    expect(option.siteIds).toEqual([])
  })
})
