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
 * The Preview switch on Admin → Error pages (AGL-4086).
 *
 * It sits under maintenance mode and flips through the server door
 * (`/api/hosts/preview`), never with a client write: making a site public is
 * a launch, so the door checks the person is a site admin, drops every cached
 * page and reports the first publish. The harness is
 * `error-pages-are-admin-only.spec.tsx`'s.
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const HOST_ID = 'host-1'

/** The signed-in reader's standing on this site, per test. */
let mockIsHostAdmin = true
/** The host document the card reads its current settings from. */
let mockHostDoc: Record<string, unknown> = {}

const mockUpdateDoc = jest.fn().mockResolvedValue(undefined)
const mockRevalidateLivePages = jest.fn().mockResolvedValue({ reason: 'ok' })
const mockStagedEntries: { ref: unknown; data: unknown }[] = []
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
  deleteDoc: jest.fn(async () => undefined),
  serverTimestamp: () => '__now__',
  // The maintenance flag commits in ONE batch with its site-wide outbox entry
  // (AGL-3386): the host update reaches `mockUpdateDoc` as before, and the
  // entry is recorded beside it.
  writeBatch: () => ({
    update: (...args: unknown[]) => {
      void mockUpdateDoc(...args)
    },
    set: (ref: { path?: string }, data: unknown) => {
      mockStagedEntries.push({ ref, data })
    },
    commit: async () => undefined,
  }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1', getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
const mockAuthorizedFetch = jest.fn(
  async (_user: unknown, _url: string, init?: { body?: string }) => ({
    ok: true,
    json: async () => ({
      preview: JSON.parse(String(init?.body ?? '{}')).preview === true,
      dropped: true,
    }),
  }),
)
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) =>
    mockAuthorizedFetch(...(args as [unknown, string, { body?: string }])),
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

const PREVIEW_LABEL = 'Preview — only you and your team can see the site'

const openTheSection = () =>
  render(
    <HostAdminSectionsLayout>
      <HostAdminErrorPages />
    </HostAdminSectionsLayout>,
  )

/** The checkboxes in the order the card draws them: maintenance, then preview. */
const switches = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
const previewSwitch = () => switches()[1]

beforeEach(() => {
  jest.clearAllMocks()
  mockIsHostAdmin = true
  mockHostDoc = { $id: HOST_ID }
})

describe('the Preview switch on Error pages (AGL-4086)', () => {
  it('sits under maintenance mode, off for a public site', () => {
    openTheSection()
    expect(document.body.textContent).toContain(PREVIEW_LABEL)
    expect(switches()).toHaveLength(2)
    expect(previewSwitch().checked).toBe(false)
  })

  it('reads a site already in preview as on', () => {
    mockHostDoc = { $id: HOST_ID, preview: true }
    openTheSection()
    expect(previewSwitch().checked).toBe(true)
  })

  it('puts the site in preview through the server door, not a client write', async () => {
    openTheSection()
    fireEvent.click(previewSwitch())
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1))
    const [, url, init] = mockAuthorizedFetch.mock.calls[0]
    expect(url).toBe('/api/hosts/preview')
    expect(JSON.parse(String(init?.body))).toEqual({ hostId: HOST_ID, preview: true })
    // The host document is never written from here.
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Your site is in preview — only you and your team can see it',
        expect.anything(),
      ),
    )
  })

  it('makes a site in preview public the same way', async () => {
    mockHostDoc = { $id: HOST_ID, preview: true }
    openTheSection()
    fireEvent.click(previewSwitch())
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(mockAuthorizedFetch.mock.calls[0][2]?.body))).toEqual({
      hostId: HOST_ID,
      preview: false,
    })
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Your site is public', expect.anything()),
    )
  })

  it('is not there for someone who is not a site admin', () => {
    mockIsHostAdmin = false
    openTheSection()
    expect(document.body.textContent).not.toContain(PREVIEW_LABEL)
  })
})
