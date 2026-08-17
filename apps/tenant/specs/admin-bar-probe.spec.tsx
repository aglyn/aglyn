/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.aglyn.com/"}
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
 * The admin bar's silent probe (AGL-1829), driven end-to-end in jsdom with
 * a faked iframe handshake:
 *
 * - auto-armed, the bar mounts ONLY a hidden iframe at the console's
 *   `/edit-access?silent=1` — no pill, no visible UI;
 * - a token postMessaged from a WRONG origin is ignored even mid-probe
 *   (the origin check is the trust boundary — this test is the one that
 *   must fail if it is ever loosened);
 * - the console origin's token is redeemed at `/api/edit-context` and the
 *   bar renders, with the token persisted for the next pageview;
 * - the console origin's explicit "no" tears everything down to nothing;
 * - the probe times out to nothing rather than hanging;
 * - manual arming still shows the connect pill and never a probe iframe.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import AdminBar from '../app/[host]/admin-bar/admin-bar'
import { editTokenStorageKey } from '../app/[host]/admin-bar/admin-bar-shared'

const HOST = 'host-1'
const CONSOLE_ORIGIN = 'https://app.aglyn.com'

const CONTEXT_RESPONSE = {
  siteName: 'Aglyn Marketing',
  screenId: 'screen-1',
  screenName: 'Home',
  versionId: 'v-1',
  editUrl: `${CONSOLE_ORIGIN}/acme/hosts/www/screens/screen-1/versions/v-1/besigner`,
  consoleUrl: `${CONSOLE_ORIGIN}/acme/hosts/www`,
}

function postFromOrigin(origin: string, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }))
  })
}

const TOKEN_MESSAGE = {
  type: 'aglyn-edit-access',
  token: 'aglyn-edit-bar-v1.payload.sig',
  expiresAtMs: Date.now() + 60_000,
  siteName: 'Aglyn Marketing',
  userEmail: 'editor@aglyn.com',
}

function renderBar(autoConnect: boolean) {
  return render(
    <AdminBar
      hostId={HOST}
      consoleOrigin={CONSOLE_ORIGIN}
      autoConnect={autoConnect}
    />,
  )
}

describe('AdminBar silent probe (AGL-1829)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CONTEXT_RESPONSE,
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('auto-armed mounts only the hidden silent iframe', () => {
    const { container } = renderBar(true)
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const src = iframe?.getAttribute('src') ?? ''
    expect(src.startsWith(`${CONSOLE_ORIGIN}/edit-access?`)).toBe(true)
    expect(src).toContain(`hostId=${HOST}`)
    expect(src).toContain(encodeURIComponent('https://www.aglyn.com'))
    expect(src).toContain('silent=1')
    expect(iframe?.style.display).toBe('none')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('ignores a token from any origin but the console', async () => {
    const { container } = renderBar(true)
    postFromOrigin('https://evil.example', TOKEN_MESSAGE)
    // Not redeemed, not stored, still probing.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('redeems the console-origin token and renders the bar', async () => {
    renderBar(true)
    postFromOrigin(CONSOLE_ORIGIN, TOKEN_MESSAGE)
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Aglyn admin bar' }),
      ).toBeTruthy(),
    )
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/edit-context',
      expect.objectContaining({ method: 'POST' }),
    )
    // Persisted for the next pageview (localStorage — new tabs included).
    const stored = JSON.parse(
      window.localStorage.getItem(editTokenStorageKey(HOST)) ?? 'null',
    )
    expect(stored?.token).toBe(TOKEN_MESSAGE.token)
    expect(stored?.userEmail).toBe('editor@aglyn.com')
  })

  it("tears down to nothing on the console's explicit no", () => {
    const { container } = renderBar(true)
    postFromOrigin(CONSOLE_ORIGIN, {
      type: 'aglyn-edit-access-result',
      ok: false,
    })
    expect(container.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('times out to nothing rather than hanging', () => {
    jest.useFakeTimers()
    const { container } = renderBar(true)
    expect(container.querySelector('iframe')).not.toBeNull()
    act(() => {
      jest.advanceTimersByTime(10_001)
    })
    expect(container.innerHTML).toBe('')
  })

  it('manual arming shows the pill and never a probe iframe', () => {
    const { container } = renderBar(false)
    expect(container.querySelector('iframe')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: 'Connect edit access for this site',
      }),
    ).toBeTruthy()
  })
})
