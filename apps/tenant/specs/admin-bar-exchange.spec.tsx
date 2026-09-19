/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://northwind-coffee.aglyn.app/"}
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
 * The auto-armed bar's same-site hint exchange (AGL-1842) — the path that
 * makes the bar appear on `*.aglyn.app` with no chord, no param, and no
 * cross-site iframe. Environment URL is deliberately the failing host from
 * the report.
 *
 * - a 200 exchange renders the bar WITHOUT ever mounting a probe iframe,
 *   and persists the token exactly like a popup/probe delivery would;
 * - a 403 (no rights on this host / dead account) is definitive silence —
 *   no iframe, no context call, nothing rendered;
 * - a 401 (no signed hint — the `aglyn.com` marketing hosts) falls back to
 *   the AGL-1829 iframe probe, pinning that path unchanged;
 * - a network failure also falls back to the probe rather than dying;
 * - a still-valid stored token skips the exchange entirely.
 */

import { render, screen, waitFor } from '@testing-library/react'
import AdminBar from '../app/[host]/admin-bar/admin-bar'
import { editTokenStorageKey } from '../app/[host]/admin-bar/admin-bar-shared'

const HOST = 'host-northwind'
const CONSOLE_ORIGIN = 'https://app.aglyn.com'

const EXCHANGE_RESPONSE = {
  token: 'aglyn-edit-bar-v1.payload.sig',
  expiresAtMs: Date.now() + 60_000,
  siteName: 'Northwind Coffee',
  userEmail: 'editor@aglyn.com',
}

const CONTEXT_RESPONSE = {
  siteName: 'Northwind Coffee',
  screenId: 'screen-1',
  screenName: 'Home',
  versionId: 'v-1',
  editUrl: `${CONSOLE_ORIGIN}/acme/hosts/northwind-coffee/screens/screen-1/versions/v-1/besigner`,
  consoleUrl: `${CONSOLE_ORIGIN}/acme/hosts/northwind-coffee`,
}

type MockRoute = (url: string) => {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

function mockFetch(route: MockRoute): jest.Mock {
  const mock = jest.fn(async (input: RequestInfo | URL) => route(String(input)))
  global.fetch = mock as unknown as typeof fetch
  return mock
}

function renderBar() {
  return render(
    <AdminBar hostId={HOST} consoleOrigin={CONSOLE_ORIGIN} autoConnect />,
  )
}

describe('AdminBar hint exchange (AGL-1842)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders the bar from a 200 exchange with no probe iframe, ever', async () => {
    const fetchMock = mockFetch((url) =>
      url.includes('/api/edit-access/exchange')
        ? { ok: true, status: 200, json: async () => EXCHANGE_RESPONSE }
        : { ok: true, status: 200, json: async () => CONTEXT_RESPONSE },
    )
    const { container } = renderBar()
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Aglyn admin bar' }),
      ).toBeTruthy(),
    )
    // The whole trip was same-site fetches — the console was never framed.
    expect(container.querySelector('iframe')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/edit-access/exchange',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ hostId: HOST }),
      }),
    )
    // Persisted like any other delivery: the next pageview skips all of it.
    const stored = JSON.parse(
      window.localStorage.getItem(editTokenStorageKey(HOST)) ?? 'null',
    )
    expect(stored?.token).toBe(EXCHANGE_RESPONSE.token)
    expect(stored?.userEmail).toBe('editor@aglyn.com')
  })

  it('goes definitively silent on a 403 — no iframe, no context call', async () => {
    const fetchMock = mockFetch((url) =>
      url.includes('/api/edit-access/exchange')
        ? { ok: false, status: 403, json: async () => ({ error: 'No edit access' }) }
        : { ok: true, status: 200, json: async () => CONTEXT_RESPONSE },
    )
    const { container } = renderBar()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(container.querySelector('iframe')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/edit-context',
      expect.anything(),
    )
  })

  it('falls back to the iframe probe on a 401 — the aglyn.com shape', async () => {
    mockFetch((url) =>
      url.includes('/api/edit-access/exchange')
        ? { ok: false, status: 401, json: async () => ({ error: 'No edit hint' }) }
        : { ok: true, status: 200, json: async () => CONTEXT_RESPONSE },
    )
    const { container } = renderBar()
    await waitFor(() =>
      expect(container.querySelector('iframe')).not.toBeNull(),
    )
    const src = container.querySelector('iframe')?.getAttribute('src') ?? ''
    expect(src.startsWith(`${CONSOLE_ORIGIN}/edit-access?`)).toBe(true)
    expect(src).toContain('silent=1')
  })

  it('falls back to the iframe probe when the exchange throws', async () => {
    const mock = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/edit-access/exchange')) {
        throw new Error('network down')
      }
      return { ok: true, status: 200, json: async () => CONTEXT_RESPONSE }
    })
    global.fetch = mock as unknown as typeof fetch
    const { container } = renderBar()
    await waitFor(() =>
      expect(container.querySelector('iframe')).not.toBeNull(),
    )
  })

  it('skips the exchange when a still-valid stored token exists', async () => {
    window.localStorage.setItem(
      editTokenStorageKey(HOST),
      JSON.stringify({
        token: 'aglyn-edit-bar-v1.stored.sig',
        expiresAtMs: Date.now() + 60_000,
        siteName: 'Northwind Coffee',
      }),
    )
    const fetchMock = mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => CONTEXT_RESPONSE,
    }))
    renderBar()
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Aglyn admin bar' }),
      ).toBeTruthy(),
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/edit-access/exchange',
      expect.anything(),
    )
  })
})

