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
 * EVERY SITE'S A/B TESTS, on the organization's Marketing hub.
 *
 *  1. Grouped by site, the site line linked to its own A/B testing section.
 *  2. A test's results are read when somebody asks, from THAT test's site,
 *     and shown with the site card's own figures — read-only.
 *  3. Creating, starting and deciding happen on the site: New and Open are
 *     links, and nothing here writes.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Each site's experiment documents, by host id. */
const experimentsBySite = new Map<string, Array<{ id: string; data: any }>>()
/** Each test's per-variant counters, keyed `hostId/experimentId`. */
const statsByTest = new Map<string, Record<string, any>>()
/** Every collection a one-shot read asked for, with its cap. */
const reads: string[] = []
const mockWrite = jest.fn()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  query: (base: any, ...clauses: any[]) => ({
    __path: base.__path,
    __limit: clauses.find((clause) => clause?.__limit)?.__limit,
  }),
  orderBy: (field: string) => ({ __order: field }),
  limit: (value: number) => ({ __limit: value }),
  getDocs: async (target: any) => {
    reads.push(target.__limit ? `${target.__path} limit=${target.__limit}` : target.__path)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const segments = target.__path.split('/')
    if (segments[segments.length - 1] === 'stats') {
      const stats = statsByTest.get(`${segments[1]}/${segments[3]}`) ?? {}
      const docs = Object.entries(stats).map(([id, data]) => ({ id, data: () => data }))
      return { docs, forEach: (visit: (entry: any) => void) => docs.forEach(visit) }
    }
    const docs = [...(experimentsBySite.get(segments[1]) ?? [])]
      .sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)))
      .slice(0, target.__limit)
    return { docs: docs.map((one) => ({ id: one.id, data: () => one.data })) }
  },
  setDoc: (...args: unknown[]) => mockWrite(...args),
  updateDoc: (...args: unknown[]) => mockWrite(...args),
  deleteDoc: (...args: unknown[]) => mockWrite(...args),
}))

const FIRESTORE = { __firestore: true }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
}))

let mockEntitled = true
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  checkEntitlement: () => mockEntitled,
  pluginDocsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/marketing/experiments',
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ orgSlug: 'acme' }),
}))

import { MarketingOrgMountProvider } from './marketing-org-mount'
import {
  ORG_EXPERIMENTS_PER_SITE,
  OrgExperimentsCard,
} from './org-experiments-card'

type Site = { id: string; name: string; subdomain: string | null }

const SHOP: Site = { id: 'shop1', name: 'Shop', subdomain: 'shop' }
const BLOG: Site = { id: 'blog1', name: 'Blog', subdomain: 'blog' }

const experiment = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  data: {
    name: id,
    status: 'running',
    target: 'screen',
    variants: [
      { id: 'a', name: 'Control', weight: 1 },
      { id: 'b', name: 'Challenger', weight: 1 },
    ],
    ...over,
  },
})

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderCard(hosts: Site[]): Promise<void> {
  render(
    (
      <MarketingOrgMountProvider
        value={{
          orgId: 'org1',
          orgSlug: 'acme',
          hosts,
          hostsReady: true,
          hostsPath: '/acme/hosts',
          basePath: '/acme/marketing',
        }}
      >
        <OrgExperimentsCard org={{ plan: 'business' } as never} />
      </MarketingOrgMountProvider>
    ) as ReactNode as never,
  )
  await settle()
}

beforeEach(() => {
  experimentsBySite.clear()
  statsByTest.clear()
  reads.length = 0
  mockWrite.mockClear()
  mockEntitled = true
})

describe('the list', () => {
  it('groups each site’s tests under a line that opens the site’s own list', async () => {
    experimentsBySite.set('shop1', [experiment('Hero copy')])
    experimentsBySite.set('blog1', [experiment('Signup box', { target: 'section', status: 'paused' })])
    await renderCard([SHOP, BLOG])

    expect(screen.getByRole('link', { name: 'Shop' }).getAttribute('href')).toBe(
      '/acme/hosts/shop/marketing/experiments',
    )
    const table = screen.getByRole('table', { name: 'Experiments by site' })
    const row = within(table).getByText('Signup box').closest('tr') as HTMLElement
    expect(
      within(row)
        .getAllByRole('cell')
        .slice(0, 4)
        .map((cell) => cell.textContent),
    ).toEqual(['Signup box', 'Section', '2', 'paused'])
  })

  it('reads each site ordered by name and ceilinged, and says when it bit', async () => {
    experimentsBySite.set(
      'shop1',
      Array.from({ length: ORG_EXPERIMENTS_PER_SITE + 1 }, (_, index) =>
        experiment(`Test ${String(index).padStart(2, '0')}`),
      ),
    )
    await renderCard([SHOP])
    expect(reads).toEqual([
      `hosts/shop1/experiments limit=${ORG_EXPERIMENTS_PER_SITE + 1}`,
    ])
    expect(
      screen.getByText(new RegExp(`More than ${ORG_EXPERIMENTS_PER_SITE} on this site`)),
    ).toBeTruthy()
    expect(screen.queryByText(`Test ${ORG_EXPERIMENTS_PER_SITE}`)).toBeNull()
  })
})

describe('the results', () => {
  it('are read from the test’s own site when asked, and never before', async () => {
    experimentsBySite.set('blog1', [experiment('Signup box')])
    statsByTest.set('blog1/Signup box', {
      a: { exposures: 100, conversions: 10 },
      b: { exposures: 100, conversions: 20 },
    })
    await renderCard([SHOP, BLOG])
    expect(reads.some((path) => path.endsWith('/stats'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Results for Signup box on Blog' }))
    await settle()

    expect(reads).toContain('hosts/blog1/experiments/Signup box/stats')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('On Blog')).toBeTruthy()
    const challenger = within(dialog).getByText(/Challenger/).closest('tr') as HTMLElement
    expect(
      within(challenger)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Challenger ▲', '100', '20', '20.0%', '+100% · 98% conf.'])
    // Deciding changes what the site serves, so it is done there.
    expect(within(dialog).queryByRole('button', { name: 'Pick winner' })).toBeNull()
    expect(
      within(dialog).getByRole('button', { name: 'Open on the site' }).getAttribute('href'),
    ).toBe('/acme/hosts/blog/marketing/experiments')
    expect(mockWrite).not.toHaveBeenCalled()
  })
})

describe('what it sends to the site', () => {
  it('opens a test on its site, and creates on the site the reader picks', async () => {
    experimentsBySite.set('shop1', [experiment('Hero copy')])
    await renderCard([SHOP, BLOG])
    expect(
      screen.getByRole('button', { name: 'Open Hero copy on Shop' }).getAttribute('href'),
    ).toBe('/acme/hosts/shop/marketing/experiments')

    fireEvent.click(screen.getByRole('button', { name: 'New experiment' }))
    const menu = screen.getByRole('menu', { name: 'New experiment on which site' })
    expect(
      within(menu).getByRole('menuitem', { name: 'Blog' }).getAttribute('href'),
    ).toBe('/acme/hosts/blog/marketing/experiments')
  })

  it('reads nothing on a plan without A/B testing, and says where it is sold', async () => {
    mockEntitled = false
    await renderCard([SHOP])
    expect(reads).toHaveLength(0)
    expect(screen.getByText(/included in the Business plan/)).toBeTruthy()
  })
})
