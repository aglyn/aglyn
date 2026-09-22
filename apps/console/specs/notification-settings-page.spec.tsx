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
 * `/manage/notifications/settings`, DRIVEN (AGL-3226).
 *
 * Every assertion is on what the person sees and on the document that comes
 * out the other side, because the two halves this page has to get right are
 * exactly those: the tri-state control must write an ABSENCE for Inherit —
 * storing `false` there would silently detach a site from the workspace it
 * was meant to follow — and the staff rows must not be offered to anybody who
 * could never receive them.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/** `jest-dom` is not loaded in this project, so read the input directly. */
const isOn = (element: HTMLElement) => (element as HTMLInputElement).checked
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn()
let mockStoredUser: Record<string, unknown> = {}
let mockIsStaff: boolean | null = false

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/manage/notifications/settings',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (...path: string[]) => ({ path: path.slice(1).join('/') }),
  collection: (...path: string[]) => ({ path: path.slice(1).join('/') }),
  query: (...args: unknown[]) => args,
  orderBy: () => 'orderBy',
  limit: () => 'limit',
  startAfter: () => 'startAfter',
  serverTimestamp: () => 'now',
  updateDoc: async () => undefined,
  writeBatch: () => ({ update: () => undefined, commit: async () => undefined }),
  getDocs: async () => ({ docs: [], forEach: () => undefined }),
  getDoc: async () => ({
    get: (field: string) => mockStoredUser[field],
  }),
  setDoc: (...args: unknown[]) => {
    mockSetDoc(...args)
    return Promise.resolve()
  },
}))

/**
 * ONE instance and ONE user object, never a fresh literal per call.
 *
 * `useFirestore` is a `useEffect` dependency of the page's load, and a double
 * that returns a new object every render re-runs that effect on every render
 * — which quietly RELOADS the stored document over whatever was just saved.
 * The symptom is a control that snaps back to its old position, which reads
 * as a broken page rather than as a broken double.
 */
jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = {}
  const user = { data: { uid: 'uid-1' } }
  return {
    __esModule: true,
    useFirestore: () => firestore,
    useUser: () => user,
  }
})

/**
 * ONE object, read through getters — never a fresh literal per call. A hook
 * double that returns a new object every render is the AGL-2105 loop, and
 * this page holds `orgs` in a `useMemo` dependency.
 */
jest.mock('../hooks/use-org-scope', () => {
  const value = {
    orgs: [{ $id: 'org-1', name: 'Acme', slug: 'acme' }],
    currentOrg: { $id: 'org-1', name: 'Acme', slug: 'acme' },
    loading: false,
    confirmed: true,
    error: false,
    hasMoreOrgs: false,
    selectOrg: () => undefined,
    orgSlug: 'acme',
    pathOrgSlug: null,
    slugExists: true,
    retry: () => undefined,
    loadMoreOrgs: () => undefined,
  }
  return {
    __esModule: true,
    useOrgSlug: () => 'acme',
    useOrgScope: () => value,
    default: () => value,
  }
})

jest.mock('../hooks/use-org-hosts', () => {
  const hosts = [{ $id: 'host-1', name: 'Acme Marketing', subdomain: 'acme' }]
  const value = { hosts, ready: true, error: false, retry: () => undefined }
  return { __esModule: true, default: () => value, useOrgHosts: () => value }
})

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  default: () => mockIsStaff,
  useIsStaff: () => mockIsStaff,
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

import Page from '../app/(app)/manage/notifications/(sections)/settings/page'

/** What the last `setDoc` wrote to `notificationSettings`. */
const lastWrite = () =>
  (mockSetDoc.mock.calls.at(-1)?.[1] as Record<string, unknown>)?.[
    'notificationSettings'
  ] as Record<string, any> | undefined

/**
 * The tri-state control for one cell, RE-QUERIED on every call.
 *
 * Holding the element across a click is how this spec first read green over a
 * broken Inherit: `write` re-renders, the old node detaches, and a
 * `fireEvent` on a detached node does nothing at all.
 */
const cell = (label: string) =>
  screen.getByRole('group', { name: label })

