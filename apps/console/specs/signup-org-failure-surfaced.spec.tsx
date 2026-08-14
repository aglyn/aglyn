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
 * AGL-1523, the surfacing half: a failed signup-time org creation must not
 * be swallowed into the workspace picker.
 *
 * The first production signup typed "E2E Smoke 2026-08-13" into the signup
 * form, the create was refused, `provisionSignUpOrg` logged to a console
 * nobody reads, and the picker greeted them as if the field had never
 * existed. These tests pin the contract: the failure marker written at
 * signup is read by the picker, said OUT LOUD, offered back through the
 * create dialog with the typed name, and shown exactly once.
 */

import { render, screen } from '@testing-library/react'
import React from 'react'
import {
  consumeSignUpOrgFailure,
  markSignUpOrgFailure,
} from '../utils/signup-org-failure'

const mockReplace = jest.fn()

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
    useSearchParams: () => new URLSearchParams(),
  }
})

// The jump page asks the account whether it is carrying a plan intent across
// the verification wall (AGL-1535); this spec is about the AGL-1523 notice,
// so the read answers "nothing remembered" and gets out of the way.
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ data: () => ({}) }),
  setDoc: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ orgs: [], loading: false, confirmed: true }),
  useOrgSlug: () => '',
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
/** Captures the props the picker hands the dialog. */
const dialogProps: Array<Record<string, unknown>> = []
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    dialogProps.push(props)
    return null
  },
}))
jest.mock('../components/org-invites-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OrgJump = require('../app/(app)/(home)/page').default

beforeEach(() => {
  window.sessionStorage.clear()
  dialogProps.length = 0
  jest.clearAllMocks()
})

describe('the marker itself (utils/signup-org-failure)', () => {
  it('round-trips, and consuming clears it', () => {
    markSignUpOrgFailure({ name: 'E2E Smoke 2026-08-13', error: 'nope' })
    expect(consumeSignUpOrgFailure()).toEqual({
      name: 'E2E Smoke 2026-08-13',
      error: 'nope',
    })
    // Once. A stale notice on every later picker visit would be a new lie.
    expect(consumeSignUpOrgFailure()).toBeNull()
  })

  it('rejects garbage rather than rendering it', () => {
    window.sessionStorage.setItem('aglyn:signup-org-create-failed', '{"junk":1}')
    expect(consumeSignUpOrgFailure()).toBeNull()
    window.sessionStorage.setItem('aglyn:signup-org-create-failed', 'not json')
    expect(consumeSignUpOrgFailure()).toBeNull()
  })
})

describe('AGL-1523 · the picker says what happened to the typed workspace', () => {
  it('shows the failure, the typed name, and the server reason', () => {
    markSignUpOrgFailure({
      name: 'E2E Smoke 2026-08-13',
      error: 'That workspace URL is taken',
    })
    render(<OrgJump />)
    // Red before the fix: the picker rendered its ordinary empty state and
    // the typed name was gone without a trace.
    expect(
      screen.getByText(/couldn’t create your workspace/),
    ).toBeTruthy()
    expect(screen.getByText(/E2E Smoke 2026-08-13/)).toBeTruthy()
    expect(screen.getByText(/That workspace URL is taken/)).toBeTruthy()
  })

  it('offers the typed name back through the create dialog', () => {
    markSignUpOrgFailure({ name: 'E2E Smoke 2026-08-13', error: null })
    render(<OrgJump />)
    expect(
      dialogProps.some(
        (props) => props['initialName'] === 'E2E Smoke 2026-08-13',
      ),
    ).toBe(true)
  })

  it('renders the ordinary picker when nothing failed', () => {
    render(<OrgJump />)
    expect(screen.queryByText(/couldn’t create your workspace/)).toBeNull()
    expect(screen.getByText('Create your first site')).toBeTruthy()
  })
})