/**
 * A MANUAL arm where the hint is (AGL-3047). `?aglyn-edit` — which the
 * console's Visit links add — and the chord arm the bar MANUAL, and a manual
 * arm used to start on the connect button without trying the exchange: the
 * console's own route to a site replaced the bar that the same address shows
 * unprompted with a button in front of it.
 *
 * - a 200 exchange brings the bar straight up, and nothing renders while the
 *   exchange is in flight, so the button never flashes up in front of it;
 * - every failure leaves the button, never silence and never the auto arm's
 *   hidden probe: the editor asked, and the popup can still connect a
 *   console session the hint does not name;
 * - with no hint (a custom domain) the button is there at once, and no
 *   exchange is attempted.
 */
describe('AdminBar manual arm tries the exchange first (AGL-3047)', () => {
  const pill = () =>
    screen.queryByRole('button', { name: 'Connect edit access for this site' })

  const renderManual = () =>
    render(<AdminBar hostId={HOST} consoleOrigin={CONSOLE_ORIGIN} />)

  const exchangeAnswers = (status: number) =>
    mockFetch((url) =>
      url.includes('/api/edit-access/exchange')
        ? status === 200
          ? { ok: true, status, json: async () => EXCHANGE_RESPONSE }
          : { ok: false, status, json: async () => ({ error: 'refused' }) }
        : { ok: true, status: 200, json: async () => CONTEXT_RESPONSE },
    )

  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = 'aglyn_editor=1; Path=/'
  })

  afterEach(() => {
    document.cookie = 'aglyn_editor=; Max-Age=0; Path=/'
    jest.restoreAllMocks()
  })

  it('brings the bar straight up from a 200 exchange — no button, no popup', async () => {
    const open = jest.spyOn(window, 'open')
    const fetchMock = exchangeAnswers(200)
    const { container } = renderManual()
    expect(container.innerHTML).toBe('')
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Aglyn admin bar' }),
      ).toBeTruthy(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/edit-access/exchange',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(pill()).toBeNull()
    expect(open).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it.each([
    [401, 'no usable hint'],
    [403, 'an account that cannot edit this site'],
    [404, 'nothing to exchange here'],
    [500, 'a server error'],
  ])('leaves the connect button on a %s — %s', async (status) => {
    exchangeAnswers(status)
    const { container } = renderManual()
    await waitFor(() => expect(pill()).not.toBeNull())
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('leaves the connect button when the exchange throws', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const { container } = renderManual()
    await waitFor(() => expect(pill()).not.toBeNull())
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('shows the button at once with no hint — a custom domain — and never exchanges', () => {
    document.cookie = 'aglyn_editor=; Max-Age=0; Path=/'
    const fetchMock = exchangeAnswers(200)
    renderManual()
    expect(pill()).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
