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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WAIVER_DISPLAY_CHECK_MS, WaiverDisplayPage, waiverDisplayNavigation } from './waiver-display-page.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: null }) }))

/**
 * Signing on a register's customer display (AGL-4042), at
 * `/kiosk/waivers/display-sign`: the site's waivers as the public route
 * serves them, signed with the grant the console minted, open until staff
 * close it (no timer), and back to the display's own screen, closing the
 * grant, when the rider is done or cancels.
 */

const leave = jest.spyOn(waiverDisplayNavigation, 'leave').mockImplementation(() => undefined)
const posted: Array<{ url: string; body: Record<string, unknown> | null }> = []

const WAIVER_ANSWER = {
  site: { name: 'Acme Motocross' },
  waiver: { id: 'w1', version: 1, title: 'Rider release', body: 'Ride safe.', checkboxes: [], allowMinors: false, validityText: 'Good for one visit' },
  consent: { text: 'I agree.', version: 1 },
  adultAge: 18,
  signUrl: null,
}

/** Whether the display's grant is still open, as the server answers. */
let grantOpen = true

beforeEach(() => {
  leave.mockClear()
  posted.length = 0
  grantOpen = true
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    posted.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    const body = String(url).includes('waiverId')
      ? WAIVER_ANSWER
      : String(url).startsWith('/api/waivers/display-grant-state')
        ? { open: grantOpen }
        : String(url).startsWith('/api/waivers/public')
          ? { site: { name: 'Acme Motocross' }, waivers: [{ id: 'w1', title: 'Rider release' }], signUrl: null }
          : {}
    return { ok: true, status: 200, json: async () => body }
  }) as never
})

afterEach(() => jest.useRealTimers())

const stateCalls = () => posted.filter((call) => call.url === '/api/waivers/display-grant-state')

async function open(search: string) {
  window.history.pushState({}, '', `/kiosk/waivers/display-sign${search}`)
  await act(async () => {
    render(<WaiverDisplayPage pluginId="waivers" path="/display-sign" />)
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

describe('the customer display’s waiver page', () => {
  it('opens the site’s waiver from the public route, and cancels back to the display, closing its grant', async () => {
    await open('?host=host-1&grant=g.1&return=%2Fkiosk%2Fcommerce%2Fpos-display')
    expect(posted[0].url).toBe('/api/waivers/public?hostId=host-1')
    expect(screen.getByRole('heading', { name: 'Rider release' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(leave).toHaveBeenCalledWith('/kiosk/commerce/pos-display'))
    expect(stateCalls().map((call) => call.body)).toEqual([{ grant: 'g.1', hostId: 'host-1', close: true }])
  })

  it('stays open with no timer, and goes back once staff close it (AGL-4042)', async () => {
    jest.useFakeTimers()
    window.history.pushState({}, '', '/kiosk/waivers/display-sign?host=host-1&grant=g.1&return=%2Fkiosk%2Fcommerce%2Fpos-display')
    await act(async () => {
      render(<WaiverDisplayPage pluginId="waivers" path="/display-sign" />)
      await jest.advanceTimersByTimeAsync(30)
    })
    // Forty minutes of reading: still here, still asking.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(40 * 60 * 1000)
    })
    expect(leave).not.toHaveBeenCalled()
    expect(stateCalls().length).toBeGreaterThan(400)
    expect(stateCalls().every((call) => call.body?.['close'] === undefined)).toBe(true)
    grantOpen = false
    await act(async () => {
      await jest.advanceTimersByTimeAsync(WAIVER_DISPLAY_CHECK_MS)
    })
    expect(leave).toHaveBeenCalledWith('/kiosk/commerce/pos-display')
    expect(screen.getByText(/Staff closed this screen/)).toBeTruthy()
  })

  it('never goes back anywhere but a display’s own page', async () => {
    await open('?host=host-1&grant=g.1&return=https%3A%2F%2Fevil.example.com')
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('says the screen was closed without a grant', async () => {
    await open('?host=host-1&return=%2Fkiosk%2Fcommerce%2Fpos-display')
    expect(posted).toHaveLength(0)
    expect(screen.getByText(/Staff closed this screen/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(leave).toHaveBeenCalledWith('/kiosk/commerce/pos-display')
  })
})
