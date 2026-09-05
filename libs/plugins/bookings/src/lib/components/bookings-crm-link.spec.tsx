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
 * A BOOKING ROW LINKS TO ITS BOOKER'S CONTACT (AGL-2622).
 *
 * The row holds the booker's address and nothing else about the person; the
 * CRM's Contacts list is the lookup, asked by that address. A booking with
 * no address — a row written before the field, or by a door that omitted it
 * — offers nothing rather than a link to an empty list.
 */

import { render, screen } from '@testing-library/react'
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

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
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
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

let params: Record<string, string> | null = { orgSlug: 'acme', host: 'shop' }
jest.mock('next/navigation', () => ({
  useParams: () => params,
}))

const FUTURE = Date.now() + 7 * 24 * 60 * 60_000

const booking = (extra: Record<string, unknown> = {}) => ({
  $id: 'booking-1',
  serviceName: 'Intro call',
  name: 'Rhea Salt',
  startsAtMs: FUTURE,
  endsAtMs: FUTURE + 1_800_000,
  status: 'confirmed',
  ...extra,
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
  params = { orgSlug: 'acme', host: 'shop' }
  collections.bookings = []
})

describe('View in CRM on a booking row', () => {
  it('links to the Contacts list asked to open the booker by address', () => {
    collections.bookings = [booking({ email: 'rhea@example.com' })]
    show()
    const link = screen.getByRole('link', { name: 'View in CRM' })
    expect(link.getAttribute('href')).toBe(
      '/acme/hosts/shop/crm/contacts?email=rhea%40example.com',
    )
  })

  it('offers nothing for a booking that carried no address', () => {
    collections.bookings = [booking()]
    show()
    expect(screen.queryByText('View in CRM')).toBeNull()
  })

  it('offers nothing until the route params have settled', () => {
    params = null
    collections.bookings = [booking({ email: 'rhea@example.com' })]
    show()
    expect(screen.queryByText('View in CRM')).toBeNull()
  })
})
