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
 * The zero-org "Create site" path has to CARRY the plan intent too
 * (AGL-1117).
 *
 * A visitor who clicks a plan CTA on /pricing and has no workspace at all is
 * the likeliest buyer on the page, and the narrowest path: there is no picker
 * to choose from and no create-workspace dialog in the way. "Create site"
 * there makes the workspace (AGL-3761: the site is created later, once its
 * start is answered), and a visit carrying a plan then lands on billing with
 * it, where the workspace is what the plan is bought for. Every path is built
 * by `onboardingDestination`, so enterprise still routes to support and an
 * unstated interval stays unstated.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockHardNavigate = jest.fn()
let mockStoredUserDoc: Record<string, unknown> = {}
let mockSearchParams = new URLSearchParams()

// The reader's workspace pins (AGL-3762) are a read of their own account
// document; none of these assertions is about them.
jest.mock('@aglyn/console-ui/hooks/use-pinned-orgs', () => ({
  __esModule: true,
  usePinnedOrgs: () => ({ pinned: [], ready: true, toggle: () => undefined }),
  default: () => ({ pinned: [], ready: true, toggle: () => undefined }),
}))
jest.mock('next/navigation', () => {
  // Stable identity: the jump effect depends on `router`, so a fresh object
  // per render would re-fire it.
  const router = {
    push: (...args: unknown[]) => mockPush(...args),
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
    useSearchParams: () => mockSearchParams,
  }
})

let mockScope: {
  orgs: Array<{ $id: string; slug: string; orgName?: string }>
  loading: boolean
  confirmed: boolean
  currentOrg: { $id: string; slug: string } | null
}
let mockInvites: { invites: unknown[]; loading: boolean }

jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => mockScope,
  useOrgSlug: () => '',
}))
jest.mock('@aglyn/console-ui/hooks/use-pending-invites', () => ({
  usePendingInvites: () => mockInvites,
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ data: () => mockStoredUserDoc }),
  setDoc: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/org-invites-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  SITE_CREATE_PARAM: 'create',
  SITE_CREATE_VALUE: 'site',
  default: () => null,
}))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockHardNavigate(url),
}))
jest.mock('../utils/console-landing', () => ({
  currentConsoleLandingHref: (url: string) => url,
}))
jest.mock('../utils/first-site-workspace', () => ({
  createFirstSiteWorkspace: async () => ({ slug: 'smoke-test-0831' }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))

const OrgJump = require('../app/(app)/(home)/page').default

/** Let the account's remembered-intent read settle before asserting. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Render the empty console and choose its "Create site". */
const createFirstSite = async (button = 'Create site') => {
  render(<OrgJump />)
  await flush()
  await act(async () => {
    fireEvent.click(screen.getByText(button))
    await Promise.resolve()
  })
  await flush()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredUserDoc = {}
  mockSearchParams = new URLSearchParams()
  mockScope = { orgs: [], loading: false, confirmed: true, currentOrg: null }
  mockInvites = { invites: [], loading: false }
})

describe('AGL-1117 · the zero-org first site keeps the plan intent', () => {
  it('lands the new workspace on billing with the URL intent', async () => {
    mockSearchParams = new URLSearchParams('plan=starter&interval=month')
    await createFirstSite()
    expect(mockHardNavigate).toHaveBeenCalledWith(
      '/smoke-test-0831/billing?plan=starter&interval=month',
    )
  })

  it('carries the intent the ACCOUNT remembered, with nothing on the URL', async () => {
    // The post-verification arrival: `/verify-email` hands back a bare `/`,
    // and this page's single consume already resolved it (AGL-1535).
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now(),
      },
    }
    await createFirstSite()
    expect(mockHardNavigate).toHaveBeenCalledWith(
      '/smoke-test-0831/billing?plan=pro&interval=year',
    )
  })

  it('does not restate an interval the CTA never stated', async () => {
    mockSearchParams = new URLSearchParams('plan=scale')
    await createFirstSite()
    expect(mockHardNavigate).toHaveBeenCalledWith('/smoke-test-0831/billing?plan=scale')
  })

  it('sends an enterprise CTA to support rather than a checkout', async () => {
    mockSearchParams = new URLSearchParams('plan=enterprise')
    await createFirstSite()
    expect(mockHardNavigate).toHaveBeenCalledWith('/smoke-test-0831/support?topic=enterprise')
  })

  it('opens Create site in the new workspace when there is no intent (AGL-3761)', async () => {
    await createFirstSite()
    // An ordinary first site is not a purchase: its start is asked next.
    expect(mockHardNavigate).toHaveBeenCalledWith('/smoke-test-0831/hosts?create=site')
  })

  it('carries the intent for an invitee who starts their own site instead', async () => {
    // A pending invite leads the zero-org state (AGL-851), and "Create my own
    // site instead" is the same path under a different button.
    mockInvites = { invites: [{ $id: 'inv-1' }], loading: false }
    mockSearchParams = new URLSearchParams('plan=business&interval=year')
    await createFirstSite('Create my own site instead')
    expect(mockHardNavigate).toHaveBeenCalledWith(
      '/smoke-test-0831/billing?plan=business&interval=year',
    )
  })
})
