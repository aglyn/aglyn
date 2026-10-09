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
 * Pickup per location and the Local delivery card (AGL-3624): what each save
 * writes. Both replace their map WHOLE, so a field the merchant cleared is
 * cleared rather than deep-merged back, and both write the normalized shape
 * checkout reads.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn(async () => undefined)
const mockUpdateDoc = jest.fn(async () => undefined)
let mockStore: any = {}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (name: string) => name,
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getCountFromServer: async () => ({ data: () => ({ count: 1 }) }),
  deleteDoc: jest.fn(async () => undefined),
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...(args as [])),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: [
      {
        $id: 'main',
        name: 'Main Street',
        isDefault: true,
        postalAddress: { line1: '1 Main St' },
        pickup: { enabled: true, hours: 'Mo-Fr 09:00-17:00', instructions: 'Old note' },
      },
    ],
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({ data: mockStore, status: 'success', fromCache: false }),
  useOrgPlan: () => ({ org: { $id: 'org-1', plan: 'business' }, ready: true }),
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn(async () => 'tok') } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: { children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/quota-readout.component', () => () => null)

import LocationsCard from './locations-card.component'
import LocalDeliverySettingsCard from './local-delivery-settings-card.component'

beforeEach(() => {
  jest.clearAllMocks()
  mockStore = {}
  ;(global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ radius: false }) }))
})

describe('pickup at a location', () => {
  it('replaces the location’s pickup whole, so a cleared field is cleared', async () => {
    render(<LocationsCard hostId="host-1" />)
    expect(screen.getByText('Pickup', { selector: '.MuiChip-label' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pickup' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Arrival instructions'), { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    expect(mockUpdateDoc).toHaveBeenCalledWith('hosts/host-1/locations/main', {
      pickup: { enabled: true, hours: 'Mo-Fr 09:00-17:00' },
    })
    expect(mockSetDoc).not.toHaveBeenCalled()
  })

  it('will not save hours that do not read', async () => {
    render(<LocationsCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Pickup' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Pickup hours'), { target: { value: 'weekdays' } })
    expect(within(dialog).getByText(/Line 1 does not read/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the Local delivery card', () => {
  it('writes the normalized settings whole under mergeFields, leaving the rest of the document alone', async () => {
    mockStore = { tax: { mode: 'none' } }
    render(<LocalDeliverySettingsCard hostId="host-1" />)
    fireEvent.click(screen.getByLabelText('Deliver orders yourself'))
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'us' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }))
    fireEvent.change(screen.getByLabelText('Postal codes'), { target: { value: '627*, 62801-62899' } })
    fireEvent.change(screen.getByLabelText('Fee ($)'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Minimum order ($)'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Delivery windows'), { target: { value: 'Mo-Fr 09:00-12:00' } })
    expect(screen.queryByText(/Checkout won’t offer delivery yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [path, value, options] = mockSetDoc.mock.calls[0] as unknown as [string, any, any]
    expect(path).toBe('hosts/host-1/settings/store')
    expect(options).toEqual({ mergeFields: ['localDelivery'] })
    expect(value.localDelivery).toEqual({
      enabled: true,
      country: 'US',
      zones: [
        {
          id: expect.any(String),
          name: 'Local delivery',
          kind: 'postcode',
          postcodes: ['627*', '62801-62899'],
          feeCents: 500,
          minimumCents: 2000,
        },
      ],
      windows: 'Mo-Fr 09:00-12:00',
    })
  })

  it('says what stops checkout from offering delivery', () => {
    mockStore = { localDelivery: { enabled: true, country: 'US' } }
    render(<LocalDeliverySettingsCard hostId="host-1" />)
    expect(
      screen.getByText('Checkout won’t offer delivery yet: Add at least one delivery zone. Add at least one delivery window.'),
    ).toBeTruthy()
  })

  it('offers distance zones only where the address check can place addresses', async () => {
    render(<LocalDeliverySettingsCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }))
    expect(screen.queryByLabelText('Matched by')).toBeNull()
  })
})
