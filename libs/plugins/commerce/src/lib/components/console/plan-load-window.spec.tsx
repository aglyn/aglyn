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

/**
 * Collection name → docs. Keyed rather than positional because the five
 * cards under test open different collections in different orders, and the
 * stubbed `collection` below returns its own name so each query says which
 * one it is. `registers` and `locations` keep their own consts: the
 * original two cards mutate them by reference in `beforeEach`.
 */
const registerDocs: Array<Record<string, unknown>> = []
const locationDocs: Array<Record<string, unknown>> = []
const productDocs: Array<Record<string, unknown>> = []
const collections: Record<string, Array<Record<string, unknown>>> = {
  registers: registerDocs,
  locations: locationDocs,
  products: productDocs,
}

/**
 * A settled, empty profile. `status` carries because the payments card reads
 * it to tell "no Stripe account" from "no answer yet" (AGL-1380) — a stub
 * without it would leave the card permanently pending and these plan
 * assertions passing for the wrong reason.
 */
const profile = { data: undefined as unknown, status: 'success' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => orgPlan,
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => profile,
  useFirestoreCollection: (build: () => unknown) => {
    const name = build() as string
    // An unlisted collection is empty rather than a crash — these specs are
    // about the plan gate, not about every collection a card happens to
    // open, and defaulting to `registerDocs` (as this did when only two
    // cards used it) would feed registers to whoever asked last.
    return { data: collections[name] ?? [] }
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

jest.mock(
  '@aglyn/shared-ui-next/contexts/next-page-title-provider',
  () => ({ NextPageTitle: () => null }),
  { virtual: true },
)

import RegistersCard from './registers-card.component'
import LocationsCard from './locations-card.component'
import PosConsolePage from './pos-page.component'
import PaymentsSettingsCard from './payments-settings-card.component'
import ProductsHubCard from './products-hub-card.component'

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
  profile.data = undefined
  registerDocs.length = 0
  locationDocs.length = 0
  productDocs.length = 0
})

/** The plan has landed and it is a paying one. */
function planLands() {
  orgPlan.org = { plan: 'business', ownerUid: 'uid-owner' }
  orgPlan.ready = true
}

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

/**
 * The POS page has no Add button to disable, so the gate shows up as WHICH
 * message the register panel renders. That distinction is the whole test:
 * "no usable registers" is true either way during the window, because the
 * free tier's `posRegisters: 0` empties the list exactly as the gate does.
 * Asserting an empty list would therefore pass with the gate deleted. What
 * changes is whether the seller is told their registers exceed a plan
 * nobody has read yet.
 */
describe('POS page, plan not yet known', () => {
  it('says it is checking rather than that the registers exceed the plan', () => {
    registerDocs.push({ $id: 'r1', name: 'Front counter' })
    render(<PosConsolePage hostId="host-1" entitled />)
    expect(screen.getByText(/checking your plan/i)).toBeTruthy()
    // The free-tier read of one register against `posRegisters: 0`.
    expect(screen.queryByText(/registers exceed your plan/i)).toBeNull()
  })

  it('offers the register once the plan lands', () => {
    planLands()
    registerDocs.push({ $id: 'r1', name: 'Front counter' })
    render(<PosConsolePage hostId="host-1" entitled />)
    expect(screen.queryByText(/checking your plan/i)).toBeNull()
    expect(screen.queryByText(/registers exceed your plan/i)).toBeNull()
    expect(screen.getByText('Front counter')).toBeTruthy()
  })
})

/**
 * Payments settings reads the plan on every line — the entitlement AND the
 * two fee percentages. An org still in flight resolves to the free tier,
 * which flashes "Selling requires a paid plan" and the wrong fees at a
 * paying seller before correcting itself.
 */
describe('payments settings, plan not yet known', () => {
  it('withholds the entitlement verdict instead of failing it', () => {
    render(<PaymentsSettingsCard hostId="host-1" />)
    expect(screen.getByText(/checking your plan/i)).toBeTruthy()
    expect(screen.queryByText(/requires a paid plan/i)).toBeNull()
  })

  it('withholds the fee percentages too', () => {
    render(<PaymentsSettingsCard hostId="host-1" />)
    // The free-tier fees are a real number the card has not earned yet —
    // quoting them and then changing them is worse than quoting nothing.
    expect(screen.queryByText(/Physical products:/i)).toBeNull()
  })

  it('shows the entitlement and the fees once the plan lands', () => {
    planLands()
    render(<PaymentsSettingsCard hostId="host-1" />)
    expect(screen.queryByText(/checking your plan/i)).toBeNull()
    expect(screen.queryByText(/requires a paid plan/i)).toBeNull()
    expect(screen.getByText(/Physical products:/i)).toBeTruthy()
  })
})

/**
 * The products hub gates on a NULL quota rather than a boolean (AGL-1064):
 * `disabled={!productQuota}`. Deleting the gate does not disable the button
 * — it hands back the free tier's `productsPerHost: 0`, which leaves Add
 * ENABLED and turns the click into "your plan includes 0 products". So the
 * disabled assertion below genuinely distinguishes the two.
 */
describe('products hub, plan not yet known', () => {
  const addProduct = () =>
    screen.getByRole('button', { name: 'Add product' }) as HTMLButtonElement

  it('disables Add product rather than allowing a click that refuses it', () => {
    render(<ProductsHubCard hostId="host-1" />)
    expect(addProduct().disabled).toBe(true)
  })

  it('disables Import for the same reason', () => {
    render(<ProductsHubCard hostId="host-1" />)
    expect(
      (screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('enables Add product once the plan lands', () => {
    planLands()
    render(<ProductsHubCard hostId="host-1" />)
    expect(addProduct().disabled).toBe(false)
  })
})
