/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://acme.aglyn.app/definitely-missing-xyz"}
 */
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
 * What the host boundary puts on the page once it renders (AGL-2648).
 *
 * The served HTML of a tenant 404 has an empty body — a framework fact, see
 * `[host]/not-found.tsx` — so the document a visitor actually reads is the
 * one this boundary renders after hydration, and for a site that designed no
 * 404 that is `SiteStatusScreen`. These assert that document is a real one:
 * an `<h1>`, the one `main` landmark, the site's mark, its public pages in a
 * `nav`, a plain GET search form, and a footer — the AGL-2187 contract the
 * title work must not have loosened.
 *
 * The link primitive is stubbed to a bare anchor. `AppLink` is a Next link
 * over the router, which a jsdom render does not have; the hrefs and labels
 * it is handed are the site's, and those are what is asserted.
 */

jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => '/definitely-missing-xyz',
}))
jest.mock('@aglyn/shared-ui-jsx/components/app-link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    'aria-label': ariaLabel,
  }: {
    href: string
    children?: React.ReactNode
    'aria-label'?: string
  }) => (
    <a href={href} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}))

import { render, screen, within } from '@testing-library/react'
import {
  type HostBrand,
  HostBrandProvider,
} from '../app/[host]/host-brand.context'
import SiteStatusScreen from '../components/site-status-screen.component'

const SITE_LINKS = [
  { href: '/about', label: 'About' },
  { href: '/pricing', label: 'Pricing' },
]

function renderFallback(brand: HostBrand) {
  return render(
    <HostBrandProvider {...brand}>
      <SiteStatusScreen
        search
        code="404"
        title="We can’t find that page"
        message="The link may be out of date."
      />
    </HostBrandProvider>,
  )
}

describe('a site with a name and public pages', () => {
  beforeEach(() => {
    renderFallback({ brandName: 'Acme', siteLinks: SITE_LINKS })
  })

  it('renders the heading as the document’s h1, inside its main landmark', () => {
    const main = screen.getByRole('main')
    expect(
      within(main).getByRole('heading', { level: 1, name: 'We can’t find that page' }),
    ).toBeTruthy()
    expect(document.querySelectorAll('main')).toHaveLength(1)
  })

  it('wears the site’s mark, linking home', () => {
    const banner = screen.getByRole('banner')
    const mark = within(banner).getByRole('link', { name: 'Acme home' })
    expect(mark.getAttribute('href')).toBe('/')
  })

  it('offers the site’s public top-level pages in a nav', () => {
    const nav = screen.getByRole('navigation', { name: 'Site' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/about',
      '/pricing',
    ])
    expect(links.map((link) => link.textContent)).toEqual(['About', 'Pricing'])
  })

  it('offers a plain GET search form that works without JavaScript', () => {
    const form = screen.getByRole('search') as HTMLFormElement
    expect(form.getAttribute('action')).toBe('/search')
    expect(form.getAttribute('method')).toBe('get')
    expect(within(form).getByRole('searchbox').getAttribute('name')).toBe('q')
  })

  it('closes with a footer that always has somewhere to go', () => {
    const footer = screen.getByRole('contentinfo')
    const hrefs = within(footer)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['/', '/about', '/pricing', '/search'])
  })
})

describe('a site with neither a mark nor a public page', () => {
  it('drops the header rather than rendering an empty bar, and keeps the h1 and footer', () => {
    renderFallback({})

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    const footer = screen.getByRole('contentinfo')
    expect(
      within(footer)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/', '/search'])
  })

  it('names no platform anywhere in the page’s copy', () => {
    const { container } = renderFallback({})

    // The COPY, not the markup: the shared MUI wrappers stamp their component
    // class keys (`AglynContainer-root`) into every published page's class
    // attributes, which is a different question from what the page says.
    expect(container.textContent).not.toContain('Aglyn')
  })
})
