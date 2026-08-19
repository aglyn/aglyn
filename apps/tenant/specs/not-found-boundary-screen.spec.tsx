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
 * Which body a 404 gets, and from where (AGL-2342).
 *
 * The status code is asserted next door in `not-found-screen.spec.ts`, against
 * the loader. This is the other half: given a host that HAS a designed 404
 * screen, the visitor must get that screen — and given one that has not, the
 * navigable platform fallback, never a blank page.
 *
 * ## Why the renderer is stubbed and the fetch is not
 *
 * `CatchAllClient` renders besigner nodes and is exercised by every screen test
 * in this app; re-testing it here would only assert that MUI still works. What
 * is on trial is the CHOICE — which of the two bodies mounts, off which
 * response — so the stub records what it was handed and the fetch is a real
 * `fetch` mock returning real response shapes, including the 404 that selects
 * the fallback.
 */

jest.mock('../app/[host]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: ({ nodes }: { nodes: Record<string, unknown> | null }) => (
    <div data-testid="designed-screen" data-node-ids={Object.keys(nodes ?? {}).join(',')}>
      designed screen
    </div>
  ),
}))

import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HostBrandProvider } from '../app/[host]/host-brand.context'
import SiteNotFound from '../components/site-not-found.component'
import type { SiteNavLink } from '../utils/site-nav'

const LINKS: SiteNavLink[] = [
  { href: '/about', label: 'About' },
  { href: '/pricing', label: 'Pricing' },
]

/** What `/api/screen/not-found` returns for a host that designed one. */
const DESIGNED_PAYLOAD = {
  data: { host: { $id: 'host-1' }, screen: { data: { $id: 'nf' } } },
  nodes: { root: {}, nav: {}, foot: {} },
  notFoundFallback: true,
}

function mockFetch(
  responder: (url: string) => { ok: boolean; status: number; body?: unknown },
) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const answer = responder(String(input))
    return {
      ok: answer.ok,
      status: answer.status,
      json: async () => answer.body,
    } as unknown as Response
  })
  ;(global as any).fetch = fetchMock
  return fetchMock
}

function renderBoundary(options: { hostKey?: string } = {}) {
  // `in`, not `??` — a caller passing `hostKey: undefined` means "this render
  // is above a resolved host", and a default that swallowed it would make the
  // no-host case untestable.
  const hostKey =
    'hostKey' in options ? options.hostKey : 'cname--acme.example'
  return render(
    <HostBrandProvider
      brandName="Northwind Coffee"
      siteLinks={LINKS}
      hostKey={hostKey}
    >
      <SiteNotFound
        code="404"
        title="We can’t find that page"
        message="The link may be out of date."
      />
    </HostBrandProvider>,
  )
}

afterEach(() => {
  delete (global as any).fetch
})

describe('half 1 — the host’s designed 404 screen is what renders', () => {
  it('fetches it by host key and mounts it', async () => {
    const fetchMock = mockFetch(() => ({
      ok: true,
      status: 200,
      body: DESIGNED_PAYLOAD,
    }))

    renderBoundary()

    const designed = await screen.findByTestId('designed-screen')
    expect(designed.getAttribute('data-node-ids')).toBe('root,nav,foot')
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/api/screen/not-found?host=cname--acme.example',
    )
  })

  it('does not ALSO show the platform fallback', async () => {
    // Both bodies rendering is its own defect: the visitor would see the site's
    // page with a second, chrome-less error page stacked under it.
    mockFetch(() => ({ ok: true, status: 200, body: DESIGNED_PAYLOAD }))

    renderBoundary()

    await screen.findByTestId('designed-screen')
    expect(screen.queryByRole('search')).toBeNull()
    expect(screen.queryByText('We can’t find that page')).toBeNull()
  })

  it('shows neither body while the answer is unknown', async () => {
    // No flash of the fallback before the site's own page replaces it.
    let release: (() => void) | undefined
    ;(global as any).fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => DESIGNED_PAYLOAD,
            } as unknown as Response)
        }),
    )

    const { container } = renderBoundary()

    expect(container.querySelector('header')).toBeNull()
    expect(screen.queryByTestId('designed-screen')).toBeNull()
    release?.()
    await screen.findByTestId('designed-screen')
  })
})

describe('half 2 — a host with no designed screen keeps the fallback', () => {
  it('renders the navigable platform screen when the API says 404', async () => {
    mockFetch(() => ({ ok: false, status: 404, body: { error: 'Not found' } }))

    const { container } = renderBoundary()

    await waitFor(() =>
      expect(container.querySelector('footer')).toBeTruthy(),
    )
    // The whole of Zach's complaint, asserted positively: a way out.
    expect(screen.getByRole('navigation', { name: 'Site' })).toBeTruthy()
    expect(screen.getByRole('search')).toBeTruthy()
    expect(screen.queryByTestId('designed-screen')).toBeNull()
  })

  it('renders the fallback when the fetch itself fails', async () => {
    ;(global as any).fetch = jest.fn(async () => {
      throw new Error('offline')
    })

    const { container } = renderBoundary()

    await waitFor(() =>
      expect(container.querySelector('footer')).toBeTruthy(),
    )
    expect(screen.queryByTestId('designed-screen')).toBeNull()
  })

  it('renders the fallback when the payload carries no nodes', async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      body: { ...DESIGNED_PAYLOAD, nodes: null },
    }))

    const { container } = renderBoundary()

    await waitFor(() =>
      expect(container.querySelector('footer')).toBeTruthy(),
    )
    expect(screen.queryByTestId('designed-screen')).toBeNull()
  })

  it('renders the fallback, and asks for nothing, with no host key', async () => {
    // The boundary can render above a resolved host. It must degrade, not hang
    // on a request it cannot address.
    const fetchMock = mockFetch(() => ({ ok: true, status: 200, body: {} }))

    const { container } = renderBoundary({ hostKey: undefined })

    await waitFor(() =>
      expect(container.querySelector('footer')).toBeTruthy(),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the host key actually reaches the boundary (AGL-2342)', () => {
  // Every render above injects the context directly, so all of them stay green
  // if the layout stops publishing it and the live 404 goes back to the
  // fallback on every site. These read the real chain.
  const read = (...parts: string[]) =>
    readFileSync(join(__dirname, '..', ...parts), 'utf8')

  it('[host]/layout.tsx passes the route param down', () => {
    expect(read('app', '[host]', 'layout.tsx')).toMatch(/hostKey=\{host\}/)
  })

  it('the theme providers forward it to HostBrandProvider', () => {
    const providers = read('app', '[host]', 'host-theme-providers.tsx')
    const provider = providers.slice(providers.indexOf('<HostBrandProvider'))
    expect(provider.slice(0, provider.indexOf('>'))).toMatch(
      /hostKey=\{hostKey\}/,
    )
  })

  it('HostBrandProvider puts it in the context value', () => {
    const context = read('app', '[host]', 'host-brand.context.tsx')
    const value = context.slice(
      context.indexOf('const value'),
      context.indexOf('return ('),
    )
    // Both halves: destructured off the props, and put in the memoised value.
    // Adding it to the interface alone compiles and publishes nothing.
    expect(value).toMatch(/hostKey/)
    expect(context).toMatch(/^\s*hostKey,$/m)
  })

  it('the 404 boundary renders SiteNotFound, not the fallback directly', () => {
    const boundary = read('app', '[host]', 'not-found.tsx')
    const code = boundary
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/<SiteNotFound/)
    expect(code).not.toMatch(/<SiteStatusScreen/)
  })
})
