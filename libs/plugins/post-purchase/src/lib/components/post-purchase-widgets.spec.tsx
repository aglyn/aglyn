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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PostPurchaseOrderWidget } from './post-purchase-order-widget.component'
import { PostPurchaseSettingsCards } from './post-purchase-settings-card.component'

/**
 * The console widgets post-purchase puts in commerce's zones. Each renders
 * NOTHING until the deployment offers a service — that is what keeps
 * AfterShip, Route and Narvar invisible where the environment is not set —
 * and then one card per offered service, credentials going in and never
 * shown back.
 */

let availability = { loading: false, available: false, vendors: [] as string[] }
const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./post-purchase-api', () => ({
  ...jest.requireActual('./post-purchase-api'),
  usePostPurchaseAvailability: () => availability,
  usePostPurchaseFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const SETTINGS = {
  aftership: { enabled: false, connected: false, trackingPageUrl: null },
  route: { enabled: true, connected: true, defaultSelected: false },
  narvar: { enabled: false, connected: false, retailerMoniker: null },
}

beforeEach(() => {
  request.mockReset()
  enqueueSnackbar.mockReset()
  availability = { loading: false, available: false, vendors: [] }
})

describe('PostPurchaseSettingsCards', () => {
  it('draws nothing where the deployment offers no service', () => {
    const { container } = render(<PostPurchaseSettingsCards hostId="host-1" />)
    expect(container.innerHTML).toBe('')
    expect(request).not.toHaveBeenCalled()
  })

  it('draws a card per offered service with its state, and saves a change in the card’s header', async () => {
    availability = { loading: false, available: true, vendors: ['aftership', 'route'] }
    request.mockResolvedValue({ settings: SETTINGS, vendors: ['aftership', 'route'] })
    render(<PostPurchaseSettingsCards hostId="host-1" />)
    expect(await screen.findByText('Route')).toBeTruthy()
    expect(screen.getByText('AfterShip')).toBeTruthy()
    expect(screen.queryByText('Narvar')).toBeNull()
    expect(screen.getByTestId('post-purchase-route-status').textContent).toBe('On')
    expect(screen.getByTestId('post-purchase-aftership-status').textContent).toBe('Not connected')
    expect(screen.getByLabelText('Secret token').getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByLabelText('Tick the protection box in the cart by default'))
    const saves = screen.getAllByRole('button', { name: 'Save' })
    fireEvent.click(saves[1])
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('post-purchase/settings', {
        body: { hostId: 'host-1', change: { vendor: 'route', defaultSelected: true } },
      }),
    )
  })
})

describe('PostPurchaseOrderWidget', () => {
  it('draws nothing where nothing is offered, or for an order no service touched', async () => {
    const { container, rerender } = render(<PostPurchaseOrderWidget hostId="host-1" order={{ id: 'o-1' }} />)
    expect(container.innerHTML).toBe('')
    availability = { loading: false, available: true, vendors: ['route'] }
    request.mockResolvedValue({ order: { protection: null, trackedParcels: [], narvar: null } })
    rerender(<PostPurchaseOrderWidget hostId="host-1" order={{ id: 'o-2' }} />)
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('says whether the buyer’s protection is open, and which parcels are followed', async () => {
    availability = { loading: false, available: true, vendors: ['route', 'aftership'] }
    request.mockResolvedValue({
      order: {
        protection: { status: 'registered', premiumCents: 198, policyId: 'pol_1', error: null },
        trackedParcels: [{ trackingNumber: '1Z999', vendor: 'aftership', atMs: 1 }],
        narvar: null,
      },
    })
    render(<PostPurchaseOrderWidget hostId="host-1" order={{ id: 'o-1', currency: 'usd' }} />)
    expect((await screen.findByTestId('post-purchase-protection-status')).textContent).toBe('Covered')
    expect(screen.getByText(/Route policy pol_1/)).toBeTruthy()
    expect(screen.getByText('1Z999 · followed by AfterShip')).toBeTruthy()
  })
})
