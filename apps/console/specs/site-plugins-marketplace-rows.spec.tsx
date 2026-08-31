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
 * A site's plugin list holds the workspace's MARKETPLACE installs too
 * (AGL-1014).
 *
 * The list derived its rows from `org.enabledPlugins`, and that field is
 * ABSENT for every workspace that never touched the built-in switchboard —
 * `syncEnabledPlugins` deliberately does not create it, because an absent
 * field means default-open and writing the first id would switch off every
 * plugin not named in it. So an org could install a marketplace plugin, have
 * it running on every one of its sites, and find nothing in any site's console
 * that listed it, let alone switched it off there.
 *
 * The install PINS are the durable record, so the rows come from those. The
 * two kinds stay in separate groups: which one a row is is the first thing a
 * site admin needs to know before switching it, and a merged list withholds
 * exactly that.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockOrgInstalls: Array<Record<string, unknown>> = []
let mockHostInstalls: Array<Record<string, unknown>> = []
let mockOrg: Record<string, unknown> = {}

const mockHost = {
  data: { $id: 'host-1' } as unknown as Record<string, unknown>,
  status: 'success' as const,
  fromCache: false,
}
const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  limit: jest.fn(() => ({})),
  query: jest.fn((ref: unknown) => ref),
}))
/*
 * COMPLETE. The card reaches this module for the host document, the signed-in
 * user, the seed guard AND the two install collections — a partial mock leaves
 * one `undefined` and the card dies calling it, in a stack that names the card
 * rather than the missing member.
 */
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: mockHost, setDoc: mockSetDoc }),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  // Keyed off the collection path the factory above returns, so the org pins
  // and the host pins are genuinely two different reads rather than one
  // fixture answering both.
  useFirestoreCollection: (build: () => unknown) => {
    const path = String(build() ?? '')
    if (path.startsWith('orgs/')) return { data: mockOrgInstalls }
    if (path.startsWith('hosts/')) return { data: mockHostInstalls }
    return { data: [] }
  },
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => <span aria-hidden="true" />,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
}))
jest.mock('../components/host-id-provider', () => ({
  useHostSubdomain: () => 'shop',
}))

import SitePluginsCard from '../components/site-plugins-card.component'

const switchFor = (label: string) =>
  document.querySelector<HTMLInputElement>(
    `input[aria-label="Toggle ${label} on this site"]`,
  )

describe('SitePluginsCard — marketplace installs (AGL-1014)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgInstalls = []
    mockHostInstalls = []
    // The default-open workspace: no `enabledPlugins` field at all. This is
    // the shape the old derivation could not see a marketplace install in.
    mockOrg = {}
  })

  it('lists an org-wide install a default-open workspace never wrote to the switchboard', () => {
    mockOrgInstalls = [
      { $id: 'listing-abc', displayName: 'Loyalty Points', version: '2.1.0' },
    ]
    render(<SitePluginsCard hostId="host-1" />)
    expect(screen.getByText('Loyalty Points')).toBeTruthy()
    expect(switchFor('Loyalty Points')).toBeTruthy()
  })

  it('names it by its display name, never by its listing document id', () => {
    mockOrgInstalls = [
      { $id: 'listing-abc', displayName: 'Loyalty Points', version: '2.1.0' },
    ]
    render(<SitePluginsCard hostId="host-1" />)
    expect(screen.queryByText('listing-abc')).toBeNull()
  })

  it('keeps built-ins and marketplace installs in separate groups', () => {
    mockOrgInstalls = [{ $id: 'listing-abc', displayName: 'Loyalty Points' }]
    render(<SitePluginsCard hostId="host-1" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Built in')
    expect(text).toContain('Installed from the marketplace')
    // The distinction is only real if it is ORDERED: the marketplace heading
    // must come after the built-in one and before the marketplace row, or the
    // headings are decoration over one undifferentiated list.
    const builtIn = text.indexOf('Built in')
    const heading = text.indexOf('Installed from the marketplace')
    const row = text.indexOf('Loyalty Points')
    expect(builtIn).toBeLessThan(heading)
    expect(heading).toBeLessThan(row)
    // And a built-in row is genuinely on the other side of it.
    expect(text.indexOf('Commerce')).toBeLessThan(heading)
  })

  it('links the row to the plugin page for THIS site', () => {
    mockOrgInstalls = [{ $id: 'listing-abc', displayName: 'Loyalty Points' }]
    render(<SitePluginsCard hostId="host-1" />)
    const link = Array.from(document.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes('Loyalty Points'),
    )
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/shop/admin/plugins/listing-abc',
    )
  })

  it('a host-only install is listed too', () => {
    mockHostInstalls = [{ $id: 'listing-xyz', displayName: 'Store Locator' }]
    render(<SitePluginsCard hostId="host-1" />)
    expect(switchFor('Store Locator')).toBeTruthy()
  })

  /**
   * The CONTROL. Without it every assertion above would still pass for a card
   * that printed a marketplace row unconditionally — including for a
   * workspace that has installed nothing, which is most of them.
   */
  it('says so plainly when the workspace has installed nothing', () => {
    render(<SitePluginsCard hostId="host-1" />)
    expect(switchFor('Loyalty Points')).toBeNull()
    expect(document.body.textContent).toContain(
      'Nothing installed from the marketplace runs on this site',
    )
    // The built-in half is unaffected — the empty state is about one group.
    expect(switchFor('Commerce')).toBeTruthy()
  })
})
