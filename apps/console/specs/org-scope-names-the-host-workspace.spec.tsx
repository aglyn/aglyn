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
 * The org scope names the workspace a HOST names, and says so (AGL-3314).
 *
 * On a custom console domain the middleware rewrites `/hosts` into
 * `/{orgSlug}/hosts`: the matched route carries the workspace and the address
 * bar does not. The client cannot recognize the domain by name — only a
 * subdomain of the workspace domain is readable from the host — but it can
 * see the rewrite, and `hostOrgSlug` is what every path parser uses to put
 * the workspace back in front of the path it reads. On the apex the path
 * already carries the workspace, so nothing is implied there.
 *
 * jsdom boots on `localhost`, which is no workspace subdomain: every case
 * here is decided by the params and the path alone, which is the custom
 * domain's situation exactly. The subdomain half has a file of its own,
 * booted on one (`org-scope-on-a-self-hosted-subdomain.spec.tsx`).
 */
import { act, render, screen } from '@testing-library/react'
import { OrgScopeProvider, useOrgScope } from '../hooks/use-org-scope'

const mockPathname = jest.fn<string, []>()
const mockParams = jest.fn<Record<string, string>, []>()

const mockListeners: Array<(snapshot: unknown) => void> = []

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  // Both memberships are inside the window and localhost names no workspace,
  // so neither the slug index nor the out-of-window read should run; a
  // never-settling promise keeps a stray one inert.
  getDoc: jest.fn(() => new Promise(() => undefined)),
  limit: jest.fn(),
  query: jest.fn(),
  onSnapshot: (_query: unknown, _options: unknown, next: (snapshot: unknown) => void) => {
    mockListeners.push(next)
    return () => undefined
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = {}
  const auth = {}
  const user = { data: { uid: 'user-1' } }
  return {
    useFirestore: () => firestore,
    useUser: () => user,
    useAuth: () => auth,
  }
})

jest.mock('next/navigation', () => ({
  useParams: () => mockParams(),
  usePathname: () => mockPathname(),
}))

const MEMBERSHIPS = [
  { id: 'org_aglyn', slug: 'aglyn-org', orgName: 'Aglyn LLC' },
  { id: 'org_sale', slug: 'sale-test', orgName: 'Sale Test' },
]

function Probe() {
  const { currentOrg, hostOrgSlug, pathOrgSlug } = useOrgScope()
  return (
    <>
      <span data-testid="org">{currentOrg?.orgName ?? 'none'}</span>
      <span data-testid="host-slug">{hostOrgSlug ?? 'none'}</span>
      <span data-testid="path-slug">{pathOrgSlug ?? 'none'}</span>
    </>
  )
}

function openAt(route: string, params: Record<string, string>) {
  mockPathname.mockReturnValue(route)
  mockParams.mockReturnValue(params)
  window.localStorage.setItem('aglyn.selectedOrgId', 'org_sale')
  render(
    <OrgScopeProvider>
      <Probe />
    </OrgScopeProvider>,
  )
  act(() => {
    mockListeners[mockListeners.length - 1]?.({
      metadata: { fromCache: false },
      docChanges: () => MEMBERSHIPS.map(() => ({})),
      docs: MEMBERSHIPS.map((entry) => ({
        id: entry.id,
        data: () => ({ slug: entry.slug, orgName: entry.orgName }),
      })),
    })
  })
}

const text = (id: string) => screen.getByTestId(id).textContent

describe('the workspace a host names (AGL-3314)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockListeners.length = 0
    window.localStorage.clear()
  })

  it('boots on a host that is no workspace subdomain — the premise', () => {
    expect(window.location.hostname).toBe('localhost')
  })

  it('reads a custom console domain’s workspace off the rewrite', () => {
    // `console.acme-corp.com/hosts`, served from `/aglyn-org/hosts`.
    openAt('/hosts', { orgSlug: 'aglyn-org' })
    expect(text('host-slug')).toBe('aglyn-org')
    expect(text('path-slug')).toBe('aglyn-org')
    expect(text('org')).toBe('Aglyn LLC')
  })

  it('implies nothing on the apex, where the path carries the workspace', () => {
    openAt('/aglyn-org/hosts', { orgSlug: 'aglyn-org' })
    expect(text('host-slug')).toBe('none')
    expect(text('path-slug')).toBe('aglyn-org')
  })

  it('implies nothing on an org-less route', () => {
    openAt('/manage/user', {})
    expect(text('host-slug')).toBe('none')
    expect(text('path-slug')).toBe('none')
  })
})
