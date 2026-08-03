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
 * The org jump page's auto-redirect must wait for SERVER confirmation
 * (AGL-1149).
 *
 * The reported bug: a member accepted an invite to a second org, and `/` kept
 * redirecting them into the first one — their new org's sites "weren't there"
 * because they were looking at a different workspace entirely.
 *
 * The cause was one word. The redirect gated on `loading`, which `useOrgScope`
 * clears on the FIRST snapshot — and with the console's persistent multi-tab
 * Firestore cache, the first snapshot is the CACHED one. A stale one-org cache
 * therefore redirected before the two-org server answer arrived. `confirmed`
 * had always tracked server confirmation separately; the redirect just never
 * used it.
 *
 * AGL-1149's own follow-up asked for exactly this: "Nothing tests the
 * redirect. A case with a cached one-org list and a server two-org list would
 * have caught bug 1."
 *
 * A redirect is the specific reason this is worth a test rather than a
 * comment. Rendering the wrong thing for one frame self-corrects; navigating
 * away is something the user has to undo, and it lands them on the page they
 * were trying to leave.
 */

import { render } from '@testing-library/react'
import React from 'react'

const mockReplace = jest.fn()

jest.mock('next/navigation', () => {
  // Stable identity: the redirect effect depends on `router`, so a fresh
  // object per render would re-fire it and mask a missing guard.
  const router = {
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
  }
  return {
    ...jest.requireActual('next/navigation'),
    useRouter: () => router,
    useParams: () => ({}),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
  }
})

/** Swapped per test to stand in for a cached vs server-confirmed snapshot. */
let mockScope: {
  orgs: Array<{ $id: string; slug: string; orgName?: string }>
  loading: boolean
  confirmed: boolean
}

jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => mockScope,
  useOrgSlug: () => '',
}))

jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))

// Chrome and dialogs are irrelevant to the redirect decision and drag in
// Firebase providers if left real.
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/org-invites-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OrgJump = require('../app/(app)/(home)/page').default

const ONE_ORG = [{ $id: 'org-1', slug: 'first-org', orgName: 'First Org' }]
const TWO_ORGS = [
  { $id: 'org-1', slug: 'first-org', orgName: 'First Org' },
  { $id: 'org-2', slug: 'second-org', orgName: 'Second Org' },
]

describe('org jump auto-redirect (AGL-1149)', () => {
  beforeEach(() => mockReplace.mockClear())

  it('does NOT redirect on an unconfirmed one-org list — the reported bug', () => {
    // The exact reported state: the cache says one org, the server has not
    // answered yet, and the server answer is going to say two.
    mockScope = { orgs: ONE_ORG, loading: false, confirmed: false }
    render(<OrgJump />)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('redirects once the one-org list is server-confirmed', () => {
    mockScope = { orgs: ONE_ORG, loading: false, confirmed: true }
    render(<OrgJump />)
    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(String(mockReplace.mock.calls[0][0])).toContain('first-org')
  })

  it('never redirects a multi-org member', () => {
    mockScope = { orgs: TWO_ORGS, loading: false, confirmed: true }
    render(<OrgJump />)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('does not redirect while still loading', () => {
    mockScope = { orgs: ONE_ORG, loading: true, confirmed: false }
    render(<OrgJump />)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('does not redirect a member with no orgs', () => {
    mockScope = { orgs: [], loading: false, confirmed: true }
    render(<OrgJump />)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  /**
   * The whole scenario end to end, in the order it actually happened: the
   * cached snapshot arrives first and must not move anyone, then the server
   * answer arrives with two orgs and must leave them on the chooser.
   *
   * The two states are asserted together because the bug was only visible as a
   * sequence — each state on its own looks defensible.
   */
  it('stays put across cached-one-org → confirmed-two-orgs', () => {
    mockScope = { orgs: ONE_ORG, loading: false, confirmed: false }
    const view = render(<OrgJump />)
    expect(mockReplace).not.toHaveBeenCalled()

    mockScope = { orgs: TWO_ORGS, loading: false, confirmed: true }
    view.rerender(<OrgJump />)
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
