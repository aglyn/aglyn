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
 * AGL-3742 · a first site created from the empty console lands on its AI
 * start, not on the sites list.
 *
 * The create makes the account's one workspace, and the home page's
 * single-org redirect then raced the dialog's landing to `/{slug}/hosts`. On
 * the auth host that redirect is a hard navigation, so the dialog's landing
 * never ran at all: 2026-10-12 15:38Z, a Google sign-up that finished on
 * auth.aglyn.com created its site and only ever saw the sites list.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockHardNavigate = jest.fn()
let mockLanding: (url: string) => string = (url) => url

/** The `onCreated` the home page hands its create-site dialog. */
let capturedOnCreated: (() => void) | undefined

jest.mock('next/navigation', () => {
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
    useSearchParams: () => new URLSearchParams(),
  }
})

let mockScope: {
  orgs: Array<{ $id: string; slug: string; orgName?: string }>
  loading: boolean
  confirmed: boolean
  currentOrg: { $id: string; slug: string } | null
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
  getDoc: async () => ({ data: () => ({}) }),
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
// The page's copy of the dialog is a probe for the callback it is handed;
// the real component is exercised directly further down.
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  default: (props: { onCreated?: () => void }) => {
    capturedOnCreated = props.onCreated
    return null
  },
}))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockHardNavigate(url),
  hardNavigate: (url: string) => mockHardNavigate(url),
}))
jest.mock('../utils/console-landing', () => ({
  currentConsoleLandingHref: (url: string) => mockLanding(url),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      hostId: 'host-1',
      subdomain: 'royal-styles',
      orgId: 'org-new',
      orgSlug: 'new-owner',
      orgCreated: true,
      guidedStart: true,
    }),
  }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))

const OrgJump = require('../app/(app)/(home)/page').default
const CreateHostDialog = jest.requireActual(
  '../components/create-host-dialog.component',
).default

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const createSite = async () => {
  fireEvent.change(screen.getByLabelText('Site name'), {
    target: { value: 'Royal Styles' },
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
  capturedOnCreated = undefined
  mockLanding = (url) => url
  mockScope = { orgs: [], loading: false, confirmed: true, currentOrg: null }
})

describe('AGL-3742 · the home page does not race a first site to the sites list', () => {
  it('holds its single-org redirect once a site was created from it', async () => {
    const { rerender } = render(<OrgJump />)
    await flush()
    expect(capturedOnCreated).toBeInstanceOf(Function)
    act(() => capturedOnCreated?.())
    // The create made the account's one workspace.
    mockScope = {
      orgs: [{ $id: 'org-new', slug: 'new-owner' }],
      loading: false,
      confirmed: true,
      currentOrg: null,
    }
    rerender(<OrgJump />)
    await flush()
    // Red before the fix: replaced to /new-owner/hosts (or hard-navigated
    // there on the auth host), over the dialog's landing on the site.
    expect(mockReplace).not.toHaveBeenCalled()
    expect(mockHardNavigate).not.toHaveBeenCalled()
  })

  it('still sends a returning one-workspace member to their sites', async () => {
    mockScope = {
      orgs: [{ $id: 'org-1', slug: 'acme' }],
      loading: false,
      confirmed: true,
      currentOrg: null,
    }
    render(<OrgJump />)
    await flush()
    expect(mockReplace).toHaveBeenCalledWith('/acme/hosts')
  })
})

describe('AGL-3742 · the create-site dialog lands on the console host', () => {
  it('tells its parent before it navigates, then pushes on the console host', async () => {
    const order: string[] = []
    mockPush.mockImplementation(() => order.push('push'))
    render(<CreateHostDialog open onClose={() => undefined} onCreated={() => order.push('created')} />)
    await createSite()
    expect(order).toEqual(['created', 'push'])
    expect(mockPush).toHaveBeenCalledWith('/new-owner/hosts/royal-styles?start=site')
    expect(mockHardNavigate).not.toHaveBeenCalled()
  })

  it('hard-navigates to the console host when it runs on the auth host', async () => {
    mockLanding = (url) => `https://app.aglyn.com${url}`
    render(<CreateHostDialog open onClose={() => undefined} />)
    await createSite()
    // Red before the fix: a client push of a root-relative path, which the
    // auth host answers with a 404 (AGL-3090).
    expect(mockHardNavigate).toHaveBeenCalledWith(
      'https://app.aglyn.com/new-owner/hosts/royal-styles?start=site',
    )
    expect(mockPush).not.toHaveBeenCalled()
  })
})
