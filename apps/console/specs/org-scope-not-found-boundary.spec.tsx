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
 * The URL stays authoritative on the NOT-FOUND boundary (AGL-2486).
 *
 * One workspace in the address bar, a different one in the switcher chip —
 * on a URL like `/<org>/hosts/<host>/screens/<id>`, which matches no route.
 *
 * The precedence in `useOrgScope` is right and is NOT what these tests
 * change. The hazard is that its top candidate reads the URL through
 * `useParams()`, and a not-found boundary is not a matched route: it has no
 * dynamic segments, so the params bag is EMPTY even though the pathname still
 * plainly names the workspace. Every URL-derived candidate misses and the
 * chain falls through to the remembered selection.
 *
 * `usePathname()` survives the boundary, and `resolveNavSection` already
 * encodes which leading segments are workspaces (`/admin` and `/manage` are
 * not). So the path slug falls back to the pathname when the params bag has
 * none.
 *
 * The org-less cases are asserted just as hard. The fallback to a remembered
 * org exists so org-less pages have one to ACT on — Manage Account browses
 * that org's media library, the menu's Billing row has to land somewhere — and
 * a fix that resolved those to nothing would trade this bug for that one.
 */
import { act, render, screen } from '@testing-library/react'
import { OrgScopeProvider, useOrgScope } from '../hooks/use-org-scope'

const mockPathname = jest.fn<string, []>()

/** Every listen opened, so the test can deliver the membership snapshot. */
const mockListeners: Array<(snapshot: unknown) => void> = []

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  // No workspace subdomain in jsdom, and both memberships are inside the
  // window, so neither the slug index nor the out-of-window read should ever
  // run. A never-settling promise keeps a stray one inert rather than
  // letting it quietly answer the question under test.
  getDoc: jest.fn(() => new Promise(() => undefined)),
  limit: jest.fn(),
  query: jest.fn(),
  onSnapshot: (
    _query: unknown,
    _options: unknown,
    next: (snapshot: unknown) => void,
  ) => {
    mockListeners.push(next)
    return () => undefined
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  // Stable identities, as reactfire provides: the membership effect keys on
  // `firestore`, so a fresh object per render would restart the listen.
  const firestore = {}
  const auth = {}
  const user = { data: { uid: 'user-1' } }
  return {
    useFirestore: () => firestore,
    useUser: () => user,
    // `useAuthRecovery` reads the Auth instance on every render (it re-runs a
    // read that a dead SESSION killed, once the session comes back). Nothing
    // in this suite makes it subscribe, but the accessor must exist or the
    // provider throws before the behavior under test can run.
    useAuth: () => auth,
  }
})

/**
 * THE POINT OF THE TEST. `useParams()` is empty — that is what a not-found
 * boundary actually gives you, because no dynamic segment matched — while
 * `usePathname()` still carries the whole URL.
 */
jest.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => mockPathname(),
}))

const MEMBERSHIPS = [
  { id: 'org_aglyn', slug: 'aglyn-org', orgName: 'Aglyn LLC' },
  { id: 'org_sale', slug: 'sale-test', orgName: 'Sale Test' },
]

function Probe() {
  const { currentOrg, pathOrgSlug } = useOrgScope()
  return (
    <>
      <span data-testid="org">{currentOrg?.orgName ?? 'none'}</span>
      <span data-testid="path-slug">{pathOrgSlug ?? 'none'}</span>
    </>
  )
}

/** Renders the provider at `route` with `sale-test` as the remembered org. */
function openAt(route: string) {
  mockPathname.mockReturnValue(route)
  // The remembered selection is the whole hazard: it is what the chain falls
  // through to, and it is a workspace the URL never mentions.
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

const resolvedOrg = () => screen.getByTestId('org').textContent

describe('the org scope on a route with no matched [orgSlug] (AGL-2486)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockListeners.length = 0
    window.localStorage.clear()
  })

  it('resolves the workspace the URL NAMES on the not-found boundary', () => {
    // A URL that names a workspace and matches no route:
    // `/screens/[screenId]` is not one — the editor lives at
    // `/screens/[screenId]/versions/[versionId]/…` — so this renders the
    // not-found boundary with an empty params bag.
    openAt('/aglyn-org/hosts/aglyn-marketing/screens/pegb_4s5wV')
    expect(resolvedOrg()).toBe('Aglyn LLC')
    expect(screen.getByTestId('path-slug').textContent).toBe('aglyn-org')
  })

  it('still falls back to the remembered org on the STAFF console', () => {
    // Not a regression guard for its own sake: `/admin/*` is org-less by
    // design and its pages still need an org to act on.
    openAt('/admin/media-quarantine')
    expect(resolvedOrg()).toBe('Sale Test')
    expect(screen.getByTestId('path-slug').textContent).toBe('none')
  })

  it('still falls back to the remembered org in the MANAGE area', () => {
    openAt('/manage/user')
    expect(resolvedOrg()).toBe('Sale Test')
    expect(screen.getByTestId('path-slug').textContent).toBe('none')
  })

  it('still falls back to the remembered org on the workspace PICKER', () => {
    openAt('/')
    expect(resolvedOrg()).toBe('Sale Test')
    expect(screen.getByTestId('path-slug').textContent).toBe('none')
  })
})
