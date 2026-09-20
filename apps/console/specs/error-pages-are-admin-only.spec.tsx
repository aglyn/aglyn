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
 * The error pages card, and the site-wide maintenance switch it carries, are
 * reached only by a site admin (AGL-3178).
 *
 * The card writes `errorScreens` — the designed screen per status code — and
 * `maintenance`, which replaces every page for every visitor. It was mounted
 * on Setup → Details, beside the logo and the business phone number, which is
 * a page a collaborator opens for unrelated reasons. Delete site moved off
 * that page for the same reason in AGL-1014, and the auth screens in
 * AGL-428/1014.
 *
 * ## The gate is the ROUTE, not the rail
 *
 * A section missing from the rail is hidden, not withheld; the URL is still
 * typeable and a bookmark still resolves. So the assertions below render the
 * real `admin/(sections)` layout with the real Error pages page as its
 * children and drive `useIsHostAdmin` — the same context the host doc's
 * `memberRoles[uid] === 'admin'` feeds — rather than reading either file for
 * the word `isAdmin`.
 *
 * Every refusal is paired with a control that drives the SAME render to the
 * card, because a gate that admits nobody would satisfy a deny on its own.
 *
 * ## What is real
 *
 * The card is, including its maintenance handler. Only its I/O is doubled —
 * Firestore, the announce helper, the snackbar — so the last case can assert
 * the act the switch performs rather than the shape of the source that
 * performs it.
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'

const HOST_ID = 'host-1'

/** The signed-in reader's standing on this site, per test. */
let mockIsHostAdmin = true
/** The host document the card reads its current settings from. */
let mockHostDoc: Record<string, unknown> = {}

const mockUpdateDoc = jest.fn().mockResolvedValue(undefined)
const mockRevalidateLivePages = jest.fn().mockResolvedValue({ reason: 'ok' })
const mockEnqueueSnackbar = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => ({})),
  deleteField: jest.fn(() => ({ __delete: true })),
  doc: jest.fn((_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1', getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(async () => ({ ok: true, json: async () => ({}) })),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    header,
    children,
  }: {
    header?: ReactNode
    children: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@aglyn/shared-ui-next/components/hub-tabs', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <nav>{children}</nav>,
  useActiveSection: () => null,
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => <span>{'Acme site'}</span>,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => HOST_ID,
  useHostSubdomain: () => 'acme',
  useIsHostAdmin: () => mockIsHostAdmin,
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({ currentOrg: { $id: 'org-1' }, loading: false }),
}))
jest.mock('../app/(app)/[orgSlug]/hosts/[host]/host-settings-scope', () => ({
  HostSettingsScopeProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: mockHostDoc }),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [] }),
}))
jest.mock('../constants/screen-publishing', () => ({
  unpublishScreenRoute: jest.fn(async () => undefined),
}))
jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockRevalidateLivePages(...args),
}))

import HostAdminSectionsLayout from '../app/(app)/[orgSlug]/hosts/[host]/admin/(sections)/layout'
import HostAdminErrorPages from '../app/(app)/[orgSlug]/hosts/[host]/admin/(sections)/error-pages/page'

const REPO = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

const SETUP_DETAILS =
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/setup/(sections)/details/page.tsx'
const ADMIN_ERROR_PAGES =
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/admin/(sections)/error-pages/page.tsx'

const MAINTENANCE_LABEL =
  'Maintenance mode — show the 503 screen on every page'

/** The Error pages section, mounted inside the layout that guards it. */
const openTheSection = () =>
  render(
    <HostAdminSectionsLayout>
      <HostAdminErrorPages />
    </HostAdminSectionsLayout>,
  )

const maintenanceSwitch = () =>
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')

beforeEach(() => {
  jest.clearAllMocks()
  mockIsHostAdmin = true
  mockHostDoc = { $id: HOST_ID }
  mockRevalidateLivePages.mockResolvedValue({ reason: 'ok' })
})

