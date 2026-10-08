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
import type { ZapierHookView } from '../model/hook-events'
import type { ZapierApi, ZapierCardState } from './zapier-api'
import { ZapierCard } from './zapier-card.component'

jest.mock('./zapier-api', () => ({ useZapierApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async (...args: unknown[]) => void args)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args) }),
}))

const APP = 'https://zapier.com/apps/aglyn/integrations'

const hook = (overrides: Partial<ZapierHookView> = {}): ZapierHookView => ({
  id: 'hook_1',
  object: 'hook',
  siteId: 'h1',
  events: ['order.paid', 'order.refunded'],
  target: 'hooks.zapier.com',
  keyName: 'Zapier',
  created: '2026-10-07T12:00:00.000Z',
  lastDeliveryAt: '2026-10-07T12:05:00.000Z',
  lastDeliveryStatus: 'delivered',
  ...overrides,
})

function api(state: Partial<ZapierCardState> = {}, overrides: Partial<ZapierApi> = {}): ZapierApi {
  return {
    list: jest.fn(async () => ({ configured: true, appUrl: APP, canManage: true, hooks: [hook()], ...state })),
    disconnect: jest.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(() => {
  mockSnack.mockClear()
  mockConfirm.mockClear()
})

describe('the Zapier card (AGL-3643)', () => {
  it('draws nothing until the deployment publishes the app', async () => {
    const routes = api({ configured: false, appUrl: null, hooks: [] })
    const { container } = render(<ZapierCard hostId="h1" api={routes} />)
    await waitFor(() => expect(routes.list).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('draws nothing when the route refuses the member', async () => {
    const routes = api({}, { list: jest.fn(async () => Promise.reject(new Error('You are not a member of this site'))) })
    const { container } = render(<ZapierCard hostId="h1" api={routes} />)
    await waitFor(() => expect(routes.list).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('lists each Zap by what it takes and the key it connected with, and links to the app', async () => {
    render(<ZapierCard hostId="h1" api={api()} />)
    expect(await screen.findByText('Order paid, Order refunded')).toBeTruthy()
    expect(screen.getByText(/API key “Zapier”/)).toBeTruthy()
    expect(screen.getByText('Delivering')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open in Zapier' }).getAttribute('href')).toBe(APP)
  })

  it('says when no Zap takes the site’s records', async () => {
    render(<ZapierCard hostId="h1" api={api({ hooks: [] })} />)
    expect(await screen.findByText('No Zaps take this site’s records yet.')).toBeTruthy()
  })

  it('shows a failing Zap as failing', async () => {
    render(<ZapierCard hostId="h1" api={api({ hooks: [hook({ lastDeliveryStatus: 'failed' })] })} />)
    expect(await screen.findByText('Last delivery failed')).toBeTruthy()
  })

  it('lets an admin disconnect a Zap once they confirm', async () => {
    const routes = api()
    render(<ZapierCard hostId="h1" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(routes.disconnect).toHaveBeenCalledWith('hook_1'))
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('Order paid, Order refunded')).toBeNull())
    expect(mockSnack).toHaveBeenCalledWith('The Zap is disconnected.', expect.anything())
  })

  it('keeps the Zap when the admin backs out, and offers no disconnect to a member who is not one', async () => {
    mockConfirm.mockImplementationOnce(async () => Promise.reject(new Error('cancel')))
    const routes = api()
    const { unmount } = render(<ZapierCard hostId="h1" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(routes.disconnect).not.toHaveBeenCalled()
    unmount()

    render(<ZapierCard hostId="h1" api={api({ canManage: false })} />)
    expect(await screen.findByText('Order paid, Order refunded')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('says why a disconnect did not go through', async () => {
    const routes = api({}, { disconnect: jest.fn(async () => Promise.reject(new Error('That Zap is no longer connected'))) })
    render(<ZapierCard hostId="h1" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText('That Zap is no longer connected')).toBeTruthy()
  })
})
