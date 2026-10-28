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

import { act, fireEvent, render, screen } from '@testing-library/react'
import { CUSTOMER_DISPLAY_CREDENTIAL_KEY } from '@aglyn/aglyn/plugin-manager/plugin-customer-display'
import type { ReactNode } from 'react'
import {
  WAIVER_DISPLAY_FOLLOW_MS,
  WAIVER_DISPLAY_THANKS_MS,
  WaiverDisplayPage,
  waiverDisplayNavigation,
} from './waiver-display-page.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: null }) }))

/**
 * The signing flow itself (the form, the signature pad) has its own specs;
 * here it is a stand-in that signs on a press and shows the page's own
 * after-signing actions, so what is tested is the page: what it sends, how
 * it follows the register, and when it goes back.
 */
jest.mock('./waiver-sign-flow.component', () => {
  const { useState } = jest.requireActual('react')
  return {
    WaiverSignFlow: (props: {
      hostId: string
      submit: (payload: Record<string, unknown>) => Promise<unknown>
      doneActions: (reset: () => void) => ReactNode
    }) => {
      const [done, setDone] = useState(false)
      if (done) return <div>{props.doneActions(() => setDone(false))}</div>
      return (
        <button
          onClick={() => void props.submit({ waiverId: 'w1', attemptKey: 'a-1' }).then(() => setDone(true), () => undefined)}
        >
          {`Sign for ${props.hostId}`}
        </button>
      )
    },
  }
})

/**
 * Signing on a register's customer display (AGL-4042), at
 * `/kiosk/waivers/display-sign?host=…`: the paired display is the
 * authorization, so the page signs with the display's own credential (core
 * keeps it on the display), stays however long the rider takes with nothing
 * to open or close, follows the register (back once it shows something
 * else), and goes back a few seconds after a signing.
 */

const CREDENTIAL = 'display-token-0123456789abcdefghijklmnopqrstu'
const RETURN = '/kiosk/commerce/pos-display'
const leave = jest.spyOn(waiverDisplayNavigation, 'leave').mockImplementation(() => undefined)
const posted: Array<{ url: string; body: Record<string, unknown> | null }> = []

/** Whether the register still shows this waiver, as the server answers; `null` for a failed answer. */
let showing: boolean | null = true

beforeEach(() => {
  jest.useFakeTimers()
  leave.mockClear()
  posted.length = 0
  showing = true
  window.localStorage.setItem(CUSTOMER_DISPLAY_CREDENTIAL_KEY, CREDENTIAL)
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    posted.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    if (String(url) === '/api/waivers/display-screen') {
      return showing === null
        ? { ok: false, status: 500, json: async () => ({ error: 'down' }) }
        : { ok: true, status: 200, json: async () => ({ showing }) }
    }
    return { ok: true, status: 201, json: async () => ({ received: true, people: ['Jordan Lee'] }) }
  }) as never
})

afterEach(() => {
  jest.useRealTimers()
  window.localStorage.clear()
})

const follows = () => posted.filter((call) => call.url === '/api/waivers/display-screen')

async function open(search: string) {
  window.history.pushState({}, '', `/kiosk/waivers/display-sign${search}`)
  await act(async () => {
    render(<WaiverDisplayPage pluginId="waivers" path="/display-sign" />)
    await jest.advanceTimersByTimeAsync(30)
  })
}

async function wait(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

describe('the customer display’s waiver page', () => {
  it('stays however long the rider takes: nothing runs out, and no Cancel takes it away', async () => {
    await open(`?host=host-1&return=${encodeURIComponent(RETURN)}`)
    expect(screen.getByRole('button', { name: 'Sign for host-1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    // Forty minutes of talking: still here, following the register the whole time.
    await wait(40 * 60 * 1000)
    expect(leave).not.toHaveBeenCalled()
    expect(follows().length).toBeGreaterThan(700)
    expect(follows()[0].body).toEqual({ hostId: 'host-1', display: CREDENTIAL })
  })

  it('signs ten minutes later with the display’s own credential, then thanks the rider and goes back', async () => {
    await open(`?host=host-1&return=${encodeURIComponent(RETURN)}`)
    await wait(10 * 60 * 1000)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign for host-1' }))
      await jest.advanceTimersByTimeAsync(0)
    })
    const signing = posted.find((call) => call.url === '/api/waivers/sign-on-display')
    expect(signing?.body).toEqual({ waiverId: 'w1', attemptKey: 'a-1', hostId: 'host-1', display: CREDENTIAL })
    expect(screen.getByRole('button', { name: 'Next signer' })).toBeTruthy()
    // Only once signed does anything go back on its own.
    await wait(WAIVER_DISPLAY_THANKS_MS - 1)
    expect(leave).not.toHaveBeenCalled()
    await wait(1)
    expect(leave).toHaveBeenCalledWith(RETURN)
  })

  it('goes back once the register shows something else, and never for a missed answer', async () => {
    await open(`?host=host-1&return=${encodeURIComponent(RETURN)}`)
    showing = null
    await wait(WAIVER_DISPLAY_FOLLOW_MS * 5)
    expect(leave).not.toHaveBeenCalled()
    showing = false
    await wait(WAIVER_DISPLAY_FOLLOW_MS)
    expect(leave).toHaveBeenCalledWith(RETURN)
  })

  it('never goes back anywhere but a display’s own page', async () => {
    await open('?host=host-1&return=https%3A%2F%2Fevil.example.com')
    showing = false
    await wait(WAIVER_DISPLAY_FOLLOW_MS * 3)
    expect(leave).not.toHaveBeenCalled()
  })

  it('says a device that is not a paired display cannot sign here', async () => {
    window.localStorage.clear()
    await open(`?host=host-1&return=${encodeURIComponent(RETURN)}`)
    expect(screen.getByText(/isn’t paired with the store’s register/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign for host-1' })).toBeNull()
    await wait(WAIVER_DISPLAY_FOLLOW_MS * 3)
    expect(posted).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(leave).toHaveBeenCalledWith(RETURN)
  })
})
