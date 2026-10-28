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

import { registerCustomerDisplayHost } from '@aglyn/aglyn/plugin-manager/plugin-customer-display'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { WaiverCheckInStatus, type PosCheckInZoneProps } from './waiver-check-in-status.component'

const request = jest.fn()

jest.mock('./waivers-api', () => {
  const actual = jest.requireActual('./waivers-api')
  return { ...actual, useWaiversFetch: () => ({ ready: true, request, download: jest.fn() }) }
})
// The name check has its own spec; here it only shows what it was opened on.
jest.mock('./waiver-name-check-dialog.component', () => ({
  __esModule: true,
  default: (props: { name: string; dayKey: string }) => <div>{`Finding ${props.name} on ${props.dayKey}`}</div>,
}))

/**
 * A customer's waiver at the register's check-in (AGL-4042), in commerce's
 * `posCheckIn` zone: the status for the day, how many of the people due it
 * covers, a way to sign there, and nothing for a member who may not see it.
 */

const PROPS: PosCheckInZoneProps = {
  hostId: 'host-1',
  orgId: 'org-1',
  contactId: 'contact-1',
  email: 'jordan@example.com',
  dayKey: '2026-10-24',
  name: 'Jordan Lee',
  unitsDue: 3,
  placement: 'check-in-customer',
}