describe('where the card is mounted (AGL-3178)', () => {
  it('CONTROL: both pages were really read', () => {
    // Without this a moved or renamed file leaves every `toContain` below
    // asserting against a throw, and an emptied one passes each `not`.
    for (const path of [SETUP_DETAILS, ADMIN_ERROR_PAGES]) {
      expect([path, read(path).length > 500]).toEqual([path, true])
    }
  })

  it('Setup → Details neither imports nor renders it', () => {
    const setup = read(SETUP_DETAILS)
    expect(setup).not.toContain('error-screens-card.component')
    expect(setup).not.toContain('<ErrorScreensCard')
  })

  it('the Setup page still says what is deliberately not on it', () => {
    // That header comment is the only place a reader of the Setup page learns
    // where a setting went. A move that empties it leaves the page looking
    // like the feature was withdrawn.
    expect(read(SETUP_DETAILS)).toContain('AGL-3178')
  })

  it('the admin section mounts it, under the admin segment', () => {
    expect(read(ADMIN_ERROR_PAGES)).toContain('<ErrorScreensCard')
    expect(ADMIN_ERROR_PAGES).toContain('/admin/(sections)/')
  })
})

describe('the admin route withholds it, rather than the rail hiding it', () => {
  it('shows a non-admin the refusal and none of the card', () => {
    mockIsHostAdmin = false
    openTheSection()
    expect(document.body.textContent).toContain(
      'Only site admins can open this area.',
    )
    // Not merely "the rail has no link": the section's own page rendered
    // nothing, which is what a typed URL or a held bookmark reaches.
    expect(document.body.textContent).not.toContain('Error pages')
    expect(document.body.textContent).not.toContain(MAINTENANCE_LABEL)
    expect(maintenanceSwitch()).toBeNull()
  })

  it('shows an admin the pickers and the switch', () => {
    openTheSection()
    expect(document.body.textContent).toContain('Error pages')
    expect(document.body.textContent).toContain(MAINTENANCE_LABEL)
    expect(maintenanceSwitch()).toBeTruthy()
    expect(document.body.textContent).not.toContain(
      'Only site admins can open this area.',
    )
  })

  it('reflects a site already in maintenance, for the admin who can end it', () => {
    mockHostDoc = { $id: HOST_ID, maintenance: true }
    openTheSection()
    expect(maintenanceSwitch()?.checked).toBe(true)
  })
})

describe('the maintenance write still announces to the live caches', () => {
  /**
   * AGL-2934 established that a live-settings write announces to the caches,
   * and AGL-2690 built this particular drop. The card moved; the announce has
   * to move with it, or turning maintenance ON says visitors see the 503
   * screen while the site carries on serving — and turning it OFF strands a
   * site its owner has already brought back.
   */
  it('writes the flag and drops the WHOLE host', async () => {
    openTheSection()
    fireEvent.click(maintenanceSwitch() as HTMLInputElement)

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    expect(mockUpdateDoc.mock.calls[0][0]).toEqual({
      path: `hosts/${HOST_ID}`,
    })
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({ maintenance: true })

    // `entireHost`, not a screen fan-out: maintenance replaces every address,
    // including the ones no screen document holds.
    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages.mock.calls[0][0]).toEqual(
      expect.objectContaining({ hostId: HOST_ID, entireHost: true }),
    )
  })

  it('clears the flag on the way back, and drops the host again', async () => {
    mockHostDoc = { $id: HOST_ID, maintenance: true }
    openTheSection()
    fireEvent.click(maintenanceSwitch() as HTMLInputElement)

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    // The OFF direction is the one that matters: a site kept down after its
    // owner brought it back is an outage they cannot end.
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({
      maintenance: { __delete: true },
    })
    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages.mock.calls[0][0]).toEqual(
      expect.objectContaining({ entireHost: true }),
    )
  })

  it('says something weaker when the drop did not land', async () => {
    mockRevalidateLivePages.mockResolvedValue({ reason: 'not-configured' })
    openTheSection()
    fireEvent.click(maintenanceSwitch() as HTMLInputElement)

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1))
    // A snackbar promising the 503 screen is live while the cache still holds
    // the site is the original defect wearing a success message.
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toContain('take a few minutes')
  })
})
