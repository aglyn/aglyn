/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

/**
 * `/billing`, the org-agnostic entry point, DRIVEN (AGL-2430).
 *
 * The reason this page exists is that Stripe's "Payment method updates"
 * setting takes ONE link for the whole account. Every branch below is a
 * customer who clicked that one link, so each is asserted on the DOM or the
 * navigation the customer would actually get — never on the resolver, which
 * has its own unit spec beside it.
 *
 * The signed-out case is asserted through the REAL `AuthenticatedLayout`,
 * the same component the `(app)` route group wraps this page in. That is the
 * whole reason the page lives inside that group: the return target is the
 * one thing a bespoke redirect would have had to reinvent, and getting it
 * wrong fails silently — the customer signs in and lands on a dashboard.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockReplace = jest.fn()
const mockPush = jest.fn()

/** Mutated per test; the hook double reads it so no test rebuilds the mock. */
const mockScope: {
  orgs: Array<{ $id: string; slug?: string; orgName?: string }>
  loading: boolean
  confirmed: boolean
  error: boolean
  hasMoreOrgs: boolean
} = {
  orgs: [],
  loading: false,
  confirmed: true,
  error: false,
  hasMoreOrgs: false,
}

let mockPathname = '/billing'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

/**
 * ONE object, read through a getter — never a fresh literal per call. A hook
 * double that returns a new object on every call is the AGL-2105 render loop,
 * and this page holds `orgs` in a `useMemo` dependency.
 */
jest.mock('../hooks/use-org-scope', () => {
  const value = {
    get orgs() {
      return mockScope.orgs
    },
    get loading() {
      return mockScope.loading
    },
    get confirmed() {
      return mockScope.confirmed
    },
    get error() {
      return mockScope.error
    },
    get hasMoreOrgs() {
      return mockScope.hasMoreOrgs
    },
    currentOrg: null,
    selectOrg: () => undefined,
    orgSlug: null,
    pathOrgSlug: null,
    slugExists: true,
    retry: () => undefined,
    loadMoreOrgs: () => undefined,
  }
  return {
    __esModule: true,
    useOrgSlug: () => '',
    useOrgScope: () => value,
    default: () => value,
  }
})

/**
 * The console chrome. `DashboardLayout` reaches for branding, host tabs and a
 * breadcrumb trail, none of which is on the path from "which workspace" to
 * "which billing page"; the EmptyState, the picker cards and `AppLink` are
 * all left real, because they are what the customer reads.
 */
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

/**
 * The signed-out leg's doubles. Top-level, never behind `jest.resetModules()`
 * + a lazy `require`: re-requiring a component after a module reset hands it a
 * SECOND copy of React, and every hook in it then throws "Invalid hook call"
 * — a failure that reads like a bug in the component under test.
 */
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useSigninCheck: () => ({
    status: 'success',
    data: { signedIn: false, user: null },
  }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('../hooks/use-idle-logout', () => ({
  __esModule: true,
  default: () => undefined,
}))

const BillingEntry = require('../app/(app)/billing/page').default
const AuthenticatedLayout =
  require('../components/layouts/authenticated.layout').default

const reset = (next: Partial<typeof mockScope>) => {
  mockScope.orgs = []
  mockScope.loading = false
  mockScope.confirmed = true
  mockScope.error = false
  mockScope.hasMoreOrgs = false
  Object.assign(mockScope, next)
  mockPathname = '/billing'
  mockReplace.mockClear()
  mockPush.mockClear()
}

describe('/billing — the one link Stripe can mail', () => {
  it('sends a single-workspace customer straight to their own billing page', async () => {
    reset({ orgs: [{ $id: 'o1', slug: 'acme', orgName: 'Acme' }] })
    render(<BillingEntry />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/acme/billing'))
    // …and never shows the picker on the way through.
    expect(screen.queryByText('Choose a workspace')).toBeNull()
  })

  it('lets a customer with several workspaces choose, and links each to ITS billing page', async () => {
    reset({
      orgs: [
        { $id: 'o1', slug: 'acme', orgName: 'Acme' },
        { $id: 'o2', slug: 'globex', orgName: 'Globex' },
      ],
    })
    render(<BillingEntry />)
    expect(await screen.findByText('Choose a workspace')).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
    /**
     * Read off the DOM the customer clicks, not off the resolver. `AppLink`
     * with `componentVariant="button"` renders a real `<a href>` carrying
     * MUI's `role="button"` — so `getAllByRole('link')` finds NOTHING here,
     * which is worth knowing before writing the next one of these.
     */
    const hrefs = screen
      .getAllByRole('button', { name: 'Billing' })
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(
      expect.arrayContaining(['/acme/billing', '/globex/billing']),
    )
  })

  it('tells a customer with no workspace something useful instead of dropping them on a dashboard', async () => {
    reset({ orgs: [] })
    render(<BillingEntry />)
    expect(await screen.findByText('No workspace to bill')).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  /**
   * A denied membership listen says nothing about what workspaces exist
   * (AGL-1260/AGL-1066). "No workspace to bill" is a statement of fact about
   * someone's account; asserting it off a failed read is how a paying
   * customer gets told they have nothing to pay for.
   */
  it('does not claim "no workspace" when the membership read failed', async () => {
    reset({ orgs: [], error: true })
    render(<BillingEntry />)
    await waitFor(() => expect(screen.queryByText(/No workspace to bill/)).toBeNull())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  /**
   * The AGL-1149 lesson from the org jump page: `loading` goes false on the
   * FIRST snapshot, which is the CACHED one. A redirect is not a render you
   * can correct a beat later.
   */
  it('holds the redirect until the membership list is CONFIRMED, not merely loaded', async () => {
    reset({ orgs: [{ $id: 'o1', slug: 'stale' }], confirmed: false })
    render(<BillingEntry />)
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeNull())
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

/**
 * THE DEADLOCK CASE. A workspace locked for non-payment is the likeliest
 * arrival here, and the entry point must treat it exactly like any other —
 * a lock that hides the page where payment happens cannot be lifted by
 * paying.
 */
describe('/billing — a locked, past-due workspace', () => {
  it('is routed to its billing page like any other', async () => {
    reset({
      orgs: [
        {
          $id: 'o1',
          slug: 'acme',
          orgName: 'Acme',
          // The carrier `applyOrgLockdown` writes, plus the mirror the
          // dunning banner reads. Neither may change the destination.
          ...({
            suspendedAt: 1_755_043_200_000,
            suspendedReasonCode: 'billing',
            billingStatus: 'past_due',
          } as object),
        },
      ],
    })
    render(<BillingEntry />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/acme/billing'))
  })
})

/**
 * The signed-out leg, through the component that actually decides it.
 *
 * `AuthenticatedLayout` is the `(app)` group's gate; this asserts the target
 * it pushes carries THIS page as the return, so a customer who followed a
 * dunning email while signed out comes back to billing rather than to a
 * console root.
 */
describe('/billing — signed out', () => {
  it('redirects to sign-in WITH /billing as the return target', async () => {
    reset({})
    mockPathname = '/billing'
    render(
      <AuthenticatedLayout>
        <div>{'billing entry'}</div>
      </AuthenticatedLayout>,
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const target = String(mockPush.mock.calls[0]?.[0] ?? '')
    // The return target is the assertion. A bare `/signin` would pass a
    // check that only looked for the path, and would land the customer on a
    // dashboard after they signed in — the dead end this page removes.
    expect(target.startsWith('/signin?')).toBe(true)
    expect(decodeURIComponent(target)).toContain('/billing')
  })
})
