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
 * ONE AUDIENCE ON THE ORGANIZATION'S EMAILS PAGE, AND THE SITE IT IS WORKED AS.
 *
 * The list is the org's, but enrolling somebody on it is done as one site,
 * and the Consent column reads what each person agreed to with one site's
 * group. So with no site in the URL the page must say which before it builds
 * the membership panel — and it must hand the panel, and the importer, THAT
 * site and THAT site's consent group rather than any other.
 *
 * The membership panel and the importer are stubbed: what belongs here is
 * what they are handed, and each has its own suite for what it does.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

let listDoc: Record<string, unknown> | undefined
/** The props the members panel was last mounted with, or null. */
let panelProps: Record<string, any> | null = null
/** The props the importer was last mounted with, or null. */
let importProps: Record<string, any> | null = null

const FIRESTORE = {}
const SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/acme/emails/audiences/list-1',
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => SCOPE,
  useFirestoreDoc: () => ({ data: listDoc, status: 'success' }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getCountFromServer: async () => ({ data: () => ({ count: 3 }) }),
}))

jest.mock('@aglyn/aglyn', () => {
  // The consent-group resolver is real: which group a site belongs to is the
  // fact this suite asserts is handed on.
  const actual = jest.requireActual('@aglyn/aglyn')
  return { ...actual, pluginDocsHelp: () => undefined }
})

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: any) => (
    <div>
      <div>{HeaderProps?.action}</div>
      {children}
    </div>
  ),
  AppLink: ({ href, children }: any) => <a href={href}>{children}</a>,
  MdiIcon: () => null,
}))

jest.mock('./list-members-panel', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    panelProps = props
    return <div>{'the members'}</div>
  },
}))

jest.mock('./list-import-drawer', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    importProps = props
    return <div>{'the importer'}</div>
  },
}))

import { EmailOrgMountProvider } from './email-org-mount'
import { ListDetailCard } from './list-detail-card'

const TWO_SITES = [
  { id: 'host-1', name: 'Store', subdomain: 'store' },
  { id: 'host-2', name: 'Blog', subdomain: 'blog' },
  { id: 'host-3', name: 'Outlet', subdomain: 'outlet' },
]

/** An org that has declared two of its three sites one sender. */
const ORG = {
  consentGroups: {
    brand: { name: 'Acme brands', hostIds: ['host-1', 'host-2'] },
  },
}

async function mountAtOrg(hosts = TWO_SITES) {
  panelProps = null
  importProps = null
  window.sessionStorage.clear()
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
        <ListDetailCard
          hostId={null}
          org={ORG}
          listId="list-1"
          basePath="/acme/emails"
        />
      </EmailOrgMountProvider>
    ) as ReactNode as never,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('an audience opened on the organization’s page', () => {
  it('works it as the site its filters draw from', async () => {
    listDoc = { name: 'VIPs', kind: 'manual', hostId: 'host-2' }
    await mountAtOrg()

    expect(panelProps?.hostId).toBe('host-2')
    // The DECLARED group host-2 belongs to, not a group of one.
    expect(panelProps?.consentGroup).toMatchObject({
      hostId: 'host-2',
      declared: true,
      hostIds: ['host-1', 'host-2'],
    })
  })

  it('builds no membership panel until a site is chosen, when there is a choice', async () => {
    listDoc = { name: 'Newsletter', kind: 'manual' }
    await mountAtOrg()

    expect(panelProps).toBeNull()
    expect(document.body.textContent).toContain('Choose the site to work')
    // An import enrolls as a site too, so it waits for the same answer.
    expect(
      (screen.getByText('Import').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('reads consent for the site the reader picks, and imports as it', async () => {
    listDoc = { name: 'Newsletter', kind: 'manual' }
    await mountAtOrg()

    fireEvent.mouseDown(screen.getByLabelText('Enroll as'))
    fireEvent.click(screen.getByRole('option', { name: 'Outlet' }))

    expect(panelProps?.hostId).toBe('host-3')
    // Outlet is in no declared group, so its group is itself alone.
    expect(panelProps?.consentGroup).toMatchObject({
      hostId: 'host-3',
      declared: false,
      hostIds: ['host-3'],
    })

    fireEvent.click(screen.getByText('Import'))
    expect(importProps?.hostId).toBe('host-3')
  })

  it('takes the only site without asking', async () => {
    listDoc = { name: 'Newsletter', kind: 'manual' }
    await mountAtOrg([TWO_SITES[0]])

    expect(panelProps?.hostId).toBe('host-1')
  })

  it('does not stand on a stored site the org no longer has', async () => {
    // A list set up on a site since deleted: its id is not a site the reader
    // can enroll as, so the page asks rather than using it.
    listDoc = { name: 'Old list', kind: 'manual', hostId: 'host-gone' }
    await mountAtOrg()

    expect(panelProps).toBeNull()
  })
})

describe('the same page under a site', () => {
  it('THE CONTROL: uses the site and the group the page resolved, and asks nothing', async () => {
    listDoc = { name: 'VIPs', kind: 'manual', hostId: 'host-2' }
    panelProps = null
    const group = {
      hostId: 'host-1',
      groupId: null,
      name: '',
      hostIds: ['host-1'],
      declared: false,
    }
    render(
      (
        <ListDetailCard
          hostId="host-1"
          consentGroup={group as never}
          listId="list-1"
          basePath="/acme/hosts/store/emails"
        />
      ) as ReactNode as never,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(panelProps?.hostId).toBe('host-1')
    expect(panelProps?.consentGroup).toBe(group)
    expect(screen.queryByLabelText('Enroll as')).toBeNull()
  })
})
