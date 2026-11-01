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
 * The staff review queue lists site starters in a section of their own
 * (AGL-4049): what a reviewer scans a starter by is its pages and its price,
 * not a plugin's version and license.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
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
jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn'),
  PageHeaderHelp: () => null,
}))

import PluginReviewsQueue from './plugin-reviews-queue.component'

const SUBMITTED_AT = '2026-10-28T15:00:00.000Z'

let mockBody: Record<string, unknown> = {}
const fetchMock = jest.fn()

function queueBody(starters: Array<Record<string, unknown>>) {
  return {
    queue: [],
    listed: [],
    verificationRequests: [],
    starters,
    publishers: { 'org-pub': 'Northwind Coffee' },
    refused: [],
    notices: [],
    more: { queue: false, listed: false, verification: false, starters: false },
    limit: 50,
  }
}

const starterRow = (fields: Record<string, unknown> = {}) => ({
  listingId: 'starter-1',
  displayName: 'Corner Bistro',
  profileId: 'org-pub',
  reviewStatus: 'submitted',
  priceUsd: 19,
  pages: 4,
  version: '2',
  reviewedVersion: null,
  submittedAt: SUBMITTED_AT,
  hidden: false,
  official: false,
  ...fields,
})

beforeEach(() => {
  mockBody = queueBody([starterRow()])
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => mockBody }))
  ;(global as { fetch?: unknown }).fetch = fetchMock
})

const startersCard = async () => {
  const heading = await screen.findByRole('heading', { name: /^Site starters/ })
  return heading.closest('section') as HTMLElement
}

describe('the Starters section (AGL-4049)', () => {
  it('heads the starters waiting for review with their count', async () => {
    render(<PluginReviewsQueue basePath="/admin/plugin-reviews" />)
    const card = await startersCard()
    expect(within(card).getByRole('heading').textContent).toBe('Site starters awaiting review (1)')
  })

  it('shows each starter by name, publisher, pages, price, submitted date and status', async () => {
    render(<PluginReviewsQueue basePath="/admin/plugin-reviews" />)
    const card = await startersCard()
    const link = within(card).getByRole('link', { name: 'Corner Bistro' })
    expect(link.getAttribute('href')).toBe('/admin/plugin-reviews/starter-1')
    expect(within(card).getByText('Submitted')).toBeTruthy()
    expect(
      within(card).getByText(
        `Northwind Coffee · 4 pages · $19 · Submitted ${new Date(SUBMITTED_AT).toLocaleDateString()}`,
      ),
    ).toBeTruthy()
  })

  it('says Free for a starter with no price, and one page in the singular', async () => {
    mockBody = queueBody([starterRow({ priceUsd: 0, pages: 1 })])
    render(<PluginReviewsQueue basePath="/admin/plugin-reviews" />)
    const card = await startersCard()
    expect(within(card).getByText(/^Northwind Coffee · 1 page · Free · Submitted/)).toBeTruthy()
  })

  it('flags a listed starter whose newest version came after its review, and one taken down', async () => {
    mockBody = queueBody([starterRow({ reviewStatus: 'listed', version: '3', reviewedVersion: '2', hidden: true })])
    render(<PluginReviewsQueue basePath="/admin/plugin-reviews" />)
    const card = await startersCard()
    expect(within(card).getByText('v3 since review (v2)')).toBeTruthy()
    expect(within(card).getByText('Taken down')).toBeTruthy()
  })

  it('says plainly when nothing is waiting', async () => {
    mockBody = queueBody([])
    render(<PluginReviewsQueue basePath="/admin/plugin-reviews" />)
    const card = await startersCard()
    expect(within(card).getByText('No site starters waiting for review.')).toBeTruthy()
  })

  it('offers Rejected in the Status menu, and names the section by what it then holds', async () => {
    render(<PluginReviewsQueue basePath="/admin/plugin-reviews" />)
    await startersCard()
    fireEvent.mouseDown(screen.getByRole('combobox'))
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toContain('Rejected')
    mockBody = queueBody([starterRow({ reviewStatus: 'rejected' })])
    fireEvent.click(options.find((option) => option.textContent === 'Rejected') as HTMLElement)
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('status=rejected'))
    await waitFor(async () => expect((await startersCard()).querySelector('h2')?.textContent).toBe('Site starters (1)'))
  })
})
