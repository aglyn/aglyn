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
 * ONE DOMAIN, FROM THE ORGANIZATION'S PAGE.
 *
 * The records come from the owner-or-admin domains route; an editor is told
 * why they are not shown, and still sees the domain's state and the sites
 * sending as it, which come back on each site's own identity read. Moving a
 * site onto the domain always names the site.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const pushed: string[] = []
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (path: string) => {
      pushed.push(path)
    },
    replace: () => undefined,
  }),
  usePathname: () => '/acme/emails/sending/acme.com',
}))
jest.mock(
  '@aglyn/tenant-feature-instance/hooks/firebase/firebase-services',
  () => ({
    useUser: () => jest.requireMock('@aglyn/tenant-feature-instance').useUser(),
  }),
)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
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
const confirmed: Array<Record<string, unknown>> = []
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: any) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  AppLink: ({ href, children }: any) => <a href={href}>{children}</a>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: (options: Record<string, unknown>) => {
      confirmed.push(options)
      return Promise.resolve(undefined)
    },
  }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: ({ items }: { items: any[] }) => (
    <div>
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

import { EmailOrgMountProvider } from './email-org-mount'
import { OrgSendingDomainDetail } from './org-sending-domain-detail'

const SITES = [
  { id: 'host-1', name: 'Store', subdomain: 'store' },
  { id: 'host-2', name: 'Blog', subdomain: 'blog' },
]

/** Whether the reader holds the organization admin role, per case. */
let admin = true
const requests: Array<{ line: string; body?: Record<string, unknown> }> = []

const identityFor = (hostId: string) => ({
  orgId: 'org-1',
  selected: hostId === 'host-1' ? 'acme.com' : '',
  platformDomain: '',
  identity: 'Sending as hello@acme.com',
  identitySource: hostId === 'host-1' ? 'custom' : 'shared',
  refusal: null,
  senders: [],
  options: [],
  domains: [
    {
      domain: 'acme.com',
      status: 'verified',
      verifiedAtMs: 1,
      lastCheckedAtMs: 1,
    },
  ],
  canManage: admin,
  entitled: true,
})

beforeEach(() => {
  admin = true
  pushed.length = 0
  requests.length = 0
  confirmed.length = 0
  window.sessionStorage.clear()
  ;(global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    const method = init?.method ?? 'GET'
    requests.push({ line: `${method} ${url}`, body })
    const params = new URL(String(url), 'https://console.test').searchParams
    if (method === 'GET' && String(url).includes('sending-identity')) {
      return {
        ok: true,
        status: 200,
        json: async () => identityFor(String(params.get('hostId'))),
      }
    }
    if (method === 'GET' && String(url).includes('sending-domains')) {
      return admin
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              domains: [
                {
                  domain: 'acme.com',
                  status: 'verified',
                  records: [
                    {
                      type: 'TXT',
                      name: 'send.acme.com',
                      value: 'v=spf1 include:amazonses.com ~all',
                      purpose: 'spf',
                      required: true,
                      note: 'Authorizes the provider.',
                    },
                  ],
                },
              ],
            }),
          }
        : {
            ok: false,
            status: 403,
            json: async () => ({ error: 'Not an organization admin' }),
          }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ from: 'hello@acme.com' }),
    }
  })
})

async function mount() {
  render(
    (
      <EmailOrgMountProvider
        mount={{
          orgId: 'org-1',
          orgSlug: 'acme',
          hosts: SITES,
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
        basePath="/acme/emails"
      >
        <OrgSendingDomainDetail domain="acme.com" basePath="/acme/emails" />
      </EmailOrgMountProvider>
    ) as ReactNode as never,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('a domain opened on the organization’s page', () => {
  it('shows an admin the records to publish, read for the org', async () => {
    await mount()

    expect(
      requests.some(
        (request) =>
          request.line === 'GET /api/email/sending-domains?orgId=org-1',
      ),
    ).toBe(true)
    expect(screen.getByText('Publish these records')).toBeTruthy()
  })

  it('lists the sites sending as it', async () => {
    await mount()

    expect(screen.getByText('Sites sending as this domain')).toBeTruthy()
    expect(screen.getByText('Store')).toBeTruthy()
  })

  it('shows an editor the state and says why the records are not shown', async () => {
    admin = false
    await mount()

    expect(screen.getByText('Verified')).toBeTruthy()
    expect(screen.getByText('Store')).toBeTruthy()
    expect(screen.queryByText('Publish these records')).toBeNull()
    expect(
      screen.getByText(/shown to the organization’s owners and admins/),
    ).toBeTruthy()
    // An editor is offered no control the route would refuse.
    expect(screen.queryByText('Stop sending as this domain')).toBeNull()
    expect(screen.queryByText('Remove domain')).toBeNull()
  })

  it('moves the site an admin picks onto the domain', async () => {
    await mount()
    fireEvent.mouseDown(
      screen.getByLabelText('Send a site’s email as this domain'),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Blog' }))
    await act(async () => {
      fireEvent.click(screen.getByText('Send as this domain'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const post = requests.find((request) => request.line.startsWith('POST'))
    expect(post?.line).toBe('POST /api/email/sending-identity')
    expect(post?.body).toEqual({ hostId: 'host-2', domain: 'acme.com' })
  })

  it('names the site it stops when an admin removes it, then goes back to Sending', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByText('Remove domain'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(String(confirmed[0]?.description)).toMatch(
      /^Store is currently sending/,
    )
    expect(pushed).toEqual(['/acme/emails/sending'])
  })
})
