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
 * AGL-1064: the commerce cards must not answer a plan question before the
 * org doc arrives.
 *
 * The window is a render or two wide, so it is asserted rather than clicked
 * for: `useOrgPlan` is stubbed to report `ready: false` with no org, which
 * is exactly what the hook returns while the `hostIndex` lookup is in
 * flight. Without the gate an absent org resolves to the FREE tier
 * (`posRegisters: 0`, `inventoryLocations: 1`) and the card refuses a
 * paying customer.
 */

import { fireEvent, render, screen } from '@testing-library/react'

const orgPlan = { org: undefined as unknown, ready: false }
const registerDocs: Array<Record<string, unknown>> = []
const locationDocs: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => orgPlan,
  useHostResourceApi: () => jest.fn(),
  useFirestoreCollection: (build: () => unknown) => {
    // Each card opens more than one collection; the stubbed `collection`
    // below returns its own name, so the built query says which is which
    // rather than this depending on call order.
    const name = build()
    return { data: name === 'locations' ? locationDocs : registerDocs }
  },
}))

// Only the ref builders are stubbed. Spreading the real module matters:
// `@aglyn/shared-util-timestamp` extends the SDK's `Timestamp`, and a
// wholesale mock leaves it extending undefined.
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  setDoc: jest.fn(),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

import RegistersCard from './registers-card.component'
import LocationsCard from './locations-card.component'

// `toBeDisabled` needs jest-dom, which this project's preset does not
// load; the DOM attribute is the same assertion without the setup.
const addButton = () =>
  screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement

/**
 * Add is ALSO disabled on an empty name, so every case types one first.
 * Without this the load-window assertions pass for the wrong reason — they
 * would hold just as well with the plan gate deleted.
 */
function typeName(label: RegExp, value = 'Front counter') {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const NEW_REGISTER = /new register/i
const NEW_LOCATION = /new location/i

beforeEach(() => {
  orgPlan.org = undefined
  orgPlan.ready = false
  registerDocs.length = 0
  locationDocs.length = 0
})

describe('registers card, plan not yet known', () => {
  it('disables Add rather than refusing it as a free-tier org', () => {
    render(<RegistersCard hostId="host-1" />)
    typeName(NEW_REGISTER)
    expect(addButton().disabled).toBe(true)
    // The free-tier read is `0 registers on your plan` — a number the app
    // has not earned the right to show yet.
    expect(screen.getByText(/checking your plan/i)).toBeTruthy()
    expect(screen.queryByText(/on your plan/i)).toBeNull()
  })

  it('does not badge existing registers over the limit', () => {
    registerDocs.push({ $id: 'r1', name: 'Front counter' })
    render(<RegistersCard hostId="host-1" />)
    // `posRegisters: 0` would put every register over the cap.
    expect(screen.queryByText('Over plan limit')).toBeNull()
  })

  it('enables Add and shows the real cap once the plan lands', () => {
    orgPlan.org = { plan: 'business' }
    orgPlan.ready = true
    render(<RegistersCard hostId="host-1" />)
    typeName(NEW_REGISTER)
    expect(addButton().disabled).toBe(false)
    expect(screen.getByText(/registers on your plan/i)).toBeTruthy()
    expect(screen.queryByText(/checking your plan/i)).toBeNull()
  })
})

describe('locations card, plan not yet known', () => {
  it('disables Add rather than refusing it against a 1-location cap', () => {
    locationDocs.push({ $id: 'l1', name: 'Main warehouse' })
    render(<LocationsCard hostId="host-1" />)
    typeName(NEW_LOCATION, 'Overflow shed')
    expect(addButton().disabled).toBe(true)
    expect(screen.getByText(/checking your plan/i)).toBeTruthy()
  })

  it('enables Add once the plan lands', () => {
    orgPlan.org = { plan: 'business' }
    orgPlan.ready = true
    locationDocs.push({ $id: 'l1', name: 'Main warehouse' })
    render(<LocationsCard hostId="host-1" />)
    typeName(NEW_LOCATION, 'Overflow shed')
    expect(addButton().disabled).toBe(false)
    expect(screen.getByText(/locations on your plan/i)).toBeTruthy()
  })
})
