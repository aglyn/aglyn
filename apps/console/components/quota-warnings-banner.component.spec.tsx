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
 * AGL-1068: the banner must not ask for org-wide totals it is not allowed
 * to have.
 *
 * What is asserted is the QUERY, not the rendering. An unfiltered `count()`
 * over an org collection is denied for a scoped collaborator on the query
 * SHAPE — Firestore does not evaluate an aggregate per document — so the
 * only fix is to not send it. Asserting "the row is absent" would pass just
 * as well with the query still going out and failing, which is precisely
 * the state this issue describes: every page load denied, silently caught,
 * and the row missing anyway.
 *
 * So each case counts calls to `getCountFromServer` and checks which paths
 * they addressed.
 */

import { render, waitFor } from '@testing-library/react'

const countedPaths: string[] = []
const scope = { orgWide: true, loaded: false }

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getCountFromServer: jest.fn((path: string) => {
    countedPaths.push(path)
    return Promise.resolve({ data: () => ({ count: 3 }) })
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useScopeTokens: () => scope,
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
}))
jest.mock('next/navigation', () => ({ useParams: () => ({}) }))

import QuotaWarningsBanner from './quota-warnings-banner.component'

const orgPaths = () => countedPaths.filter((p) => p.startsWith('orgs/'))

beforeEach(() => {
  countedPaths.length = 0
  scope.orgWide = true
  scope.loaded = false
  sessionStorage.clear()
})

describe('QuotaWarningsBanner org-wide counts (AGL-1068)', () => {
  it('asks for no org total while the viewer scope is still loading', async () => {
    render(<QuotaWarningsBanner />)
    // The host-scoped screens count is fine and proves the effect ran at
    // all — without it an empty `orgPaths()` would pass vacuously.
    await waitFor(() => expect(countedPaths).toContain('hosts/host-1/screens'))
    expect(orgPaths()).toEqual([])
  })

  it('asks for no org total for a scoped collaborator', async () => {
    scope.loaded = true
    scope.orgWide = false
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(countedPaths).toContain('hosts/host-1/screens'))
    expect(orgPaths()).toEqual([])
  })

  it('asks for both once an org-wide viewer has resolved', async () => {
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await waitFor(() =>
      expect(orgPaths()).toContain('orgs/org-1/datasets'),
    )
    await waitFor(() => expect(orgPaths()).toContain('orgs/org-1/members'))
  })

  it('never addresses the removed host datasets path (AGL-1050)', async () => {
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(countedPaths).toContain('hosts/host-1/screens'))
    expect(countedPaths).not.toContain('hosts/host-1/datasets')
  })
})