describe('the notification settings page (AGL-3226)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStoredUser = {}
    mockIsStaff = false
  })

  it('shows both channels, with email off and the console on by default', async () => {
    render(<Page />)
    await screen.findByText('Forms & bookings')
    expect(screen.getAllByText('In console').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0)
    const console_ = screen.getByRole('switch', {
      name: 'Forms & bookings — In console',
    })
    const email = screen.getByRole('switch', {
      name: 'Forms & bookings — Email',
    })
    expect(isOn(console_)).toBe(true)
    expect(isOn(email)).toBe(false)
  })

  it('writes the account layer when a default is switched', async () => {
    render(<Page />)
    const email = await screen.findByRole('switch', {
      name: 'Forms & bookings — Email',
    })
    fireEvent.click(email)
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled())
    expect(lastWrite()?.account?.content?.email).toBe(true)
  })

  /**
   * The seam between the expander and the page's writer (AGL-3251). The
   * component's own spec proves the callback fires; this proves where the
   * answer lands, and that it lands somewhere the category map cannot be
   * confused with.
   */
  it('writes a single type under its own map, and clears it back to the category', async () => {
    render(<Page />)
    fireEvent.click(await screen.findByLabelText('Show what Billing covers'))
    fireEvent.click(
      screen.getByRole('switch', { name: 'Payment failed — In console' }),
    )
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled())
    expect(lastWrite()?.accountTypes?.['billing.paymentFailed']?.console).toBe(false)
    // The category it sits in is untouched — that is the whole point of the
    // finer control.
    expect(lastWrite()?.account?.billing).toBeUndefined()

    fireEvent.click(screen.getByText('Follow category'))
    await waitFor(() =>
      expect(lastWrite()?.accountTypes?.['billing.paymentFailed']).toBeUndefined(),
    )
  })

  it('keeps honouring a mute from the map nothing has migrated', async () => {
    mockStoredUser = { notificationPrefs: { billing: false } }
    render(<Page />)
    // `waitFor`, not a bare assertion: the switches render before the stored
    // document arrives, so the un-awaited version reads the DEFAULT and
    // passes against a page that ignores the old map entirely.
    await waitFor(() =>
      expect(
        isOn(screen.getByRole('switch', { name: 'Billing — In console' })),
      ).toBe(false),
    )
  })

  it('writes a site override under its own id, and Inherit removes it', async () => {
    render(<Page />)
    await screen.findByLabelText('Workspace or site')
    // The picker is a `TextField select`, so the option list is a menu.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Workspace or site' }))
    fireEvent.click(await screen.findByRole('option', { name: /Acme Marketing/ }))

    await screen.findByRole('group', { name: 'Forms & bookings — Email' })
    fireEvent.click(
      within(cell('Forms & bookings — Email')).getByRole('button', {
        name: 'Off',
      }),
    )
    await waitFor(() => expect(lastWrite()?.hosts?.['host-1']).toBeDefined())
    expect(lastWrite()?.hosts?.['host-1']?.content?.email).toBe(false)
    // The workspace above it is untouched — that is the whole point of the
    // narrower scope.
    expect(lastWrite()?.orgs).toBeUndefined()

    fireEvent.click(
      within(cell('Forms & bookings — Email')).getByRole('button', {
        name: 'Inherit',
      }),
    )
    await waitFor(() =>
      expect(lastWrite()?.hosts?.['host-1']?.content?.email).toBeUndefined(),
    )
    // Absent, not `false`. Writing `false` would detach the site from the
    // workspace it was meant to follow, which is indistinguishable in the
    // UI and only shows up as notifications that stop arriving.
    expect(lastWrite()?.hosts?.['host-1']?.content).toBeUndefined()
  })

  it('offers the platform-growth rows to staff only', async () => {
    const { unmount } = render(<Page />)
    await screen.findByText('Forms & bookings')
    expect(screen.queryByText('Platform growth')).toBeNull()
    unmount()

    mockIsStaff = true
    render(<Page />)
    await screen.findByText('Platform growth')
    expect(
      isOn(screen.getByRole('switch', { name: 'Platform growth — In console' })),
    ).toBe(true)
    expect(
      isOn(screen.getByRole('switch', { name: 'Platform growth — Email' })),
    ).toBe(false)
  })

  it('keeps the digests and the per-device alerts, and says which is which', async () => {
    render(<Page />)
    expect(await screen.findByText('Daily CRM digest')).toBeTruthy()
    expect(screen.getByText('Alerts on this device')).toBeTruthy()
    expect(screen.getByText('Sound')).toBeTruthy()
    expect(screen.getByText('Unread count in tab title')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send test alert' })).toBeTruthy()
    // jsdom has no Notification API, so the card takes its unsupported arm —
    // which is the right copy for a browser that cannot do this at all.
    expect(
      screen.getByText('This browser does not support desktop notifications.'),
    ).toBeTruthy()
  })
})

/**
 * The feed keeps the feed (AGL-3226, AGL-3230).
 *
 * Mocked separately from the page above because the claim is about a
 * DIFFERENT page: that the preferences left it. Asserting that on the source
 * text would pass for a page that still rendered them from a helper.
 *
 * What replaced them is the section rail, which belongs to the layout beside
 * this page and is covered by `notification-sections.spec.ts` — so what is
 * asserted here is the absence, plus the one control the feed still owns.
 */
jest.mock('../components/notifications-table.component', () => ({
  __esModule: true,
  default: () => <div>{'notifications table'}</div>,
}))

jest.mock('../hooks/use-host-index-entries', () => ({
  __esModule: true,
  default: () => new Map(),
}))

import Feed from '../app/(app)/manage/notifications/(sections)/page'

describe('the notifications feed after the settings moved out (AGL-3226)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStoredUser = {}
    mockIsStaff = false
  })

  it('holds no preference control at all', async () => {
    render(<Feed />)
    expect(
      await screen.findByRole('button', { name: 'Mark all read' }),
    ).toBeTruthy()
    // Not one preference control left on the page the feed lives on.
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.queryByText('Daily CRM digest')).toBeNull()
    expect(screen.queryByText('Send test alert')).toBeNull()
  })

  it('draws no chrome of its own — that is the sections layout above it', async () => {
    // The header, the breadcrumb and the rail moved up a level (AGL-3230).
    // A page that kept rendering its own `DashboardLayout` would nest one
    // inside the layout's, which is two headers and two breadcrumb trails.
    render(<Feed />)
    await screen.findByRole('button', { name: 'Mark all read' })
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryAllByRole('heading', { name: 'Notifications' })).toHaveLength(0)
  })
})
