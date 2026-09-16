/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://app.aglyn.com/edit-access"}
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
 * `/edit-access?silent=1` — the hidden-iframe half of the admin bar's
 * auto-connect (AGL-1829). The claims pinned here:
 *
 * - silent success delivers the SAME origin-checked token payload as the
 *   popup, to `window.parent` instead of `window.opener`;
 * - the server's origins allowlist still gates delivery — an origin the
 *   server did not list gets a content-free "no", never the token;
 * - signed out, the "no" is sent without ever minting;
 * - un-framed (`window.parent === window`), silent mode delivers nothing —
 *   there is no parent to talk to and no visible UI to fall back on;
 * - the visible popup flow is untouched: success still posts to the opener.
 *
 * And the popup's own half (AGL-3046):
 *
 * - a popup with no opener mints nothing and says there is nothing to
 *   connect, instead of reporting "Connected" to nobody;
 * - a delivered popup stays open — the SITE closes it — so whether it
 *   closes can never tell an opener that this visitor may edit the host.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import EditAccessPage from '../app/edit-access/page'

let mockParams: URLSearchParams
jest.mock('next/navigation', () => ({
  __esModule: true,
  useSearchParams: () => mockParams,
}))

let mockUser: unknown
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

const SITE_ORIGIN = 'https://www.aglyn.com'
const TOKEN_RESPONSE = {
  token: 'aglyn-edit-bar-v1.payload.sig',
  expiresAtMs: 1234567890,
  origins: [SITE_ORIGIN],
  siteName: 'Aglyn Marketing',
  userEmail: 'editor@aglyn.com',
}

const realParent = window.parent
const realOpener = window.opener

function frameWindow(): jest.Mock {
  const postMessage = jest.fn()
  Object.defineProperty(window, 'parent', {
    value: { postMessage },
    configurable: true,
  })
  return postMessage
}

function unframeWindow(): void {
  Object.defineProperty(window, 'parent', {
    value: window,
    configurable: true,
  })
}

describe('/edit-access silent mode (AGL-1829)', () => {
  beforeEach(() => {
    mockParams = new URLSearchParams(
      `hostId=host-1&origin=${encodeURIComponent(SITE_ORIGIN)}&silent=1`,
    )
    mockUser = {
      uid: 'user-1',
      getIdToken: jest.fn(async () => 'id-token'),
    }
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => TOKEN_RESPONSE,
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      value: realParent,
      configurable: true,
    })
    Object.defineProperty(window, 'opener', {
      value: realOpener,
      configurable: true,
    })
    jest.restoreAllMocks()
  })

  it('delivers the token to the parent frame, origin-checked, rendering nothing', async () => {
    const postMessage = frameWindow()
    const { container } = render(<EditAccessPage />)
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'aglyn-edit-access',
          token: TOKEN_RESPONSE.token,
          expiresAtMs: TOKEN_RESPONSE.expiresAtMs,
          siteName: TOKEN_RESPONSE.siteName,
          userEmail: TOKEN_RESPONSE.userEmail,
        },
        SITE_ORIGIN,
      ),
    )
    // Hidden iframe: no visible copy, and no signin link to clickjack.
    expect(container.textContent).toBe('')
  })

  it('refuses an origin the server did not list — a "no", never the token', async () => {
    const postMessage = frameWindow()
    mockParams = new URLSearchParams(
      'hostId=host-1&origin=https%3A%2F%2Fevil.example&silent=1',
    )
    render(<EditAccessPage />)
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'aglyn-edit-access-result', ok: false },
        'https://evil.example',
      ),
    )
    for (const call of postMessage.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain(TOKEN_RESPONSE.token)
    }
  })

  it('answers "no" when signed out, without minting', async () => {
    const postMessage = frameWindow()
    mockUser = null
    render(<EditAccessPage />)
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'aglyn-edit-access-result', ok: false },
        SITE_ORIGIN,
      ),
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('delivers nothing when silent but not framed', async () => {
    unframeWindow()
    const opener = jest.fn()
    Object.defineProperty(window, 'opener', {
      value: { postMessage: opener },
      configurable: true,
    })
    render(<EditAccessPage />)
    // Settle any async work, then assert silence on every channel.
    await waitFor(() => expect(true).toBe(true))
    expect(opener).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('keeps the popup flow on the opener', async () => {
    const parentPost = frameWindow()
    const opener = jest.fn()
    Object.defineProperty(window, 'opener', {
      value: { postMessage: opener },
      configurable: true,
    })
    mockParams = new URLSearchParams(
      `hostId=host-1&origin=${encodeURIComponent(SITE_ORIGIN)}`,
    )
    render(<EditAccessPage />)
    await waitFor(() =>
      expect(opener).toHaveBeenCalledWith(
        expect.objectContaining({ token: TOKEN_RESPONSE.token }),
        SITE_ORIGIN,
      ),
    )
    expect(parentPost).not.toHaveBeenCalled()
  })
})

describe('/edit-access popup (AGL-3046)', () => {
  beforeEach(() => {
    mockParams = new URLSearchParams(
      `hostId=host-1&origin=${encodeURIComponent(SITE_ORIGIN)}`,
    )
    mockUser = {
      uid: 'user-1',
      getIdToken: jest.fn(async () => 'id-token'),
    }
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => TOKEN_RESPONSE,
    })) as unknown as typeof fetch
    // A top-level window: the popup is never framed.
    unframeWindow()
  })

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      value: realParent,
      configurable: true,
    })
    Object.defineProperty(window, 'opener', {
      value: realOpener,
      configurable: true,
    })
    jest.restoreAllMocks()
  })

  it('mints nothing with no opener, and says there is nothing to connect', async () => {
    // A severed opener looks exactly like this from inside the popup. The
    // page used to mint, post to `null`, and announce "Connected".
    Object.defineProperty(window, 'opener', {
      value: null,
      configurable: true,
    })
    render(<EditAccessPage />)
    expect(await screen.findByText('Nothing to connect')).toBeTruthy()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByText('Connected')).toBeNull()
  })

  it('stays open after delivering — closing is the site’s job', async () => {
    const close = jest
      .spyOn(window, 'close')
      .mockImplementation(() => undefined)
    const opener = jest.fn()
    Object.defineProperty(window, 'opener', {
      value: { postMessage: opener },
      configurable: true,
    })
    render(<EditAccessPage />)
    await waitFor(() =>
      expect(opener).toHaveBeenCalledWith(
        expect.objectContaining({ token: TOKEN_RESPONSE.token }),
        SITE_ORIGIN,
      ),
    )
    expect(await screen.findByText('Connected')).toBeTruthy()
    // Past the 1.2 s the page used to wait before closing on success.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    })
    expect(close).not.toHaveBeenCalled()
  })
})
