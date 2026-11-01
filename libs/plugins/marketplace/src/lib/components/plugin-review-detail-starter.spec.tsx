/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * A site starter's review page (AGL-4049) is about what a site created from
 * it gets — its pages, its layout, its theme, its picture — and its verdicts
 * are List and Reject, gated on the starter's own checklist. None of the
 * plugin page's code review (manifest, verifier, realm trust) applies.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/aglyn-markdown-editor', () => ({ MarkdownLiteView: () => null }))
jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn'),
  PageHeaderRecord: () => null,
  PageHeaderHelp: () => null,
}))

import ReviewDetailPage from './plugin-review-detail.component'
import { requiredChecklistIds } from '../model/plugin-review-checklist'

const fetchMock = jest.fn()
let mockChecklist: Record<string, { by: string | null }> = {}

function starterBody() {
  const ids = requiredChecklistIds('siteStarter')
  return {
    artifactType: 'siteStarter',
    listingId: 'starter-1',
    displayName: 'Corner Bistro',
    description: 'A warm, photo-led site for a neighborhood restaurant.',
    category: 'Restaurant & café',
    previewImageUrl: 'https://cdn.example.test/bistro.webp',
    publisherId: 'org-pub',
    publisherName: 'Northwind Coffee',
    publisherSlug: 'northwind',
    publisherAgreement: { version: '2026-08-24.1', acceptedAt: null, required: '2026-08-24.1', state: 'current' },
    reviewStatus: 'submitted',
    rejectionReason: '',
    rejectionCategory: '',
    reviewedVersion: null,
    priceUsd: 19,
    official: false,
    hidden: false,
    hiddenReason: '',
    unpublished: false,
    latestVersion: '2',
    reviewVersion: '2',
    mode: 'base',
    facets: { kind: 'restaurant', base: 'bootstrap', fonts: 'editorial', pages: 3, mode: 'base' },
    pages: [
      { name: 'Home', slug: '/', published: true },
      { name: 'Menu', slug: '/menu', published: true },
      { name: 'Private dining', slug: null, published: false },
    ],
    layout: { name: 'Site header and footer' },
    theme: {
      kind: 'builtin',
      base: 'bootstrap',
      fonts: 'editorial',
      brand: { light: { primary: '#1b5e20' }, dark: { primary: '#81c784' } },
    },
    sourceSite: { hostId: 'host-src', name: 'Bistro demo', subdomain: 'bistro-demo', cname: null },
    versions: [
      { version: '2', publishedAt: '2026-10-28T00:00:00.000Z', pages: 3 },
      { version: '1', publishedAt: '2026-10-20T00:00:00.000Z', pages: 2 },
    ],
    checklist: mockChecklist,
    checklistOutstanding: ids.filter((id) => !mockChecklist[id]),
  }
}

beforeEach(() => {
  mockChecklist = {}
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
    init?.method === 'POST'
      ? { ok: true, status: 200, json: async () => ({ ok: true }) }
      : { ok: true, status: 200, json: async () => starterBody() },
  )
  ;(global as { fetch?: unknown }).fetch = fetchMock
})

const open = () => render(<ReviewDetailPage basePath="/admin/plugin-reviews" segments={['starter-1']} />)
const card = async (name: RegExp) => (await screen.findByRole('heading', { name })).closest('section') as HTMLElement

