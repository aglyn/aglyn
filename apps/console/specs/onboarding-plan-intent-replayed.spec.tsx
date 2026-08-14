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
 * AGL-1535, the read half: the org jump is where a freshly verified account
 * lands, and it is the last chance to honour the plan the visitor picked.
 *
 * `/verify-email`'s `goToApp()` hard-navigates to a bare `/` — no plan params,
 * by construction — so the single-org redirect used to send someone who came
 * to buy Pro to their sites instead. These tests pin the replay off the
 * account's own record, and that it happens exactly once.
 */

import { act, render } from '@testing-library/react'
import React from 'react'

const mockReplace = jest.fn()
const mockSetDoc = jest.fn(async () => undefined)
const mockFirestore = {}
const mockGetDoc = jest.fn(async () => ({ data: () => mockStoredUserDoc }))
let mockStoredUserDoc: Record<string, unknown> = {}
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => {
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
    useSearchParams: () => mockSearchParams,
  }
})
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => mockGetDoc(...(args as [])),
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { uid: 'u-new' } }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    orgs: [{ $id: 'org-1', slug: 'acme', orgName: 'Acme' }],
    loading: false,
    confirmed: true,
  }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))
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

/** Render and let the account's intent read settle before asserting. */
const jump = async () => {
  await act(async () => {
    render(<OrgJump />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredUserDoc = {}
  mockSearchParams = new URLSearchParams()
  window.sessionStorage.clear()
  mockGetDoc.mockImplementation(async () => ({ data: () => mockStoredUserDoc }))
  mockSetDoc.mockImplementation(async () => undefined)
})

describe('AGL-1535 · the org jump honours the intent that survived verification', () => {
  it('lands on billing with the remembered plan when the URL carries nothing', async () => {
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now(),
      },
    }
    await jump()
    // Red before the fix: the jump replaced to the org's sites and the plan
    // the person came to buy was gone.
    expect(mockReplace).toHaveBeenCalledWith('/acme/billing?plan=pro&interval=year')
  })

  it('consumes it — a second visit jumps to the sites as usual', async () => {
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now(),
      },
    }
    await jump()
    // The clear is the write; the picker must not re-upsell forever.
    expect(
      mockSetDoc.mock.calls.some(
        (call: any) => call[1]?.onboardingPlanIntent === null,
      ),
    ).toBe(true)
  })

  it('jumps to the sites when nothing was remembered', async () => {
    await jump()
    expect(mockReplace).toHaveBeenCalledWith('/acme/hosts')
  })

  it('lets an intent on the URL outrank the remembered one', async () => {
    // What this visit says beats what a past one did.
    mockSearchParams = new URLSearchParams('plan=business&interval=month')
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now(),
      },
    }
    await jump()
    expect(mockReplace).toHaveBeenCalledWith(
      '/acme/billing?plan=business&interval=month',
    )
  })

  it('does not jump to the sites before the account has answered', async () => {
    // A redirect is not a render you can correct a beat later — firing the
    // ordinary jump while the read is in flight drops the intent for good.
    let release: (value: unknown) => void = () => undefined
    const pending = new Promise((resolve) => (release = resolve))
    mockGetDoc.mockImplementation(async () => {
      await pending
      return { data: () => ({}) }
    })
    render(<OrgJump />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockReplace).not.toHaveBeenCalled()
    await act(async () => {
      release(null)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockReplace).toHaveBeenCalledWith('/acme/hosts')
  })
})
