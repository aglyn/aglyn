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
 * SENDING ON THE SHARED DOMAIN IS SAID PLAINLY, NOT HIDDEN.
 *
 * Most workspaces will never verify a domain, and for them the honest answer
 * is that their mail leaves on an Aglyn address. That is not an error state
 * and it must not read like one — but it is also not nothing, because the
 * consequence is real: the site's delivery reputation is pooled with every
 * other workspace's rather than being its own.
 *
 * Every major vendor does exactly this. HubSpot sends unverified from-
 * addresses on a HubSpot-managed domain. The failure mode worth testing
 * against is the opposite of alarm — a surface that quietly says "Sending as
 * hello@…" and never mentions whose domain that is, leaving a merchant to
 * discover it in a recipient's inbox.
 */

import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SendingDomainsCard } from './sending-domains-card'

/*
 * What the section actually hands every card: the Emails base, with no
 * section segment on it. A fixture carrying `/sending` already made
 * `${basePath}/${domain}` look right, which is how a card that navigated to
 * `/emails/{domain}` — a route that renders nothing — passed its own tests.
 */
const BASE_PATH = '/acme/hosts/site/emails'

/** Every path this render navigated to, in order. */
const pushed: string[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (path: string) => {
      pushed.push(path)
    },
    replace: () => undefined,
  }),
  usePathname: () => `${BASE_PATH}/sending`,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  /*
   * The header ACTION is rendered as well as the children. The card's primary
   * control lives there, so a double that dropped it would make every
   * assertion about who may add a domain pass by rendering nothing.
   */
  CardDisplay: ({ children, HeaderProps }: any) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? <div>{children}</div> : null),
}))

/** What the sending-identity route reports, staged per case. */
let identity: Record<string, unknown> = {}

beforeEach(() => {
  pushed.length = 0
  identity = {
    orgId: 'org-1',
    selected: 'platform',
    localPart: 'hello',
    identity: 'Sending as noreply@aglyn.com on the shared platform domain.',
    identitySource: 'platform',
    refusal: null,
    options: [
      {
        value: 'platform',
        from: 'noreply@aglyn.com',
        selectable: true,
        status: 'platform',
      },
    ],
    domains: [],
    canManage: true,
    entitled: true,
  }
  ;(global as any).fetch = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes('sending-identity') ? identity : { domains: [] },
  }))
})

const mount = async () => {
  render(<SendingDomainsCard hostId="host-1" basePath={BASE_PATH} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('a workspace with no verified domain', () => {
  it('names the address its mail actually leaves on', async () => {
    await mount()

    expect(screen.getByText('This site sends as')).toBeTruthy()
    expect(screen.getByText(/noreply@aglyn\.com/)).toBeTruthy()
  })

  it('says what using the shared domain costs', async () => {
    await mount()

    // The half a surface is tempted to leave out. "Sending as noreply@…" is
    // true and tells a merchant nothing about whose reputation they are
    // borrowing, or that their recipients will not see their own brand.
    expect(screen.getByText(/reputation is shared with other workspaces/i)).toBeTruthy()
  })

  it('does not present it as a failure', async () => {
    await mount()

    // It is the ordinary state of most workspaces, not a broken one — and a
    // surface that alarms about it teaches people to ignore the alarm that
    // matters, which is the refusal below.
    expect(screen.queryByText('This site cannot send')).toBeNull()
  })
})

describe('a workspace whose selected domain is unfinished', () => {
  it('says the site cannot send, and why', async () => {
    /*
     * The control for the case above, and the state that IS an alarm. The two
     * have to look different: one is "this works and here is the trade-off",
     * the other is "nothing will go out until you do something".
     */
    identity = {
      ...identity,
      selected: 'acme.com',
      identity: 'Blocked: acme.com is not verified.',
      identitySource: null,
      refusal: {
        code: 'domain-unverified',
        domain: 'acme.com',
        message:
          'acme.com has not been verified yet, so this send was refused ' +
          'rather than sent from a different address.',
        missing: ['TXT:send.acme.com'],
      },
    }

    await mount()

    expect(screen.getByText('This site cannot send')).toBeTruthy()
    expect(screen.getByText(/acme\.com has not been verified/)).toBeTruthy()
    // And it must NOT also claim the site is happily sending on the shared
    // domain, which is exactly the silent fallback the feature forbids.
    expect(screen.queryByText('This site sends as')).toBeNull()
  })
})

describe('what a reader may do is what the server says they may do', () => {
  it('offers Add domain to an org admin on the right plan', async () => {
    await mount()

    expect(screen.getByText('Add domain')).toBeTruthy()
  })

  it('hides Add domain from somebody who cannot manage, and says so', async () => {
    identity = { ...identity, canManage: false }

    await mount()

    expect(screen.queryByText('Add domain')).toBeNull()
    expect(screen.getByText(/needs the organization admin role/i)).toBeTruthy()
  })

  it('explains the plan gate rather than offering an action that 403s', async () => {
    identity = { ...identity, entitled: false }

    await mount()

    expect(screen.getByText(/part of the Agency plan/i)).toBeTruthy()
  })
})

/*
 * A DOMAIN'S OWN PAGE IS REACHED AT `/emails/sending/{domain}`.
 *
 * `/emails/{domain}` resolves to no section and renders an empty page. That
 * is the worst possible landing for the two navigations below, because both
 * happen at the moment the reader needs the DNS records: right after adding
 * the domain, and on clicking the row that says the records are outstanding.
 */
describe('navigating to one domain', () => {
  it('sends a row click to the domain page under the sending section', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'requested', records: [] },
    ]
    await mount()
    const row = screen.getByText('acme.com').closest('tr') as HTMLElement
    await act(async () => {
      row.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(pushed).toEqual([`${BASE_PATH}/sending/acme.com`])
  })

  it('THE CONTROL: the section segment is not already in the base', () => {
    // Without this, a base that ended in `/sending` would make the assertion
    // above pass against the very bug it exists to catch.
    expect(BASE_PATH.endsWith('/sending')).toBe(false)
  })
})