describe('what a site created from it gets', () => {
  it('lists its pages, each published one with where it lives on the site it came from', async () => {
    open()
    const pages = await card(/^Pages \(3\)$/)
    expect(within(pages).getByText('Home')).toBeTruthy()
    expect(within(pages).getByText('/menu')).toBeTruthy()
    expect(within(pages).getByText('Not published')).toBeTruthy()
    expect(within(pages).getAllByRole('link', { name: /Open on Bistro demo/ })).toHaveLength(2)
    expect(within(pages).getByText('Site header and footer')).toBeTruthy()
  })

  it('names its theme, fonts and brand colors in both schemes', async () => {
    open()
    const theme = await card(/^Theme$/)
    expect(within(theme).getByText('Built-in theme with its brand colors')).toBeTruthy()
    expect(within(theme).getByText('bootstrap')).toBeTruthy()
    expect(within(theme).getByText('Playfair Display headings, Source Sans 3 text')).toBeTruthy()
    expect(within(theme).getByLabelText('Light primary #1b5e20')).toBeTruthy()
    expect(within(theme).getByLabelText('Dark primary #81c784')).toBeTruthy()
  })

  it('shows its picture and the facets a search finds it by', async () => {
    open()
    const overview = await card(/^Overview$/)
    expect(within(overview).getByRole('img').getAttribute('src')).toBe('https://cdn.example.test/bistro.webp')
    expect(within(overview).getByText('Restaurant & café')).toBeTruthy()
    expect(within(overview).getByText('Style: Restaurant & café')).toBeTruthy()
  })

  it('leaves out the plugin page’s code review', async () => {
    open()
    await card(/^Pages/)
    // The plugin page's README panel; the shared positioning item may name a README.
    expect(screen.queryByText('README')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Security' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Approve version|Verify/ })).toBeNull()
  })
})

describe('its checklist and verdicts', () => {
  it('asks the starter checklist, and links the site it was published from', async () => {
    open()
    const checklist = await card(/^Review checklist — v2/)
    expect(within(checklist).getByRole('heading').textContent).toBe('Review checklist — v2 (0/5)')
    expect(within(checklist).getAllByRole('checkbox')).toHaveLength(5)
    const site = within(checklist).getByRole('link', { name: 'Bistro demo’s staff page' })
    expect(site.getAttribute('href')).toBe('/admin/sites/host-src')
  })

  it('ticks an item against the version under review', async () => {
    open()
    const checklist = await card(/^Review checklist/)
    fireEvent.click(within(checklist).getAllByRole('checkbox')[2])
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, call]) => call?.method === 'POST')
    expect(JSON.parse(init.body)).toEqual({
      listingId: 'starter-1',
      action: 'checklist',
      version: '2',
      itemId: 'starter-theme',
      checked: true,
    })
  })

  it('holds List while an item is outstanding', async () => {
    open()
    const verdict = await card(/^Review verdict$/)
    expect((within(verdict).getByRole('button', { name: 'List in marketplace' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(verdict).getByText(/5 required checklist items outstanding/)).toBeTruthy()
  })

  it('lists it once every item is ticked', async () => {
    for (const id of requiredChecklistIds('siteStarter')) mockChecklist[id] = { by: 'staff-1' }
    open()
    const verdict = await card(/^Review verdict$/)
    const list = within(verdict).getByRole('button', { name: 'List in marketplace' }) as HTMLButtonElement
    expect(list.disabled).toBe(false)
    fireEvent.click(list)
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, call]) => call?.method === 'POST')
    expect(JSON.parse(init.body)).toEqual({ listingId: 'starter-1', action: 'list' })
  })

  it('rejects with a starter reason, never a plugin one', async () => {
    open()
    const verdict = await card(/^Review verdict$/)
    const reject = within(verdict).getByRole('button', { name: 'Reject' }) as HTMLButtonElement
    expect(reject.disabled).toBe(true)
    fireEvent.mouseDown(within(verdict).getByRole('combobox'))
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    const labels = options.map((option) => option.textContent)
    expect(labels).toContain('The theme does not read in light or dark')
    expect(labels).not.toContain('Missing or inadequate README')
    fireEvent.click(options.find((option) => option.textContent === 'The theme does not read in light or dark') as HTMLElement)
    await waitFor(() => expect(reject.disabled).toBe(false))
    fireEvent.click(reject)
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, call]) => call?.method === 'POST')
    expect(JSON.parse(init.body)).toEqual({ listingId: 'starter-1', action: 'reject', category: 'starter-theme', reason: '' })
  })
})
