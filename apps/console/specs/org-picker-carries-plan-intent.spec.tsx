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
 * The workspace picker has to CARRY the plan intent, not just decline to
 * redirect with it (AGL-1117).
 *
 * `/signup?plan=starter&interval=month` on an already-signed-in session lands
 * on `/?plan=starter&interval=month`, and a member of two or more workspaces
 * is shown the picker rather than redirected — which is correct, because
 * AGL-1149 established that a redirect on a list this page cannot yet vouch
 * for is a navigation the user has to undo. But every way OUT of the picker
 * built a bare `/{slug}/hosts`: the "Open" links and the workspace the visitor
 * creates from it alike. The plan was on the URL right up to the click that
 * dropped it, and the buyer landed in a site list with billing to go find.
 *
 * A picker link is not a redirect, so the coverage is about the href — the
 * choice still belongs to the member, and what it must not do is discard what
 * the visit is for on the way through.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockFirestore = {}
const mockEnqueueSnackbar = jest.fn()
let mockStoredUserDoc: Record<string, unknown> = {}
let mockSearchParams = new URLSearchParams()

/** The `destination` builder the jump page hands the create-org dialog. */
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
}

jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => mockScope,
  useOrgSlug: () => '',
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ data: () => mockStoredUserDoc }),
  setDoc: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/org-invites-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
// The page's copy of the dialog is a probe for the destination it is handed;
// the real component is exercised directly further down.
jest.mock('../components/create-org-dialog.component', () => ({
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
    json: async () => ({ orgId: 'org-new', slug: 'smoke-test-0831' }),
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
const CreateOrgDialog = jest.requireActual(
  '../components/create-org-dialog.component',
).default

const TWO_ORGS = [
  { $id: 'org-1', slug: 'first-org', orgName: 'First Org' },
  { $id: 'org-2', slug: 'second-org', orgName: 'Second Org' },
]

/** Let the account's remembered-intent read settle before asserting. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const pickerHrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('a[href]')).map((node) =>
    node.getAttribute('href'),
  )

beforeEach(() => {
  jest.clearAllMocks()
  capturedDestination = undefined
  mockStoredUserDoc = {}
  mockSearchParams = new URLSearchParams()
  mockScope = { orgs: TWO_ORGS, loading: false, confirmed: true }
})

describe('AGL-1117 · the multi-org picker carries the plan intent', () => {
  it('points every workspace link at billing when the URL states a plan', async () => {
    mockSearchParams = new URLSearchParams('plan=starter&interval=month')
    const { container } = render(<OrgJump />)
    await flush()
    // Red before the fix: both hrefs were `/{slug}/hosts` and the plan the
    // visitor clicked on /pricing died at the next click.
    expect(pickerHrefs(container)).toEqual([
      '/first-org/billing?plan=starter&interval=month',
      '/second-org/billing?plan=starter&interval=month',
    ])
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('carries the intent the ACCOUNT remembered, with nothing on the URL', async () => {
    // The post-verification arrival: `/verify-email` hands back a bare `/`,
    // so the picker's links have only the stored intent to work from and must
    // resolve it exactly as the single-org redirect does (AGL-1535).
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now(),
      },
    }
    const { container } = render(<OrgJump />)
    await flush()
    expect(pickerHrefs(container)).toEqual([
      '/first-org/billing?plan=pro&interval=year',
      '/second-org/billing?plan=pro&interval=year',
    ])
  })

  it('does not restate an interval the CTA never stated', async () => {
    // The /pricing scale strip quotes monthly and annual side by side and
    // commits to neither; re-serializing `&interval=month` here would tell the
    // billing toggle the visitor chose monthly (AGL-1535).
    mockSearchParams = new URLSearchParams('plan=scale')
    const { container } = render(<OrgJump />)
    await flush()
    expect(pickerHrefs(container)).toEqual([
      '/first-org/billing?plan=scale',
      '/second-org/billing?plan=scale',
    ])
  })

  it('sends an enterprise CTA to support rather than a checkout', async () => {
    mockSearchParams = new URLSearchParams('plan=enterprise')
    const { container } = render(<OrgJump />)
    await flush()
    expect(pickerHrefs(container)).toEqual([
      '/first-org/support?topic=enterprise',
      '/second-org/support?topic=enterprise',
    ])
  })

  it('leaves the ordinary picker on bare site links', async () => {
    const { container } = render(<OrgJump />)
    await flush()
    expect(pickerHrefs(container)).toEqual([
      '/first-org/hosts',
      '/second-org/hosts',
    ])
  })

  it('names the plan the choice is for', async () => {
    mockSearchParams = new URLSearchParams('plan=starter&interval=month')
    render(<OrgJump />)
    await flush()
    expect(screen.getByText(/pick the one you want Starter on/)).toBeTruthy()
  })

  it('says nothing about a plan when there is no intent', async () => {
    render(<OrgJump />)
    await flush()
    expect(screen.getByText(/pick one to manage/)).toBeTruthy()
  })
})

describe('AGL-1117 · a workspace created from the picker keeps the intent', () => {
  it('hands the dialog a destination built from the intent', async () => {
    mockSearchParams = new URLSearchParams('plan=business&interval=year')
    render(<OrgJump />)
    await flush()
    // A workspace made DURING a buy-intent visit is the one most likely to be
    // billed — the visitor came to buy and made a place to put it.
    expect(capturedDestination?.('smoke-test-0831')).toBe(
      '/smoke-test-0831/billing?plan=business&interval=year',
    )
  })

  it('hands down the plain site route when there is no intent', async () => {
    render(<OrgJump />)
    await flush()
    expect(capturedDestination?.('smoke-test-0831')).toBe(
      '/smoke-test-0831/hosts',
    )
  })

  it('navigates the new workspace to the destination it was given', async () => {
    render(
      <CreateOrgDialog
        open
        onClose={() => undefined}
        destination={(orgSlug: string) =>
          `/${orgSlug}/billing?plan=business&interval=year`
        }
      />,
    )
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Smoke Test 0831' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Create'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    // Red before the fix: the create landed on `/smoke-test-0831/hosts` with
    // an empty query string.
    expect(mockPush).toHaveBeenCalledWith(
      '/smoke-test-0831/billing?plan=business&interval=year',
    )
  })

  it('still lands on the new workspace sites with no destination given', async () => {
    // The org switcher passes none and must be unaffected.
    render(<CreateOrgDialog open onClose={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Smoke Test 0831' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Create'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockPush).toHaveBeenCalledWith('/smoke-test-0831/hosts')
  })
})
