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
 * `/edit-access` when the SITE ends the page mid-mint (AGL-3734).
 *
 * The site closes the popup, or removes the silent iframe, the moment it has
 * an answer or stops waiting. A mint still in flight is then cancelled:
 *
 * - the request carries a signal, and unmounting aborts it;
 * - the abort lands nowhere — no error phase, no "no" to the parent, and no
 *   rejection left unhandled for the error beacon to page on;
 * - a REAL failure still shows the page's error state.
 */

import { render, screen, waitFor } from '@testing-library/react'
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
const realParent = window.parent
const realOpener = window.opener

/** A fetch that never answers on its own and rejects as a browser does on abort. */
function hangingFetch(): jest.Mock {
  return jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('', 'AbortError')),
        )
      }),
  )
}

describe('/edit-access abort (AGL-3734)', () => {
  let unhandled: jest.Mock
  const onUnhandled = (reason: unknown) => unhandled(reason)

  beforeEach(() => {
    mockUser = { uid: 'user-1', getIdToken: jest.fn(async () => 'id-token') }
    unhandled = jest.fn()
    process.on('unhandledRejection', onUnhandled)
  })

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    Object.defineProperty(window, 'parent', { value: realParent, configurable: true })
    Object.defineProperty(window, 'opener', { value: realOpener, configurable: true })
    jest.restoreAllMocks()
  })

  it('cancels a silent mint on unmount, without a "no" and without a rejection', async () => {
    const postMessage = jest.fn()
    Object.defineProperty(window, 'parent', {
      value: { postMessage },
      configurable: true,
    })
    mockParams = new URLSearchParams(
      `hostId=host-1&origin=${encodeURIComponent(SITE_ORIGIN)}&silent=1`,
    )
    const fetchMock = hangingFetch()
    global.fetch = fetchMock as unknown as typeof fetch
    const { unmount } = render(<EditAccessPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal
    expect(signal).toBeDefined()

    unmount()
    expect(signal?.aborted).toBe(true)
    // Let the rejection settle and any unhandled-rejection hook fire.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(unhandled).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('still shows the error state for a real failure', async () => {
    Object.defineProperty(window, 'opener', {
      value: { postMessage: jest.fn() },
      configurable: true,
    })
    mockParams = new URLSearchParams(
      `hostId=host-1&origin=${encodeURIComponent(SITE_ORIGIN)}`,
    )
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    render(<EditAccessPage />)
    await screen.findByText('Something went wrong')
    expect(unhandled).not.toHaveBeenCalled()
  })
})
