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
 * AGL-3742 · a first site from the empty console lands on its start, not on
 * the sites list. AGL-3761 · and its workspace is made first, the site only
 * once the start has been answered.
 *
 * The create used to make the account's one workspace, and the home page's
 * single-org redirect then raced the dialog's landing to `/{slug}/hosts`. On
 * the auth host that redirect is a hard navigation, so the dialog's landing
 * never ran at all: 2026-10-12 15:38Z, a Google sign-up that finished on
 * auth.aglyn.com created its site and only ever saw the sites list.
 *
 * Since AGL-3761 "Create site" there makes the WORKSPACE (the start is asked
 * inside one) and lands in its sites with "Create site" open. The race is the
 * same race, and held the same way.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockHardNavigate = jest.fn()
let mockLanding: (url: string) => string = (url) => url

// The reader's workspace pins (AGL-3762) are a read of their own account
// document; none of these assertions is about them.
jest.mock('../hooks/use-pinned-orgs', () => ({
  __esModule: true,
  usePinnedOrgs: () => ({ pinned: [], ready: true, toggle: () => undefined }),
  default: () => ({ pinned: [], ready: true, toggle: () => undefined }),
}))
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
  useUser: () => ({ data: { uid: 'u-1', displayName: 'New Owner' } }),
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
  hardNavigate: (url: string) => mockHardNavigate(url),
}))
jest.mock('../utils/console-landing', () => ({
  currentConsoleLandingHref: (url: string) => mockLanding(url),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
/** The workspace the first site's "Create site" makes, and when it settles. */
let mockWorkspace: Promise<{ slug: string } | { error: string }>
const mockCreateWorkspace = jest.fn(() => mockWorkspace)
jest.mock('../utils/first-site-workspace', () => ({
  createFirstSiteWorkspace: (...args: unknown[]) => mockCreateWorkspace(...(args as [])),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))

const OrgJump = require('../app/(app)/(home)/page').default

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const clickCreateSite = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Create site'))
    await Promise.resolve()
  })
  await flush()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLanding = (url) => url
  mockWorkspace = Promise.resolve({ slug: 'new-owner' })
  mockScope = { orgs: [], loading: false, confirmed: true, currentOrg: null }
})

describe('AGL-3761 · the empty console makes the workspace, not the site', () => {
  it('lands in the new workspace’s sites with Create site open', async () => {
    render(<OrgJump />)
    await flush()
    await clickCreateSite()
    expect(mockCreateWorkspace).toHaveBeenCalledTimes(1)
    expect(mockHardNavigate).toHaveBeenCalledWith('/new-owner/hosts?create=site')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('hard-navigates to the console host when it runs on the auth host', async () => {
    mockLanding = (url) => `https://app.aglyn.com${url}`
    render(<OrgJump />)
    await flush()
    await clickCreateSite()
    // A client push of a root-relative path is a 404 on the auth host (AGL-3090).
    expect(mockHardNavigate).toHaveBeenCalledWith(
      'https://app.aglyn.com/new-owner/hosts?create=site',
    )
  })

  it('says why when the workspace could not be made, and stays', async () => {
    mockWorkspace = Promise.resolve({ error: 'Too many new workspaces in a short time' })
    render(<OrgJump />)
    await flush()
    await clickCreateSite()
    expect(screen.getByText('Too many new workspaces in a short time')).toBeTruthy()
    expect(mockHardNavigate).not.toHaveBeenCalled()
    expect(screen.getByText('Create site')).toBeTruthy()
  })
})

describe('AGL-3742 · the home page does not race a first site to the sites list', () => {
  it('holds its single-org redirect while the first site’s workspace is made', async () => {
    let settle!: (value: { slug: string }) => void
    mockWorkspace = new Promise((resolve) => {
      settle = resolve
    })
    const { rerender } = render(<OrgJump />)
    await flush()
    await act(async () => {
      fireEvent.click(screen.getByText('Create site'))
      await Promise.resolve()
    })
    // The workspace now exists, and the membership list says so first.
    mockScope = {
      orgs: [{ $id: 'org-new', slug: 'new-owner' }],
      loading: false,
      confirmed: true,
      currentOrg: null,
    }
    rerender(<OrgJump />)
    await flush()
    // Red before AGL-3742: replaced to /new-owner/hosts over the start.
    expect(mockReplace).not.toHaveBeenCalled()
    await act(async () => {
      settle({ slug: 'new-owner' })
      await Promise.resolve()
    })
    await flush()
    expect(mockHardNavigate).toHaveBeenCalledWith('/new-owner/hosts?create=site')
    expect(mockReplace).not.toHaveBeenCalled()
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
