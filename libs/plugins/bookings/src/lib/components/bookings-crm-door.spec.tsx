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
 * THE BOOKINGS PAGE'S HALF OF THE CRM DOOR (AGL-2660).
 *
 * Two things: a contact's record links here narrowed to one booker, and the
 * page answers with that address's bookings — past ones too — under the
 * same match rule the row's own "View in CRM" uses; and the service editor
 * carries the two CRM switches, seeded from what the service stores and
 * written back explicitly, so switching the meeting OFF lands a `false`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import BookingsConsolePage from './bookings-console-page'

const collections: Record<string, Array<Record<string, unknown>>> = {
  services: [],
  bookings: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: { getIdToken: async () => 'id-token-1' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

const setDoc = jest.fn().mockResolvedValue(undefined)
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  setDoc: (...args: unknown[]) => setDoc(...args),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
  MdiIcon: () => null,
  HelpTip: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

let search = ''
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
  useSearchParams: () => new URLSearchParams(search),
}))

const NOW = Date.now()
const DAY = 24 * 60 * 60_000

const booking = (id: string, email: string, startsAtMs: number) => ({
  $id: id,
  serviceName: 'Intro call',
  name: 'Rhea Salt',
  email,
  startsAtMs,
  endsAtMs: startsAtMs + 1_800_000,
  status: 'confirmed',
})

const show = () =>
  render(
    <BookingsConsolePage
      hostId="host-1"
      entitled
      org={{ plan: 'business' } as never}
      basePath="/acme/hosts/shop/bookings"
    />,
  )

beforeEach(() => {
  search = ''
  collections.bookings = []
  collections.services = []
  setDoc.mockClear()
})

describe('the list narrowed to one booker', () => {
  beforeEach(() => {
    collections.bookings = [
      booking('past', 'Rhea@Example.com', NOW - 7 * DAY),
      booking('next', 'rhea@example.com', NOW + 7 * DAY),
      booking('other', 'other@example.com', NOW + 8 * DAY),
    ]
  })

  it('shows every booking the address holds, past ones too, and nobody else', () => {
    search = '?email=rhea%40example.com'
    show()
    expect(screen.getByRole('heading', { name: 'Bookings for rhea@example.com' })).toBeTruthy()
    const rows = screen.getAllByText(/Intro call — Rhea Salt/)
    expect(rows).toHaveLength(2)
    expect(screen.queryByText(/other@example.com/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Show upcoming bookings' }).getAttribute('href')).toBe(
      '/acme/hosts/shop/bookings',
    )
  })

  it('says so when the address holds none', () => {
    search = '?email=nobody%40example.com'
    show()
    expect(screen.getByText('No bookings for this address.')).toBeTruthy()
  })

  it('is the week ahead without the filter, as before', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Upcoming bookings' })).toBeTruthy()
    expect(screen.getAllByText(/Intro call — Rhea Salt/)).toHaveLength(2)
    expect(screen.getByText(/other@example.com/)).toBeTruthy()
  })
})

describe('the two CRM switches on a service', () => {
  const meeting = () =>
    screen.getByLabelText('Log a meeting on the CRM record when this service is booked')
  const followUp = () =>
    screen.getByLabelText('Create a follow-up task on the CRM record when this service is booked')

  it('reads a service with neither field as meeting ON, follow-up OFF', () => {
    collections.services = [{ $id: 'service-1', name: 'Intro call', durationMinutes: 30 }]
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((meeting() as HTMLInputElement).checked).toBe(true)
    expect((followUp() as HTMLInputElement).checked).toBe(false)
  })

  it('reads what the service stores', () => {
    collections.services = [
      {
        $id: 'service-1',
        name: 'Intro call',
        durationMinutes: 30,
        crmMeetingActivity: false,
        crmFollowUpTask: true,
      },
    ]
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((meeting() as HTMLInputElement).checked).toBe(false)
    expect((followUp() as HTMLInputElement).checked).toBe(true)
  })

  it('writes both explicitly, so switching the meeting off lands a false', async () => {
    collections.services = [{ $id: 'service-1', name: 'Intro call', durationMinutes: 30 }]
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(meeting())
    fireEvent.click(followUp())
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalled())
    expect(setDoc.mock.calls[0][0]).toBe('hosts/host-1/services/service-1')
    expect(setDoc.mock.calls[0][1]).toMatchObject({
      name: 'Intro call',
      crmMeetingActivity: false,
      crmFollowUpTask: true,
    })
  })
})
