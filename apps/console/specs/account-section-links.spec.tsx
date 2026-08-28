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
 * The security-alert email's button lands on Security (AGL-693).
 *
 * Manage Account's six panels are routes, and a route IS the link — the
 * `?tab=` parameter that let a panel be linked to is gone, along with the
 * compatibility map that forwarded it.
 *
 * What survives that removal is the risk the map was protecting against, and
 * it never depended on the parameter: `security-alerts.ts` mails a "Review
 * account security" button on every new-device sign-in, and the person opening
 * one has just been told a stranger signed into their account. Recent sign-ins
 * — with the button that revokes the device — is the surface the whole message
 * is about. A hand-written path in that email is what goes dead without
 * anything failing to compile, so this asserts the route it names is a real
 * section and that the section list and the route table still agree.
 */

import { act, render } from '@testing-library/react'
import React from 'react'
import { ACCOUNT_SECTIONS } from '../constants/account-sections'
import { buildRoute, Route } from '../constants/route-links'

const mockReplace = jest.fn()
/** Where the server index redirected. */
const mockRedirect = jest.fn()
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
    // The index is a SERVER component now (AGL-693) and answers with an HTTP
    // redirect instead of a client navigation. `redirect()` throws, and the
    // throw is part of the behavior — a stub that only recorded would let the
    // page carry on past a redirect it was supposed to stop at.
    redirect: (url: string) => {
      mockRedirect(url)
      throw new Error('NEXT_REDIRECT')
    },
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
/*
 * Both exports the layout takes from this module, not just the one this suite
 * asserts on. A partial mock returns `undefined` for the rest, and the layout
 * calling it renders as "is not a function" — which points at the layout
 * rather than at the mock, and only appears the day the layout imports one
 * more thing. `useActiveSection` feeds the breadcrumb, which this file does
 * not test, so a null answer is the honest stub.
 */
jest.mock('@aglyn/shared-ui-next/components/hub-tabs', () => ({
  HubSections: (props: {
    sections: Array<{ href: string; label: string; visible?: boolean }>
    children: React.ReactNode
  }) => {
    railSections = props.sections
    return <div>{props.children}</div>
  },
  useActiveSection: () => null,
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

describe('the account sections and the links that name them (AGL-693)', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    mockRedirect.mockClear()
    railSections = []
    mockUser = PASSWORD_ACCOUNT
  })

  it('THE REGRESSION: the alert email names a route that exists', async () => {
    /*
     * `security-alerts.ts` builds its button from `Route.MANAGE_USER_SECURITY`
     * rather than a literal, and `security-alerts.spec.ts` asserts the send
     * site emits this path. What this adds is the other half: that the path is
     * a section the rail actually offers, so a renamed segment fails here
     * instead of in somebody's inbox.
     */
    expect(buildRoute(Route.MANAGE_USER_SECURITY)).toBe('/manage/user/security')
    expect(ACCOUNT_SECTIONS.map((section) => section.href)).toContain(
      '/manage/user/security',
    )
  })

  it('lists every section under the segment its route builds', async () => {
    // The rail and the route table are two spellings of the same six paths.
    // One drifting from the other is a section listed under a name that opens
    // something else.
    expect(
      Object.fromEntries(
        ACCOUNT_SECTIONS.map((section) => [section.id, section.href]),
      ),
    ).toEqual({
      account: '/manage/user/account',
      emails: '/manage/user/emails',
      profile: '/manage/user/profile',
      basic: '/manage/user/basic',
      security: '/manage/user/security',
      close: '/manage/user/close',
    })
  })

  /**
   * The index is a SERVER component, so it is CALLED rather than rendered
   * (AGL-693).
   *
   * That is the assertion, not an inconvenience: rendering it is what the old
   * client version required — ship a bundle, hydrate, resolve, navigate — and
   * every step of that was a blank main area. An async server component cannot
   * be rendered into jsdom at all, which is why this reads as a call.
   */
  const arriveAtIndex = async (query: Record<string, string> = {}) => {
    await expect(
      (ManageUserIndex as unknown as (props: {
        searchParams: Promise<Record<string, string>>
      }) => Promise<never>)({ searchParams: Promise.resolve(query) }),
    ).rejects.toThrow('NEXT_REDIRECT')
  }

  it('opens the account from the bare index', async () => {
    await arriveAtIndex()
    expect(mockRedirect).toHaveBeenCalledWith('/manage/user/account')
  })

  it('still opens the account when a stale query rides along', async () => {
    // THE CONTROL for the removal: a leftover `?tab=` is now just a query
    // string the index ignores — it must not be read, and it must not be
    // dropped either, because a third party's marker rides the same slot.
    await arriveAtIndex({ tab: 'security' })
    expect(mockRedirect).toHaveBeenCalledWith(
      '/manage/user/account?tab=security',
    )
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
