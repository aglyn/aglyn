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
 * THE BOOKINGS CARD'S EXPORT ACTION: in the card header, opened through the
 * console shell's launcher on the list as it stands — the upcoming bookings,
 * or one booker's when the page is narrowed to them — and absent outside the
 * shell. Bookings are exported only, so there is never an Import.
 */

import { TransferLauncherContext, type TransferLauncher } from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import BookingsConsolePage from './bookings-console-page'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: null }),
  writeGuardedBySeed: jest.fn(),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    header,
    children,
    HeaderProps,
  }: {
    header: ReactNode
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      <h2>{header}</h2>
      <div data-testid={`actions-${String(header)}`}>{HeaderProps?.action}</div>
      {children}
    </section>
  ),
  MdiIcon: () => null,
  HelpTip: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

let search = ''
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
  useSearchParams: () => new URLSearchParams(search),
}))

const launcher: TransferLauncher = {
  openImport: jest.fn(),
  openExport: jest.fn(),
  close: jest.fn(),
  can: jest.fn(() => true),
}

const page = (
  <BookingsConsolePage
    hostId="host-1"
    entitled
    org={{ plan: 'business' } as never}
    basePath="/acme/hosts/shop/bookings"
  />
)

const show = (withLauncher: boolean) =>
  render(
    withLauncher ? (
      <TransferLauncherContext.Provider value={launcher}>
        {page}
      </TransferLauncherContext.Provider>
    ) : (
      page
    ),
  )

beforeEach(() => {
  search = ''
  jest.mocked(launcher.openExport).mockClear()
})

describe('the bookings card’s Export action', () => {
  it('sits in the bookings card header, with no Import beside it', () => {
    show(true)
    const actions = screen.getByTestId('actions-Upcoming bookings')
    expect(actions.textContent).toBe('Export')
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    // The services card carries none.
    expect(screen.getByTestId('actions-Services').textContent).toBe('')
  })

  it('exports the upcoming bookings from the moment it is clicked', () => {
    show(true)
    const before = Date.now()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(launcher.openExport).toHaveBeenCalledTimes(1)
    const launch = jest.mocked(launcher.openExport).mock.calls[0][0]
    expect(launch).toMatchObject({
      resource: 'bookings',
      scope: 'host',
      hostId: 'host-1',
      filter: { label: 'Upcoming bookings', value: { upcoming: true } },
    })
    const asOf = (launch.filter?.value as { asOfMs: number }).asOfMs
    expect(asOf).toBeGreaterThanOrEqual(before)
    expect(asOf).toBeLessThanOrEqual(Date.now())
  })

  it('exports one booker’s bookings when the page is narrowed to them', () => {
    search = '?email=Rhea%40Example.com'
    show(true)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(jest.mocked(launcher.openExport).mock.calls[0][0]).toMatchObject({
      resource: 'bookings',
      filter: {
        label: 'Bookings for rhea@example.com',
        value: { email: 'rhea@example.com' },
      },
    })
  })

  it('is absent outside the console shell', () => {
    show(false)
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })
})
