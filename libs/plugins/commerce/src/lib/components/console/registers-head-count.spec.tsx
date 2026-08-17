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
 * The POS-registers cap is a server aggregate, not the length of a capped
 * listener (AGL-1738 — the ninth instance of AGL-1716's AGL-1706 shape,
 * filed as latent and made real when the entitlement clamp was declined).
 *
 * The listener is `limit(25)` and the stock `posRegisters` bands top out at
 * agency's 20 — under the window — but the $89/mo register add-on is sold
 * flat up to `POS_REGISTERS_ADDON_MAX` (50) on any plan carrying `pos`, so
 * an agency org's effective limit reaches 70. This fixture is agency + 30
 * purchased registers (limit 50) with 60 registers on the site: before the
 * fix the card read "25/50 registers on your plan" and offered the add,
 * while `api/hosts/resources` counted the collection and refused it.
 *
 * Contracts, matching `locations-head-count.spec.tsx` (the same-directory
 * template — registers are hard-deleted like locations): the gate refuses
 * over the cap the window hid AND the caption stops quoting the window
 * (both red before the fix), the list keeps its `limit(25)`, a hard delete
 * re-reads the count, and an unanswered aggregate falls back to the loaded
 * rows rather than to 0.
 *
 * No counting RULE moves: `checkQuota` is untouched and this number is not
 * metered by `report-usage`.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What the server says the site actually has. */
const SERVER_REGISTERS = 60
/** What the `limit(25)` listener can ever hand back. */
const ROWS = 25

const registerDocs = Array.from({ length: ROWS }, (_, index) => ({
  $id: `reg-${index}`,
  name: `Till ${String(index).padStart(2, '0')}`,
  createdAt: { toMillis: () => index * 1000 },
}))
const collections: Record<string, Array<Record<string, unknown>>> = {
  registers: registerDocs,
  locations: [],
}

/** Mutable so a spec can choose how the aggregate resolves. */
const aggregate: { count: number | null } = { count: SERVER_REGISTERS }

/** Stable, like the real hook — `firestore` keys the head-count effect. */
const FIRESTORE = {}
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'reg-new' })
/**
 * Stock `agency` (`posRegisters: 20`) + 30 purchased add-ons: effective
 * limit 50, above the window — the AGL-1738 configuration. Every stock band
 * alone sits under 25, which is exactly why AGL-1716 recorded this card as
 * a negative until the add-on ceiling was confirmed at band + 50.
 */
const ORG_PLAN = {
  org: { $id: 'org-1', plan: 'agency', seatAddons: { posRegisters: 30 } },
  ready: true,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgPlan: () => ORG_PLAN,
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
}))

const limitSpy = jest.fn((value: number) => value)
const countSpy = jest.fn(async (name: string) => {
  // A server aggregate is a NETWORK round-trip: its answer cannot land in
  // the same drain as the mount that asked for it (AGL-1756/AGL-1758 — two
  // macrotasks is the first schedule a tick-counting settle cannot beat).
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (aggregate.count == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate.count }), name } as any
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => limitSpy(value),
  doc: () => ({}),
  getCountFromServer: (name: string) => countSpy(name),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
const confirm = jest.fn().mockResolvedValue(undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm }),
}))

import RegistersCard from './registers-card.component'

beforeEach(() => {
  jest.clearAllMocks()
  confirm.mockResolvedValue(undefined)
  aggregate.count = SERVER_REGISTERS
})

/**
 * Wait until the card is SHOWING `count` — the aggregate's answer has
 * reached a render and is the number the caption quotes and the gate is
 * computed from (they are the same `registerCount`). The caption renders
 * `${registerCount}/${quota.limit}`, so 60 and 25 print different strings
 * and the rendered consequence IS the condition (AGL-1758).
 */
const showingCount = async (count: number) => {
  await waitFor(() =>
    expect(
      screen.queryByText(`${count}/50 registers on your plan`),
    ).not.toBeNull(),
  )
}

/**
 * The DENIED case has no `showingCount` signal to wait for: its fallback is
 * also the value the FIRST render used, so `showingCount(ROWS)` would be
 * satisfied before the read had failed. Await the very promise the card
 * awaited instead.
 */
const readRejected = async () => {
  await waitFor(() => expect(countSpy).toHaveBeenCalled())
  await act(async () => {
    await countSpy.mock.results[0].value.catch(() => undefined)
  })
}

describe('the POS-registers cap is a server aggregate (AGL-1738)', () => {
  it('reads the site total in the caption, not the loaded rows', async () => {
    render(<RegistersCard hostId="host-1" />)
    // Before the fix this read "25/50 registers on your plan" — the window
    // presented as the site's usage. Sixty registers against fifty is over,
    // and the window could not say so at any count.
    await showingCount(SERVER_REGISTERS)

    expect(screen.queryByText('25/50 registers on your plan')).toBeNull()
  })

  it('refuses Add over the cap the loaded window hid', async () => {
    render(<RegistersCard hostId="host-1" />)
    await showingCount(SERVER_REGISTERS)

    fireEvent.change(screen.getByLabelText(/New register/), {
      target: { value: 'Overflow till' },
    })
    fireEvent.click(screen.getByText('Add'))

    // Asserted directly, not inside a `waitFor`: `handleAdd` enqueues before
    // it awaits anything, so there is nothing here to wait FOR.
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Your plan includes 50 registers'),
      ),
    ).toBe(true)
    // The API would have refused it anyway; the point is that the card
    // stopped promising otherwise first.
    expect(mockCreateResource).not.toHaveBeenCalled()
  })

  it('keeps the list capped and reads the count once, from registers', async () => {
    render(<RegistersCard hostId="host-1" />)
    await showingCount(SERVER_REGISTERS)

    // Both listeners (registers and the location picker) keep their window.
    expect(limitSpy).toHaveBeenCalledWith(25)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('registers')
  })

  it('re-reads the count after a HARD delete frees a slot', async () => {
    render(<RegistersCard hostId="host-1" />)
    await showingCount(SERVER_REGISTERS)
    countSpy.mockClear()

    // Registers are hard-deleted (like locations, unlike the soft-deleting
    // cards of the AGL-1716 sweep), so a removal genuinely lowers the
    // number on both sides. A one-shot that missed it would keep refusing
    // an add the API would now allow.
    fireEvent.click(screen.getAllByText('Remove')[0])

    await waitFor(() => expect(countSpy).toHaveBeenCalledWith('registers'))
  })

  it('falls back to the loaded rows, never to zero, when the read fails', async () => {
    aggregate.count = null
    render(<RegistersCard hostId="host-1" />)
    await readRejected()

    // The 25 known rows stand in — a lower bound, and this card's prior
    // behaviour. A defaulted 0 would print "0/50" on a site with sixty
    // registers, which is the flattering direction again.
    expect(screen.queryByText('25/50 registers on your plan')).not.toBeNull()
    expect(screen.queryByText('0/50 registers on your plan')).toBeNull()
  })
})
