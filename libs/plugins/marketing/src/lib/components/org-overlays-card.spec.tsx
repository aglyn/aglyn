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
 * EVERY SITE'S OVERLAYS, on the organization's Marketing hub.
 *
 *  1. Grouped by site, each group in the order that site SHOWS them, under a
 *     line naming the site — linked to its own Overlays section — and its
 *     default bar and popup.
 *  2. The one write it makes is the switch, on the row's own site.
 *  3. Editing and creating happen on the site: Edit and New are links.
 *  4. Paged by site: a page of sites is read, the next only when turned to.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Each site's overlay documents, by host id. */
const overlaysBySite = new Map<string, Array<{ id: string; data: any }>>()
/** Each site's host document, by host id; absent = not found. */
const hostDocs = new Map<string, any>()
/** Sites whose overlay read is refused. */
const refusedSites = new Set<string>()
/** Every path a one-shot read asked for, with its cap. */
const reads: string[] = []
const mockSetDoc = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  query: (base: any, ...clauses: any[]) => ({
    __path: base.__path,
    __limit: clauses.find((clause) => clause?.__limit)?.__limit,
    __order: clauses.find((clause) => clause?.__order)?.__order,
  }),
  orderBy: (field: string) => ({ __order: field }),
  limit: (value: number) => ({ __limit: value }),
  getDocs: async (target: any) => {
    reads.push(`${target.__path} limit=${target.__limit} order=${target.__order}`)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const hostId = target.__path.split('/')[1]
    if (refusedSites.has(hostId)) throw new Error('permission-denied')
    // Answered the way the query asks: by name, up to the cap.
    const docs = [...(overlaysBySite.get(hostId) ?? [])]
      .sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)))
      .slice(0, target.__limit)
    return { docs: docs.map((one) => ({ id: one.id, data: () => one.data })) }
  },
  getDoc: async (target: any) => {
    reads.push(target.__path)
    const data = hostDocs.get(target.__path.split('/')[1])
    return { exists: () => Boolean(data), data: () => data }
  },
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
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

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/marketing/overlays',
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ orgSlug: 'acme' }),
}))

import { MarketingOrgMountProvider } from './marketing-org-mount'
import { ORG_OVERLAYS_PER_SITE, OrgOverlaysCard } from './org-overlays-card'
import { ORG_SITES_PER_PAGE } from './use-one-shot-reads'

type Site = { id: string; name: string; subdomain: string | null }

const SHOP: Site = { id: 'shop1', name: 'Shop', subdomain: 'shop' }
const BLOG: Site = { id: 'blog1', name: 'Blog', subdomain: 'blog' }

const bar = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  data: {
    kind: 'bar',
    name: id,
    enabled: true,
    bar: { text: `${id} text` },
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
        <OrgOverlaysCard org={{ plan: 'business' } as never} />
      </MarketingOrgMountProvider>
    ) as ReactNode as never,
  )
  await settle()
}

/** The overlay names under one site's line, in the order they are drawn. */
function overlayNamesUnder(siteName: string): string[] {
  const table = screen.getByRole('table', { name: 'Overlays by site' })
  const rows = within(table).getAllByRole('row')
  const start = rows.findIndex((row) => row.textContent?.startsWith(siteName))
  const names: string[] = []
  for (const row of rows.slice(start + 1)) {
    const cells = within(row).queryAllByRole('cell')
    // A site's own line is one cell spanning the row.
    if (cells.length < 2) break
    names.push(cells[0].textContent ?? '')
  }
  return names
}

beforeEach(() => {
  overlaysBySite.clear()
  hostDocs.clear()
  refusedSites.clear()
  reads.length = 0
  mockSetDoc.mockClear()
  mockEnqueueSnackbar.mockClear()
  mockEntitled = true
})

