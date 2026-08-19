/**
 * @jest-environment jsdom
 *
 * Pragmas must stay in the FIRST block comment — behind the license header
 * they are silently ignored.
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
 * A visitor on the fallback error screen can navigate away (AGL-2187).
 *
 * Zach, on the live 404: *"there is no ability to navigate away that is
 * horrible UX"*. Two halves have to hold for that to be fixed, and only one of
 * them is a render:
 *
 * 1. **The screen renders what it is given.** Nav in the header, the same
 *    destinations plus search in the footer — and NOTHING when a site has no
 *    other public page, because an empty `<nav>` is worse than none.
 * 2. **Something gives it.** The links come from `[host]/layout.tsx` through
 *    `HostBrandProvider`. Every render test below injects that context
 *    directly, so all of them stay green if the layout stops passing it and
 *    the live 404 goes back to one button. The wiring assertions at the bottom
 *    are the half that would fail — they read the actual source of the chain.
 *    Each was checked to fail by breaking the link it asserts.
 */

import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HostBrandProvider } from '../app/[host]/host-brand.context'
import SiteStatusScreen from '../components/site-status-screen.component'
import type { SiteNavLink } from '../utils/site-nav'

const LINKS: SiteNavLink[] = [
  { href: '/about', label: 'About' },
  { href: '/pricing', label: 'Pricing' },
]

function renderScreen(
  options: {
    siteLinks?: SiteNavLink[]
    search?: boolean
    brandName?: string
  } = {},
) {
  // `in`, not `??` — a caller passing `brandName: undefined` means "this site
  // set no name", and a default that swallowed it made the no-mark case
  // untestable (it rendered the header and the assertion caught it).
  const brandName =
    'brandName' in options ? options.brandName : 'Northwind Coffee'
  return render(
    <HostBrandProvider
      brandName={brandName}
      siteLinks={options.siteLinks}
    >
      <SiteStatusScreen
        code="404"
        title="We can’t find that page"
        message="The link may be out of date."
        search={options.search}
      />
    </HostBrandProvider>,
  )
}

const hrefsIn = (container: HTMLElement) =>
  within(container)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'))

describe('the fallback error screen offers real navigation (AGL-2187)', () => {
  it('renders the site’s public pages as a header nav', () => {
    renderScreen({ siteLinks: LINKS })
    const nav = screen.getByRole('navigation', { name: 'Site' })
    expect(hrefsIn(nav)).toEqual(['/about', '/pricing'])
    expect(within(nav).getByText('About')).toBeTruthy()
  })

  it('repeats them in a footer, with home and site search', () => {
    const { container } = renderScreen({ siteLinks: LINKS })
    const footer = container.querySelector('footer') as HTMLElement
    expect(footer).toBeTruthy()
    expect(hrefsIn(footer)).toEqual(['/', '/about', '/pricing', '/search'])
  })

  it('renders NO nav element when the site has no other public page', () => {
    // The honest degradation. A site with one page, or one whose pages are all
    // gated, must not get an empty bar — and the footer must still work, which
    // is the assertion that stops this being satisfied by rendering nothing.
    const { container } = renderScreen({ siteLinks: [] })
    expect(screen.queryByRole('navigation')).toBeNull()
    const footer = container.querySelector('footer') as HTMLElement
    expect(hrefsIn(footer)).toEqual(['/', '/search'])
    // The mark is still there and still links home.
    expect(container.querySelector('header')).toBeTruthy()
  })

  it('drops the header entirely for a site with neither a mark nor pages', () => {
    const { container } = renderScreen({ siteLinks: [], brandName: undefined })
    expect(container.querySelector('header')).toBeNull()
    expect(container.querySelector('footer')).toBeTruthy()
  })

  it('posts site search as a plain GET form — no router, no script', () => {
    renderScreen({ siteLinks: LINKS, search: true })
    const form = screen.getByRole('search') as HTMLFormElement
    expect(form.getAttribute('action')).toBe('/search')
    expect(form.getAttribute('method')).toBe('get')
    expect(form.querySelector('input[name="q"]')).toBeTruthy()
  })

  it('omits the search form when the boundary did not ask for it', () => {
    // The 500 case: the search page is served by the runtime that just failed.
    renderScreen({ siteLinks: LINKS })
    expect(screen.queryByRole('search')).toBeNull()
  })

  it('names no platform anywhere a visitor can read (white-label)', () => {
    const { container } = renderScreen({ siteLinks: LINKS, search: true })
    expect(container.textContent ?? '').not.toMatch(/aglyn/i)
    expect(container.textContent ?? '').not.toMatch(/powered by/i)
  })
})

describe('the links actually reach the screen (AGL-2187)', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(__dirname, '..', ...parts), 'utf8')

  it('[host]/layout.tsx resolves the nav and passes it down', () => {
    const layout = read('app', '[host]', 'layout.tsx')
    expect(layout).toMatch(/from '\.\.\/\.\.\/utils\/get-site-nav'/)
    expect(layout).toMatch(/await getSiteNav\(/)
    expect(layout).toMatch(/siteLinks=\{siteLinks\}/)
  })

  it('the theme providers hand siteLinks to HostBrandProvider', () => {
    const providers = read('app', '[host]', 'host-theme-providers.tsx')
    const provider = providers.slice(providers.indexOf('<HostBrandProvider'))
    expect(provider.slice(0, provider.indexOf('>'))).toMatch(
      /siteLinks=\{siteLinks\}/,
    )
  })

  it('the 404 boundary asks for site search and the 500 does not', () => {
    const notFound = read('app', '[host]', 'not-found.tsx')
    const error = read('app', '[host]', 'error.tsx')
    const strip = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(strip(notFound)).toMatch(/^\s*search$/m)
    expect(strip(error)).not.toMatch(/search/)
  })
})
