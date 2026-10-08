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

/**
 * The POS devices card (AGL-3607, AGL-3608): card readers are offered only
 * where the server says they are available, a reader is added with the code
 * it shows (and the store's address for the first one), and a paired
 * customer display can be signed out.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

let readersAnswer: any
const calls: Array<{ url: string; body: any }> = []

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: { children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (ref: string) => ref,
  limit: () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreCollection: () => ({ data: [{ $id: 'reg-1', name: 'Front counter' }] }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, body })
    const answer =
      url === '/api/commerce/pos-readers' && body?.action === 'list'
        ? readersAnswer
        : url === '/api/commerce/pos-display' && body?.action === 'displays'
          ? {
              displays: [
                { id: 'abcdef0123456789', label: 'Counter tablet', createdAtMs: 1, lastSeenAtMs: Date.now() },
              ],
            }
          : { ok: true }
    return { ok: true, status: 200, json: async () => answer }
  },
}))

import PosDevicesCard from './pos-devices-card.component'

beforeEach(() => {
  calls.length = 0
  readersAnswer = {
    available: true,
    testMode: true,
    locationReady: false,
    readers: [
      {
        id: 'tmr_1',
        label: 'Counter reader',
        registerId: 'reg-1',
        deviceType: 'simulated_wisepos_e',
        serialNumber: null,
        status: 'online',
        livemode: false,
      },
    ],
  }
})

describe('the POS devices card', () => {
  it('lists the site’s readers with their status and register', async () => {
    render(<PosDevicesCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Counter reader')).toBeTruthy())
    expect(screen.getByText('Online')).toBeTruthy()
    expect(screen.getByText(/Front counter · test/)).toBeTruthy()
  })

  it('hides every reader control where card readers are not offered', async () => {
    readersAnswer = { ...readersAnswer, available: false, readers: [] }
    render(<PosDevicesCard hostId="host-1" />)
    await waitFor(() => expect(calls.some((call) => call.body?.action === 'list')).toBe(true))
    expect(screen.queryByText('Add card reader')).toBeNull()
    expect(screen.queryByText('Card readers')).toBeNull()
    expect(screen.getByText('Customer displays and kiosks')).toBeTruthy()
  })

  it('adds a reader with its code, register and the store address the first time', async () => {
    render(<PosDevicesCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Add card reader')).toBeTruthy())
    fireEvent.click(screen.getByText('Add card reader'))
    fireEvent.change(screen.getByLabelText('Registration code'), { target: { value: 'simulated-wpe' } })
    fireEvent.change(screen.getByLabelText('Street'), { target: { value: '1 Main St' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Austin' } })
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: '78701' } })
    fireEvent.click(screen.getByText('Add reader'))
    await waitFor(() =>
      expect(calls.find((call) => call.body?.action === 'register')?.body).toMatchObject({
        hostId: 'host-1',
        registrationCode: 'simulated-wpe',
        address: { line1: '1 Main St', city: 'Austin', postalCode: '78701', country: 'US' },
      }),
    )
  })

  it('signs a paired customer display out', async () => {
    render(<PosDevicesCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Counter tablet · Front counter')).toBeTruthy())
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() =>
      expect(calls.find((call) => call.body?.action === 'revoke')?.body).toMatchObject({
        registerId: 'reg-1',
        displayId: 'abcdef0123456789',
      }),
    )
  })
})
