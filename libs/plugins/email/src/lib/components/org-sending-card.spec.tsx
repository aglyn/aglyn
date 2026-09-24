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
 *
 * @jest-environment jsdom
 */

/**
 * SENDING, OVER THE ORGANIZATION.
 *
 * Every site's identity is read through the route its own Sending section
 * reads — once per site on a page — and the organization's domains come
 * back on those answers, so there is no second read for them and an editor,
 * whom the domains route refuses, still sees the table. What a site sends as
 * is that site's choice, so choosing it from here always names a site.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Every path this render navigated to, in order. */
const pushed: string[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (path: string) => {
      pushed.push(path)
    },
    replace: () => undefined,
  }),
  usePathname: () => '/acme/emails/sending',
}))
jest.mock(
  '@aglyn/tenant-feature-instance/hooks/firebase/firebase-services',
  () => ({
    useUser: () => jest.requireMock('@aglyn/tenant-feature-instance').useUser(),
  }),
)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  useOrgDataScope: () => ({
    scope: ['orgs', 'org-1'],
    orgId: 'org-1',
    ready: true,
  }),
}))
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/** Every confirmation the page asked, so its wording can be read. */
const confirmed: Array<Record<string, unknown>> = []

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: any) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  AppLink: ({ href, children }: any) => <a href={href}>{children}</a>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useConfirmationContext: () => ({
    confirm: (options: Record<string, unknown>) => {
      confirmed.push(options)
      return Promise.resolve(undefined)
    },
  }),
}))
// The row overflow, flattened to its items — see `sending-domains-card.spec`.
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: ({ items }: { items: any[] }) => (
    <div>
      {items.map((item) =>
        item.href ? (
          <a key={item.key} href={item.href}>
            {item.label}
          </a>
        ) : (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            title={item.disabledReason}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  ),
}))
jest.mock(
  '@aglyn/shared-ui-jsx/components/navigation-drawer.component',
  () => ({
    NavigationDrawerComponent: ({
      open,
      children,
    }: {
      open: boolean
      children: ReactNode
    }) => (open ? <div>{children}</div> : null),
  }),
)

/** The props the sender drawer was last opened with, or null. */
let drawerProps: Record<string, any> | null = null
jest.mock('./sending-sender-drawer', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    drawerProps = props
    return <div>{'the sender drawer'}</div>
  },
}))

import { EmailOrgMountProvider } from './email-org-mount'
import { OrgSendingCard } from './org-sending-card'

/** What the identity route answers for each site, staged per case. */
let identities: Record<string, Record<string, unknown>> = {}
/** Every request, as `METHOD path?query` and its body. */
const requests: Array<{ line: string; body?: Record<string, unknown> }> = []

const baseIdentity = (overrides: Record<string, unknown>) => ({
  orgId: 'org-1',
  selected: '',
  platformDomain: '',
  customDomainPlan: 'Pro',
  dedicatedDomainPlan: 'Pro',
  localPart: 'hello',
  identity: 'Sending as notifications@shared1.mail.aglyn.app',
  identitySource: 'shared',
  refusal: null,
  options: [],
  senders: [
    {
      id: 'default',
      localPart: 'hello',
      fromName: 'Acme',
      replyTo: null,
      isDefault: true,
      from: 'notifications@shared1.mail.aglyn.app',
    },
  ],
  domains: [
    {
      domain: 'acme.com',
      status: 'verified',
      verifiedAtMs: 1,
      lastCheckedAtMs: 1,
    },
  ],
  canManage: true,
  entitled: true,
  ...overrides,
})

const SITES = [
  { id: 'host-1', name: 'Store', subdomain: 'store' },
  { id: 'host-2', name: 'Blog', subdomain: 'blog' },
]

beforeEach(() => {
  pushed.length = 0
  requests.length = 0
  confirmed.length = 0
  drawerProps = null
  window.sessionStorage.clear()
  identities = {
    'host-1': baseIdentity({
      selected: 'acme.com',
      identity: 'Sending as hello@acme.com',
      identitySource: 'custom',
    }),
    'host-2': baseIdentity({}),
  }
  ;(global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    requests.push({ line: `${init?.method ?? 'GET'} ${url}`, body })
    const hostId = new URL(
      String(url),
      'https://console.test',
    ).searchParams.get('hostId')
    const answer =
      init?.method === 'GET' && String(url).includes('sending-identity')
        ? identities[String(hostId)]
        : { from: 'hello@acme.com', verified: true }
    return {
      ok: Boolean(answer),
      status: answer ? 200 : 403,
      json: async () => answer ?? { error: 'Not a site admin or editor' },
    }
  })
})

