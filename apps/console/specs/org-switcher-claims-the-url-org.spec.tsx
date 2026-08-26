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
 * The switcher names the workspace the URL names, or names none (AGL-2486).
 *
 *
 * `use-org-scope` no longer misses on the not-found boundary, so this is the
 * GUARD rather than the fix, and it is worth having on its own: the scope
 * still falls back whenever its URL-derived candidates miss — a mistyped
 * `/gibberish` parses as a leading segment that names no workspace — and the
 * old gate could not catch that, because it asked whether the route is about
 * SOME workspace and then rendered a name that came from somewhere else
 * entirely.
 *
 * What must NOT appear is asserted on the rendered DOM rather than a
 * screenshot, and includes the plan badge specifically: an Upgrade-adjacent
 * tier pill for a workspace the page has nothing to do with was AGL-1130's
 * original complaint.
 */
import { render, screen } from '@testing-library/react'

const mockPathname = jest.fn<string, []>()
const scope: {
  currentOrg: { $id: string; slug?: string; orgName?: string } | null
} = { currentOrg: null }

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: jest.fn() }),
}))

// The real `useUrlNamedOrg` runs against this, which is the whole point —
// it is the comparison between the URL and the resolved org that is under
// test, not a hand-mocked verdict about it.
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    orgs: [
      { $id: 'org_aglyn', slug: 'aglyn-org', orgName: 'Aglyn LLC' },
      { $id: 'org_sale', slug: 'sale-test', orgName: 'Sale Test' },
    ],
    currentOrg: scope.currentOrg,
    orgSlug: null,
    hasMoreOrgs: false,
    loadMoreOrgs: jest.fn(),
  }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'free' }, ready: true }),
}))
jest.mock('../hooks/use-org-plans', () => ({ useOrgPlans: () => ({}) }))
// Reaches for Firebase services on import; nothing here opens it.
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))

async function openAt(
  route: string,
  currentOrg: { $id: string; slug?: string; orgName?: string } | null,
) {
  mockPathname.mockReturnValue(route)
  scope.currentOrg = currentOrg
  const { OrgSwitcherNav } = await import(
    '../components/org-switcher-nav.component'
  )
  render(<OrgSwitcherNav />)
}

const SALE = { $id: 'org_sale', slug: 'sale-test', orgName: 'Sale Test' }
const AGLYN = { $id: 'org_aglyn', slug: 'aglyn-org', orgName: 'Aglyn LLC' }

describe('what the workspace switcher claims (AGL-2486)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does NOT name a workspace the URL contradicts', async () => {
    // The URL says `aglyn-org`; the scope fell through to the remembered one.
    await openAt('/aglyn-org/hosts/aglyn-marketing/screens/pegb_4s5wV', SALE)
    expect(screen.queryByText('Sale Test')).toBeNull()
    expect(screen.queryByLabelText(/Workspace: Sale Test/)).toBeNull()
  })

  it('shows NO plan badge for a workspace the URL does not name', async () => {
    await openAt('/aglyn-org/hosts/aglyn-marketing/screens/pegb_4s5wV', SALE)
    // AGL-1130's original complaint, in one assertion: the tier pill (and the
    // Upgrade CTA it anchors) must not advertise an unrelated org's plan.
    expect(screen.queryByText('Free')).toBeNull()
  })

  it('offers a neutral picker instead, so a 404 is escapable', async () => {
    // Naming nothing is right on the workspace PICKER, where the page below
    // is itself the chooser. Here the user is most likely on a 404 and the
    // switcher is their way out, so the control stays — it just stops
    // asserting.
    await openAt('/aglyn-org/hosts/aglyn-marketing/screens/pegb_4s5wV', SALE)
    expect(screen.getByLabelText('Choose a workspace')).toBeTruthy()
  })

  it('DOES name the workspace when the URL and the scope agree', async () => {
    // The discriminating half: a fix that merely stopped naming things would
    // pass every assertion above and be a worse bug.
    await openAt('/aglyn-org/hosts/aglyn-marketing', AGLYN)
    expect(screen.getByLabelText('Workspace: Aglyn LLC')).toBeTruthy()
    expect(screen.getByText('Free')).toBeTruthy()
  })
})
