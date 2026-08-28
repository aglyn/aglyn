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
 * The security-alert email's link still lands on Security (AGL-693).
 *
 * Manage Account's six panels became routes, and the general rule for that
 * conversion is that `?tab=` needs no compatibility map: the parameter existed
 * so a panel could be linked to, a route IS the link, and no customer holds an
 * old console URL yet.
 *
 * This page is the exception, and the exception is a sent email.
 * `security-alerts.ts` mails a "Review account security" button on every
 * new-device sign-in, and it has been pointing at
 * `/manage/user?tab=security`. Those messages are in inboxes and cannot be
 * edited. The person opening one has just been told a stranger signed into
 * their account, and Recent sign-ins — with the button that revokes the
 * device — is the surface the whole message is about. Landing them on the
 * default section, or on a 404, is the failure this file exists to make
 * impossible to reintroduce quietly.
 *
 * The other five ids ride along because a map that forwards the emailed link
 * and silently drops its neighbours is a trap for whoever links to a section
 * next.
 */

import { act, render } from '@testing-library/react'
import React from 'react'
import {
  ACCOUNT_SECTIONS,
  accountSectionHrefForTab,
} from '../constants/account-sections'
import { buildRoute, Route } from '../constants/route-links'

const mockReplace = jest.fn()
/** Swapped per test — the query the reader arrived with. */
let mockSearch = new URLSearchParams()

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
    usePathname: () => '/manage/user',
    useSearchParams: () => mockSearch,
  }
})

/** Swapped per test to stand in for the account's sign-in methods. */
let mockUser: { providerData: Array<{ providerId: string }>; tenantId: string | null }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))

// The section's own card is not what is under test here, and left real it
// opens Firestore listens for passkeys and recent sign-ins.
jest.mock('../components/account/account-security-card.component', () => ({
  __esModule: true,
  default: () => <div data-testid="security-card" />,
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

/** What the rail was handed, captured instead of drawn. */
let railSections: Array<{ href: string; label: string; visible?: boolean }> = []
jest.mock('@aglyn/shared-ui-next/components/hub-tabs', () => ({
  HubSections: (props: {
    sections: Array<{ href: string; label: string; visible?: boolean }>
    children: React.ReactNode
  }) => {
    railSections = props.sections
    return <div>{props.children}</div>
  },
}))

const ManageUserIndex = require('../app/(app)/manage/user/page').default
const AccountSecurityPage =
  require('../app/(app)/manage/user/(sections)/security/page').default
const AccountSectionsLayout =
  require('../app/(app)/manage/user/(sections)/layout').default

/** A self-serve account: project pool, password, so every section applies. */
const PASSWORD_ACCOUNT = {
  providerData: [{ providerId: 'password' }],
  tenantId: null,
}
/**
 * The account Security does not apply to: SSO-governed (it lives in an org's
 * GCIP tenant pool) and with no password. Passkeys are project-pool only and
 * its IdP owns the credentials, so the section has nothing to show it.
 */
const SSO_ONLY_ACCOUNT = {
  providerData: [{ providerId: 'saml.acme' }],
  tenantId: 'aglyn-org-y5v14',
}

const arriveAt = async (Page: () => React.ReactElement | null, query: string) => {
  mockSearch = new URLSearchParams(query)
  await act(async () => {
    render(<Page />)
  })
}

describe('the account sections keep the links people already hold (AGL-693)', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    railSections = []
    mockUser = PASSWORD_ACCOUNT
  })

  it('THE REGRESSION: the emailed ?tab=security link lands on Security', async () => {
    // The exact URL `security-alerts.ts` has been mailing.
    await arriveAt(ManageUserIndex, '?tab=security')
    expect(mockReplace).toHaveBeenCalledWith('/manage/user/security')
  })

  it('sends the alert email to that same URL going forward', async () => {
    // The two halves of the promise: the old link is forwarded, and the new
    // link is what a message composed today carries. `security-alerts.spec.ts`
    // asserts the send site itself emits this path.
    expect(buildRoute(Route.MANAGE_USER_SECURITY)).toBe('/manage/user/security')
    expect(accountSectionHrefForTab('security')).toBe('/manage/user/security')
  })

  it('forwards every id the panels carried, not just the emailed one', async () => {
    const expected = {
      account: '/manage/user/account',
      emails: '/manage/user/emails',
      profile: '/manage/user/profile',
      basic: '/manage/user/basic',
      security: '/manage/user/security',
      close: '/manage/user/close',
    }
    // Both directions. The literal map is the deep link a reader may hold;
    // the section list is what the rail draws — an id in one and not the other
    // is a section listed under a name nothing forwards to.
    expect(
      Object.fromEntries(
        ACCOUNT_SECTIONS.map((section) => [section.id, section.href]),
      ),
    ).toEqual(expected)
    for (const [id, href] of Object.entries(expected)) {
      mockReplace.mockClear()
      await arriveAt(ManageUserIndex, `?tab=${id}`)
      expect(mockReplace).toHaveBeenCalledWith(href)
    }
  })

  it('lands a retired or mistyped id on the account, not on nothing', async () => {
    await arriveAt(ManageUserIndex, '?tab=notasection')
    expect(mockReplace).toHaveBeenCalledWith('/manage/user/account')
  })

  it('opens the account when no section is named', async () => {
    await arriveAt(ManageUserIndex, '')
    expect(mockReplace).toHaveBeenCalledWith('/manage/user/account')
  })
})

describe('Security is a section only where it applies (AGL-662)', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    railSections = []
  })

  it('renders for an account with a password', async () => {
    mockUser = PASSWORD_ACCOUNT
    const { queryByTestId } = render(<AccountSecurityPage />)
    expect(queryByTestId('security-card')).not.toBeNull()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('redirects an SSO-governed account with no password away from it', async () => {
    // Reachable by typing the URL, by a bookmark, and by the emailed link
    // above — so the section has to answer for itself rather than render a
    // heading with nothing under it.
    mockUser = SSO_ONLY_ACCOUNT
    const { queryByTestId } = render(<AccountSecurityPage />)
    expect(queryByTestId('security-card')).toBeNull()
    expect(mockReplace).toHaveBeenCalledWith('/manage/user/account')
  })

  it('offers Security in the rail for an account that has it', () => {
    mockUser = PASSWORD_ACCOUNT
    render(<AccountSectionsLayout>{null}</AccountSectionsLayout>)
    const security = railSections.find((item) => item.label === 'Security')
    expect(security?.visible).not.toBe(false)
    // The rail is otherwise unconditional — nothing else on this page is
    // gated, and a `visible` that crept onto another section would hide it
    // from every account.
    for (const item of railSections) {
      if (item.label === 'Security') continue
      expect(item.visible).toBeUndefined()
    }
  })

  it('does not offer Security in the rail for an account without it', () => {
    mockUser = SSO_ONLY_ACCOUNT
    render(<AccountSectionsLayout>{null}</AccountSectionsLayout>)
    expect(
      railSections.find((item) => item.label === 'Security')?.visible,
    ).toBe(false)
    // Close account stays last and separate, whichever sections precede it —
    // an irreversible control must not sit one mis-click below a password
    // field.
    expect(railSections[railSections.length - 1].label).toBe('Close account')
  })
})
