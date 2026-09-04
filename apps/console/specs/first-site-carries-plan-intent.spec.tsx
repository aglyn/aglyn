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
 * to choose from and no create-workspace dialog in the way, because the first
 * SITE provisions the workspace. `CreateHostDialog` then navigates itself, to
 * the new site's Setup page — so the plan rode the URL right up to the one
 * click that was always going to drop it, and the buyer landed in Setup with
 * billing left to find.
 *
 * The picker's fix and this one are the same fix: the page that owns the
 * intent hands the dialog a `destination`, and every path is built by
 * `onboardingDestination` so enterprise still routes to support and an
 * unstated interval stays unstated.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockEnqueueSnackbar = jest.fn()
let mockStoredUserDoc: Record<string, unknown> = {}
let mockSearchParams = new URLSearchParams()

/** The `destination` builder the jump page hands the create-site dialog. */
let capturedDestination: ((orgSlug: string) => string) | undefined

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
jest.mock('../hooks/use-pending-invites', () => ({
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
// The page's copy of the dialog is a probe for the destination it is handed;
// the real component is exercised directly further down.
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  default: (props: { destination?: (orgSlug: string) => string }) => {
    capturedDestination = props.destination
    return null
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async () => ({
    ok: true,
    status: 200,
    // The workspace the server auto-provisioned on the way to the site.
    json: async () => ({
      hostId: 'host-1',
      subdomain: 'smoke-site-0831',
      orgId: 'org-new',
      orgSlug: 'smoke-test-0831',
    }),
  }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
  // Emitting `org_created` before a navigation needs the awaitable spelling
  // (AGL-2587); a mock that lacks it makes the call a TypeError inside the
  // create handler, which reads here as the create having failed.
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))

const OrgJump = require('../app/(app)/(home)/page').default
// The real dialog, not the probe above — the navigation after a successful
// create is the half that used to drop the intent.
const CreateHostDialog = jest.requireActual(
  '../components/create-host-dialog.component',
).default

/** Let the account's remembered-intent read settle before asserting. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Fill the dialog and submit it. */
const createSite = async () => {
  fireEvent.change(screen.getByLabelText('Site name'), {
    target: { value: 'Smoke Site 0831' },
  })
  await act(async () => {
    fireEvent.click(screen.getByText('Create site'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  capturedDestination = undefined
  mockStoredUserDoc = {}
  mockSearchParams = new URLSearchParams()
  mockScope = { orgs: [], loading: false, confirmed: true, currentOrg: null }
  mockInvites = { invites: [], loading: false }
})

describe('AGL-1117 · the zero-org first site keeps the plan intent', () => {
  it('hands the dialog a destination built from the URL intent', async () => {
    mockSearchParams = new URLSearchParams('plan=starter&interval=month')
    render(<OrgJump />)
    await flush()
    // Red before the fix: no destination was passed at all, and the dialog
    // navigated to the new site's Setup page with the plan gone.
    expect(capturedDestination?.('smoke-test-0831')).toBe(
      '/smoke-test-0831/billing?plan=starter&interval=month',
    )
  })

  it('carries the intent the ACCOUNT remembered, with nothing on the URL', async () => {
    // The post-verification arrival: `/verify-email` hands back a bare `/`,
    // and this page's single consume already resolved it — the zero-org
    // branch reads that same resolved value rather than asking again
    // (AGL-1535).
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now(),
      },
    }
    render(<OrgJump />)
    await flush()
    expect(capturedDestination?.('smoke-test-0831')).toBe(
      '/smoke-test-0831/billing?plan=pro&interval=year',
    )
  })

  it('does not restate an interval the CTA never stated', async () => {
    mockSearchParams = new URLSearchParams('plan=scale')
    render(<OrgJump />)
    await flush()
    expect(capturedDestination?.('smoke-test-0831')).toBe(
      '/smoke-test-0831/billing?plan=scale',
    )
  })

  it('sends an enterprise CTA to support rather than a checkout', async () => {
    mockSearchParams = new URLSearchParams('plan=enterprise')
    render(<OrgJump />)
    await flush()
    expect(capturedDestination?.('smoke-test-0831')).toBe(
      '/smoke-test-0831/support?topic=enterprise',
    )
  })

  it('passes no destination at all when there is no intent', async () => {
    render(<OrgJump />)
    await flush()
    // An ordinary first site is not a purchase — the dialog keeps its own
    // Setup landing rather than being redirected to a site list.
    expect(capturedDestination).toBeUndefined()
  })

  it('carries the intent for an invitee who starts their own site instead', async () => {
    // A pending invite leads the zero-org state (AGL-851), and "Create my own
    // site instead" is the same provisioning path under a different button.
    mockInvites = { invites: [{ $id: 'inv-1' }], loading: false }
    mockSearchParams = new URLSearchParams('plan=business&interval=year')
    render(<OrgJump />)
    await flush()
    expect(capturedDestination?.('smoke-test-0831')).toBe(
      '/smoke-test-0831/billing?plan=business&interval=year',
    )
  })
})

describe('AGL-1117 · the create-site dialog obeys the destination', () => {
  it('navigates the new workspace to the destination it was given', async () => {
    render(
      <CreateHostDialog
        open
        onClose={() => undefined}
        destination={(orgSlug: string) =>
          `/${orgSlug}/billing?plan=starter&interval=month`
        }
      />,
    )
    await createSite()
    // Red before the fix: the create landed on the new site's Setup page and
    // the plan was gone for good.
    expect(mockPush).toHaveBeenCalledWith(
      '/smoke-test-0831/billing?plan=starter&interval=month',
    )
  })

  it('still lands on the new site Setup page with no destination given', async () => {
    // The sites list and the host switcher pass none and must be unaffected.
    render(<CreateHostDialog open onClose={() => undefined} />)
    await createSite()
    expect(mockPush).toHaveBeenCalledWith(
      '/smoke-test-0831/hosts/smoke-site-0831/setup',
    )
  })
})