async function mount(hosts: typeof SITES = SITES) {
  render(
    (
      <EmailOrgMountProvider
        mount={{
          orgId: 'org-1',
          orgSlug: 'acme',
          hosts,
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
        basePath="/acme/emails"
      >
        <OrgSendingCard basePath="/acme/emails" />
      </EmailOrgMountProvider>
    ) as ReactNode as never,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const identityReads = () =>
  requests.filter((request) =>
    request.line.startsWith('GET /api/email/sending-identity'),
  )

describe('every site, read through its own route', () => {
  it('asks each site once, and names what it sends as', async () => {
    await mount()

    expect(identityReads().map((request) => request.line)).toEqual([
      // By name, so a page boundary falls somewhere predictable.
      'GET /api/email/sending-identity?hostId=host-2',
      'GET /api/email/sending-identity?hostId=host-1',
    ])
    expect(screen.getByText('Sending as hello@acme.com')).toBeTruthy()
    expect(screen.getByText('Own domain')).toBeTruthy()
    expect(screen.getByText('Shared address')).toBeTruthy()
  })

  it('makes no separate read of the domains', async () => {
    await mount()

    expect(
      requests.some((request) => request.line.includes('sending-domains')),
    ).toBe(false)
    const row = screen.getByText('acme.com').closest('tr') as HTMLElement
    // The site sending as it is named on the domain's own row.
    expect(within(row).getByText('Store')).toBeTruthy()
  })

  it('links each site to its own Sending section', async () => {
    await mount()

    expect(screen.getByText('Blog').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/blog/emails/sending',
    )
  })

  it('reads one page of sites, and the next only when it is opened', async () => {
    const many = Array.from({ length: 12 }, (_, index) => {
      const n = String(index + 1).padStart(2, '0')
      return { id: `site-${n}`, name: `Site ${n}`, subdomain: `site-${n}` }
    })
    identities = Object.fromEntries(
      many.map((site) => [site.id, baseIdentity({})]),
    )
    await mount(many)
    expect(identityReads()).toHaveLength(10)
    expect(screen.getByText('Sites 1–10 of 12')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next page/i }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // The two sites on the new page, and none of the ten already read again.
    expect(identityReads()).toHaveLength(12)
    expect(screen.getByText('Sites 11–12 of 12')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /previous page/i }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(identityReads()).toHaveLength(12)
  })
})

describe('what a reader may do is what the route says they may do', () => {
  it('shows an editor the state, read-only, and says why', async () => {
    identities = {
      'host-1': baseIdentity({ canManage: false }),
      'host-2': baseIdentity({ canManage: false }),
    }
    await mount()

    expect(screen.queryByText('Add domain')).toBeNull()
    expect(screen.queryByText('Edit sender')).toBeNull()
    expect(screen.getByText(/need the organization admin role/i)).toBeTruthy()
    // The domain is still listed, which the owner-or-admin domains route
    // would have refused an editor outright.
    expect(screen.getByText('acme.com')).toBeTruthy()
    const remove = screen.getByText('Remove domain') as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    expect(remove.title).toMatch(/organization admin role/)
  })

  it('opens one site’s sender in the drawer the site’s page uses', async () => {
    await mount()
    const row = screen.getByText('Blog').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByText('Edit sender'))

    expect(drawerProps?.hostId).toBe('host-2')
    expect(drawerProps?.senderId).toBe('default')
    expect(drawerProps?.view).toBe(identities['host-2'])
  })
})

describe('choosing what a site sends as', () => {
  it('asks which site when there is a choice, and posts as that site', async () => {
    await mount()
    fireEvent.click(screen.getByText('Send a site’s email as this domain…'))
    expect(requests.some((request) => request.line.startsWith('POST'))).toBe(
      false,
    )

    fireEvent.mouseDown(screen.getByLabelText('Site'))
    fireEvent.click(screen.getByRole('option', { name: 'Blog' }))
    await act(async () => {
      fireEvent.click(screen.getByText('Send as this domain'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const post = requests.find((request) => request.line.startsWith('POST'))
    expect(post?.line).toBe('POST /api/email/sending-identity')
    expect(post?.body).toEqual({ hostId: 'host-2', domain: 'acme.com' })
  })

  it('does not ask when the organization has one site', async () => {
    identities = { 'host-1': baseIdentity({}) }
    await mount([SITES[0]])
    await act(async () => {
      fireEvent.click(screen.getByText('Send a site’s email as this domain…'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const post = requests.find((request) => request.line.startsWith('POST'))
    expect(post?.body).toEqual({ hostId: 'host-1', domain: 'acme.com' })
  })
})

describe('removing a domain names the sites it stops', () => {
  it('says which site is sending as it before anything is removed', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByText('Remove domain'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(String(confirmed[0]?.description)).toMatch(
      /^Store is currently sending as acme\.com\./,
    )
    const release = requests.find((request) =>
      request.line.startsWith('DELETE'),
    )
    expect(release?.line).toBe(
      'DELETE /api/email/sending-domains?orgId=org-1&domain=acme.com',
    )
  })
})
