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
 * EVERY SITE'S SUPPRESSION LIST, AS FIGURES — AND ONE SITE'S, AS ITSELF.
 *
 * A suppression is one site's, so the organization's page does not merge the
 * lists: it counts each site's by reason, with the same aggregates the site's
 * own card reads, and opens a site's list from its row. What it must never do
 * is print a zero it did not count — "Bounced: 0" is the reassuring wrong
 * answer this surface exists to avoid.
 */

import { act, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: () => undefined }),
  usePathname: () => '/acme/emails/suppressions',
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
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
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ href, children, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}))

/**
 * Each aggregate answers from the collection and reason it was asked about;
 * a site listed in `failing` refuses every one of them.
 */
let counts: Record<string, Record<string, number>> = {}
let failing = new Set<string>()
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (base: { path: string }, clause: { reason: string }) => ({
    ...base,
    reason: clause.reason,
  }),
  where: (_field: string, _op: string, reason: string) => ({ reason }),
  count: () => ({}),
  getAggregateFromServer: async (ref: { path: string; reason?: string }) => {
    const hostId = ref.path.split('/')[1]
    if (failing.has(hostId)) throw new Error('refused')
    return {
      data: () => ({ total: counts[hostId]?.[ref.reason ?? 'all'] ?? 0 }),
    }
  },
}))

/** The site the drill-in mounted the site card for, or null. */
let cardHostId: string | null = null
jest.mock('./suppressions-card', () => ({
  __esModule: true,
  default: ({ hostId }: { hostId: string }) => {
    cardHostId = hostId
    return <div>{'the site’s list'}</div>
  },
}))

import { EmailOrgMountProvider } from './email-org-mount'
import { OrgSiteSuppressions } from './org-site-suppressions'
import { OrgSuppressionsCard } from './org-suppressions-card'

const SITES = [
  { id: 'host-1', name: 'Store', subdomain: 'store' },
  { id: 'host-2', name: 'Blog', subdomain: 'blog' },
]

async function mount(body: ReactNode) {
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
        {body}
      </EmailOrgMountProvider>
    ) as ReactNode as never,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const rowFor = (name: string) =>
  screen.getByText(name).closest('tr') as HTMLElement

beforeEach(() => {
  cardHostId = null
  failing = new Set()
  counts = {
    // 12 in all: 3 bounced, 1 complaint, 2 by hand, so 6 unsubscribed.
    'host-1': { all: 12, bounce: 3, complaint: 1, manual: 2 },
    'host-2': { all: 0 },
  }
})

describe('the organization’s suppression summary', () => {
  it('counts each site by reason, with unsubscribes as the remainder', async () => {
    await mount(<OrgSuppressionsCard />)

    const cells = Array.from(rowFor('Store').querySelectorAll('td')).map(
      (cell) => cell.textContent,
    )
    // Site, Unsubscribed, Bounced, Marked as spam, Added by hand, Total.
    expect(cells).toEqual(['Store', '6', '3', '1', '2', '12'])
  })

  it('opens a site’s own list from its row', async () => {
    await mount(<OrgSuppressionsCard />)

    expect(
      within(rowFor('Blog'))
        .getByText('Blog')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/acme/emails/suppressions/host-2')
  })

  it('prints a dash, never a zero, for a count it could not read', async () => {
    failing = new Set(['host-2'])
    await mount(<OrgSuppressionsCard />)

    const cells = Array.from(rowFor('Blog').querySelectorAll('td'))
      .slice(1)
      .map((cell) => cell.textContent)
    expect(cells).toEqual(['—', '—', '—', '—', '—'])
    expect(
      screen.getByText(/not the same as nobody being suppressed/),
    ).toBeTruthy()
  })
})

describe('one site’s list, opened from the summary', () => {
  it('is that site’s own card', async () => {
    await mount(<OrgSiteSuppressions hostId="host-2" />)

    expect(cardHostId).toBe('host-2')
    expect(
      screen.getByText('All sites').closest('a')?.getAttribute('href'),
    ).toBe('/acme/emails/suppressions')
  })

  it('opens nothing for a site the organization does not have', async () => {
    await mount(<OrgSiteSuppressions hostId="host-elsewhere" />)

    expect(cardHostId).toBeNull()
    expect(screen.getByText(/not one of this organization’s/)).toBeTruthy()
  })
})