describe('the list', () => {
  it('groups each site’s overlays under a line that opens the site’s own list', async () => {
    overlaysBySite.set('shop1', [bar('Spring'), bar('Autumn')])
    overlaysBySite.set('blog1', [bar('Newsletter', { kind: 'popup', popup: { body: 'Join' } })])
    await renderCard([SHOP, BLOG])

    expect(screen.getByRole('link', { name: 'Shop' }).getAttribute('href')).toBe(
      '/acme/hosts/shop/marketing/overlays',
    )
    expect(screen.getByRole('link', { name: 'Blog' }).getAttribute('href')).toBe(
      '/acme/hosts/blog/marketing/overlays',
    )
    expect(overlayNamesUnder('Shop')).toEqual(['Autumn', 'Spring'])
    expect(overlayNamesUnder('Blog')).toEqual(['Newsletter'])
  })

  it('orders each site’s group the way that site shows them, not by name', async () => {
    overlaysBySite.set('shop1', [
      bar('Alpha'),
      bar('Beta', { order: -1 }),
      bar('Gamma'),
    ])
    await renderCard([SHOP])
    expect(overlayNamesUnder('Shop')).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('reads each site ordered by name and ceilinged, with a probe past it', async () => {
    await renderCard([SHOP])
    expect(reads).toContain(
      `hosts/shop1/overlays limit=${ORG_OVERLAYS_PER_SITE + 1} order=name`,
    )
  })

  it('says whether each site’s default bar and popup are showing', async () => {
    hostDocs.set('shop1', {
      announcementBar: { enabled: true, text: 'Free shipping' },
      // Switched on with no body: the page draws no popup, so neither does this.
      popup: { enabled: true },
    })
    await renderCard([SHOP])
    expect(screen.getByText('Default bar on · default popup off')).toBeTruthy()
  })

  it('says when a site has more overlays than were read', async () => {
    overlaysBySite.set(
      'shop1',
      Array.from({ length: ORG_OVERLAYS_PER_SITE + 1 }, (_, index) =>
        bar(`Bar ${String(index).padStart(2, '0')}`),
      ),
    )
    await renderCard([SHOP])
    expect(overlayNamesUnder('Shop')).toHaveLength(ORG_OVERLAYS_PER_SITE)
    expect(
      screen.getByText(new RegExp(`More than ${ORG_OVERLAYS_PER_SITE} on this site`)),
    ).toBeTruthy()
  })

  it('reports a site it could not read, and still draws the others', async () => {
    refusedSites.add('blog1')
    overlaysBySite.set('shop1', [bar('Spring')])
    await renderCard([SHOP, BLOG])
    expect(screen.getByText('This site’s overlays could not be read.')).toBeTruthy()
    expect(overlayNamesUnder('Shop')).toEqual(['Spring'])
  })
})

describe('what it changes, and what it sends to the site', () => {
  it('switches an overlay with one merged field on the row’s own site', async () => {
    overlaysBySite.set('blog1', [bar('Spring')])
    await renderCard([SHOP, BLOG])

    const toggle = screen.getByRole('switch', { name: 'Show Spring on Blog' })
    expect((toggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(toggle)
    await settle()

    expect(mockSetDoc).toHaveBeenCalledTimes(1)
    const [ref, payload, options] = mockSetDoc.mock.calls[0] as any[]
    expect(ref.__path).toBe('hosts/blog1/overlays/Spring')
    expect(payload).toEqual({ enabled: false })
    expect(options).toEqual({ merge: true })
    expect(
      (screen.getByRole('switch', { name: 'Show Spring on Blog' }) as HTMLInputElement)
        .checked,
    ).toBe(false)
  })

  /*
   * A link drawn as a button: MUI gives the anchor `role="button"`, so these
   * are found by that role and proven links by their `href`.
   */
  it('edits on the site: each row’s Edit opens the site’s Overlays section', async () => {
    overlaysBySite.set('shop1', [bar('Spring')])
    await renderCard([SHOP])
    expect(
      screen.getByRole('button', { name: 'Edit Spring on Shop' }).getAttribute('href'),
    ).toBe('/acme/hosts/shop/marketing/overlays')
  })

  it('creates on the site: New asks which site when there is a choice', async () => {
    await renderCard([SHOP, BLOG])
    fireEvent.click(screen.getByRole('button', { name: 'New overlay' }))
    const menu = screen.getByRole('menu', { name: 'New overlay on which site' })
    expect(
      within(menu).getByRole('menuitem', { name: 'Blog' }).getAttribute('href'),
    ).toBe('/acme/hosts/blog/marketing/overlays')
    expect(
      within(menu).getByRole('menuitem', { name: 'Shop' }).getAttribute('href'),
    ).toBe('/acme/hosts/shop/marketing/overlays')
  })

  it('creates on the site: with one site, New is the link', async () => {
    await renderCard([SHOP])
    expect(
      screen.getByRole('button', { name: 'New overlay' }).getAttribute('href'),
    ).toBe('/acme/hosts/shop/marketing/overlays')
  })
})

describe('the read', () => {
  const sites = (count: number): Site[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `site${index + 1}`,
      name: `Site ${index + 1}`,
      subdomain: `site-${index + 1}`,
    }))

  it('reads one page of sites, and the next only when it is turned to', async () => {
    await renderCard(sites(ORG_SITES_PER_PAGE + 2))
    const overlayReads = () => reads.filter((path) => path.includes('/overlays'))
    expect(overlayReads()).toHaveLength(ORG_SITES_PER_PAGE)
    expect(screen.getByText(`Sites 1–${ORG_SITES_PER_PAGE} of ${ORG_SITES_PER_PAGE + 2}`)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    await settle()
    expect(overlayReads()).toHaveLength(ORG_SITES_PER_PAGE + 2)
    expect(screen.getByRole('link', { name: `Site ${ORG_SITES_PER_PAGE + 1}` })).toBeTruthy()

    // Back to a page already read costs nothing.
    fireEvent.click(screen.getByRole('button', { name: /previous page/i }))
    await settle()
    expect(overlayReads()).toHaveLength(ORG_SITES_PER_PAGE + 2)
  })

  it('reads nothing on a plan without overlays, and says where they are sold', async () => {
    mockEntitled = false
    await renderCard([SHOP, BLOG])
    expect(reads).toHaveLength(0)
    expect(screen.getByText(/included from the Starter plan/)).toBeTruthy()
  })
})