async function settled(props: PosCheckInZoneProps) {
  await act(async () => {
    render(<WaiverCheckInStatus {...props} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

beforeEach(() => request.mockReset())

describe('the waiver at check-in', () => {
  it('asks by email for the day and the people due, and says when it is signed for everybody', async () => {
    request.mockResolvedValue({ signed: true, coveredNames: ['Jordan Lee'], label: 'Waiver signed' })
    await settled({ ...PROPS, unitsDue: 1 })
    expect(request).toHaveBeenCalledWith('waivers/status', {
      // The contact rides along (AGL-4042): with no email match, the route
      // matches by the birth date the site keeps on it.
      query: { hostId: 'host-1', dayKey: '2026-10-24', email: 'jordan@example.com', contactId: 'contact-1', name: 'Jordan Lee' },
    })
    expect(screen.getByText('Waiver signed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign waiver' })).toBeNull()
  })

  it('names a partial signing and offers to sign the rest', async () => {
    request.mockResolvedValue({ signed: true, coveredNames: ['Jordan Lee', 'Pat Lee'], label: 'Signed for 2 of 3 riders' })
    await settled(PROPS)
    expect(request.mock.calls[0][1].query.people).toBe('3')
    expect(screen.getByText('Signed for 2 of 3 riders')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign waiver' })).toBeTruthy()
  })

  it('looks up by contact without an email, and says when nothing is on file', async () => {
    request.mockResolvedValue({ signed: false, coveredNames: [], label: 'Waiver needed' })
    await settled({ ...PROPS, email: null, placement: 'check-in-row' })
    expect(request.mock.calls[0][1].query.contactId).toBe('contact-1')
    expect(screen.getByText('Waiver needed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign' })).toBeTruthy()
  })

  it('draws nothing for a member the route refuses', async () => {
    const { WaiversRequestError } = jest.requireActual('./waivers-api')
    request.mockRejectedValue(new WaiversRequestError('Not permitted', 403))
    await settled(PROPS)
    expect(screen.queryByText(/Waiver/)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says a customer with no email, no contact and no name has no waiver on file', async () => {
    await settled({ ...PROPS, email: null, contactId: null, name: null })
    expect(request).not.toHaveBeenCalled()
    expect(screen.getByText('Waiver not on file')).toBeTruthy()
  })

  it('says a rider with no email match is not matched, and finds them by name (AGL-4042)', async () => {
    request.mockResolvedValue({
      signed: false,
      coveredNames: [],
      matched: false,
      searchName: 'Pat Lee',
      label: 'Waiver not matched — check by name',
    })
    await settled({ ...PROPS, email: null, contactId: null, name: 'Pat Lee' })
    // By name alone, which the route answers without guessing.
    expect(request.mock.calls[0][1].query).toEqual({ hostId: 'host-1', dayKey: '2026-10-24', name: 'Pat Lee', people: '3' })
    expect(screen.getByText('Waiver not matched — check by name')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find by name' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(screen.getByText('Finding Pat Lee on 2026-10-24')).toBeTruthy()
  })

  it('offers no name search once a signature is matched', async () => {
    request.mockResolvedValue({ signed: false, coveredNames: [], matched: true, searchName: null, label: 'Waiver needed' })
    await settled(PROPS)
    expect(screen.queryByRole('button', { name: 'Find by name' })).toBeNull()
  })

  const GRANT_ID = 'a'.repeat(32)
  /** Every request, answered as the waivers routes would; the grant is open until closed. */
  function routes(options: { open?: () => boolean } = {}) {
    request.mockImplementation(async (route: string, init?: { body?: Record<string, unknown> }) => {
      if (route !== 'waivers/display-grant') return { signed: false, coveredNames: [], label: 'Waiver needed' }
      if (init?.body?.['action'] === 'state') return { open: options.open ? options.open() : true }
      if (init?.body?.['action'] === 'close') return { closed: true }
      return { grant: 'grant-1', grantId: GRANT_ID }
    })
  }
  const grantCalls = (action: string) =>
    request.mock.calls.filter(
      ([route, init]) => route === 'waivers/display-grant' && (init?.body?.action ?? 'open') === action,
    )

  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => jest.useRealTimers())

  it('offers the customer display only while the register has one, and puts the signing on it (AGL-4042)', async () => {
    routes()
    await settled(PROPS)
    expect(screen.queryByRole('button', { name: 'Customer display' })).toBeNull()
    const show = jest.fn(async () => true)
    let withdraw = () => undefined as void
    await act(async () => {
      withdraw = registerCustomerDisplayHost({ show })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Customer display' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(request).toHaveBeenCalledWith('waivers/display-grant', { body: { hostId: 'host-1' } })
    // A grant and the site, never the customer's name or email.
    expect(show).toHaveBeenCalledWith({ pluginId: 'waivers', path: '/display-sign', params: { host: 'host-1', grant: 'grant-1' } })
    expect(screen.getByText('On the customer display')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close display' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Customer display' })).toBeNull()
    // The display leaving the page does not close the grant: staff still can.
    await act(async () => withdraw())
    expect(screen.getByRole('button', { name: 'Close display' })).toBeTruthy()
  })

  it('stays on the display until staff close it: Close display revokes the grant and takes the screen off (AGL-4042)', async () => {
    routes()
    const close = jest.fn(async () => true)
    const withdraw = registerCustomerDisplayHost({ show: async () => true, close })
    await settled(PROPS)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Customer display' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close display' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(grantCalls('close').map(([, init]) => init.body)).toEqual([
      { hostId: 'host-1', action: 'close', grantId: GRANT_ID },
    ])
    expect(close).toHaveBeenCalledWith('waivers')
    expect(screen.queryByRole('button', { name: 'Close display' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Customer display' })).toBeTruthy()
    withdraw()
  })

  it('lets go once the display closes the grant itself, and remembers an open one across a reload', async () => {
    jest.useFakeTimers()
    let open = true
    routes({ open: () => open })
    const withdraw = registerCustomerDisplayHost({ show: async () => true })
    await act(async () => {
      render(<WaiverCheckInStatus {...PROPS} />)
      await jest.advanceTimersByTimeAsync(10)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Customer display' }))
      await jest.advanceTimersByTimeAsync(10)
    })
    // Forty minutes later it is still open, and still asked about.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(40 * 60 * 1000)
    })
    expect(screen.getByRole('button', { name: 'Close display' })).toBeTruthy()
    expect(grantCalls('state').length).toBeGreaterThan(100)
    // A reload of the register still offers Close display for it.
    expect(window.sessionStorage.getItem('aglyn.waivers.displayGrant:host-1:jordan@example.com')).toBe(GRANT_ID)
    open = false
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.queryByRole('button', { name: 'Close display' })).toBeNull()
    expect(window.sessionStorage.getItem('aglyn.waivers.displayGrant:host-1:jordan@example.com')).toBeNull()
    withdraw()
  })

  it('says so when the display does not answer, and leaves no grant open', async () => {
    routes()
    const withdraw = registerCustomerDisplayHost({ show: async () => false })
    await settled(PROPS)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Customer display' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(screen.getByText(/customer display didn’t answer/)).toBeTruthy()
    expect(grantCalls('close')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Close display' })).toBeNull()
    withdraw()
  })
})
