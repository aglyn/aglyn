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
 * The site's SEO check is drawn by the console, for every site owner — and
 * drawn ONCE.
 *
 * The findings used to exist only inside the AI plugin's audit card, so a
 * site without the add-on had no way to learn a title was too long. Now the
 * SEO section draws the check itself, and the `hostSeo` zone under it is
 * handed the report, so a plugin adds fixes beside the list rather than
 * listing the findings a second time.
 *
 * Asserted against the network for cost (the check reads every checked page's
 * published version, so it runs when asked), against the DOM for what an
 * owner sees, and against the section's source for the order and the prop.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import SeoCheckCard from '../components/seo-check-card.component'
import SeoPageCheck from '../components/seo-page-check.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <section aria-label={typeof header === 'string' ? header : undefined}>{children}</section>
  ),
  AppLink: ({ children, href }: { children?: ReactNode; href?: string }) => <a href={href}>{children}</a>,
}))

const report = {
  pages: [
    {
      screenId: 'home',
      path: '/',
      name: 'Home',
      versionId: 'v1',
      score: 100,
      findings: [],
      keywords: [],
    },
    {
      screenId: 'lamps',
      path: '/lamps',
      name: 'Lamps',
      versionId: 'v2',
      score: 77,
      findings: [
        { code: 'title-too-long', severity: 'medium', message: 'The search title is over 60 characters and will be cut off in results.' },
        { code: 'keyword-missing', severity: 'low', message: 'The page never says “dimmable”.', keyword: 'dimmable' },
      ],
      keywords: [],
    },
  ],
  skipped: 0,
  site: [{ code: 'search-discouraged', severity: 'high', message: 'Search engines are asked not to index this site.' }],
  score: 89,
  notes: [],
}

const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ report }) })
  ;(global as any).fetch = fetchMock
})

describe('the SEO check card', () => {
  it('THE COST: mounting sends no request', async () => {
    render(<SeoCheckCard hostId="h1" orgSlug="acme" host="shop" check={null} onChecked={jest.fn()} />)
    await screen.findByRole('button', { name: 'Run the check' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the site with the keyword lines typed, and hands the report on', async () => {
    const onChecked = jest.fn()
    render(<SeoCheckCard hostId="h1" orgSlug="acme" host="shop" check={null} onChecked={onChecked} />)
    fireEvent.change(screen.getByLabelText('Target keywords by page (optional)'), {
      target: { value: '/lamps: dimmable' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run the check' }))
    await waitFor(() => expect(onChecked).toHaveBeenCalledWith({ report, keywords: '/lamps: dimmable' }))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hosts/seo-check?hostId=h1&keywords=%2Flamps%3A+dimmable')
  })

  it('lists every finding: the site’s, and each page’s with a link to fix it', () => {
    render(
      <SeoCheckCard hostId="h1" orgSlug="acme" host="shop" check={{ report: report as never, keywords: '' }} onChecked={jest.fn()} />,
    )
    expect(screen.getByText('Score 89 of 100 · 2 pages · 3 findings')).toBeTruthy()
    expect(screen.getByText('Search engines are discouraged')).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Checked pages' })
    expect(within(table).getByText('Title too long')).toBeTruthy()
    expect(within(table).getByText('Target keyword not covered: dimmable')).toBeTruthy()
    expect(within(table).getByText('Lamps').getAttribute('href')).toBe('/acme/hosts/shop/screens/lamps/versions/v2/view')
  })
})

describe('the page check', () => {
  it('answers for this page only', async () => {
    render(<SeoPageCheck hostId="h1" screenId="lamps" />)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check this page' }))
    await screen.findByText('Score 77 of 100, as published')
    expect(screen.getByText('Title too long')).toBeTruthy()
    expect(screen.queryByText('Search engines are discouraged')).toBeNull()
  })

  it('says so when the sitemap does not list the page', async () => {
    render(<SeoPageCheck hostId="h1" screenId="draft" />)
    fireEvent.click(screen.getByRole('button', { name: 'Check this page' }))
    await screen.findByText(/so the SEO check does not cover it/)
  })
})

describe('the SEO section draws the check once, above the zone that fixes it', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', '[orgSlug]', 'hosts', '[host]', 'setup', '(sections)', 'seo', 'page.tsx'),
    'utf8',
  )

  it('renders the check before the hostSeo zone, and hands the zone its report', () => {
    const card = page.indexOf('<SeoCheckCard')
    const zone = page.indexOf('slot="hostSeo"')
    expect(card).toBeGreaterThan(-1)
    expect(zone).toBeGreaterThan(card)
    const slot = page.slice(zone, page.indexOf('/>', zone))
    expect(slot).toContain('check={check}')
  })
})
