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
      query: { hostId: 'host-1', dayKey: '2026-10-24', email: 'jordan@example.com' },
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

  it('says a customer with no email and no contact has no waiver on file', async () => {
    await settled({ ...PROPS, email: null, contactId: null })
    expect(request).not.toHaveBeenCalled()
    expect(screen.getByText('Waiver not on file')).toBeTruthy()
  })

  it('offers the customer display only while the register has one, and puts the signing on it (AGL-4042)', async () => {
    request.mockImplementation(async (route: string) =>
      route === 'waivers/display-grant'
        ? { grant: 'grant-1', expiresAtMs: 1 }
        : { signed: false, coveredNames: [], label: 'Waiver needed' },
    )
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
    expect(screen.getByRole('button', { name: 'On the customer display' })).toBeTruthy()
    await act(async () => withdraw())
    expect(screen.queryByRole('button', { name: /customer display/i })).toBeNull()
  })

  it('says so when the display does not answer', async () => {
    request.mockImplementation(async (route: string) =>
      route === 'waivers/display-grant' ? { grant: 'grant-1' } : { signed: false, coveredNames: [], label: 'Waiver needed' },
    )
    const withdraw = registerCustomerDisplayHost({ show: async () => false })
    await settled(PROPS)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Customer display' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(screen.getByText(/customer display didn’t answer/)).toBeTruthy()
    withdraw()
  })
})
