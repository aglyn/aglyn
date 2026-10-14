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
 * The installation detail page's site-set panel hands `PluginSiteSet` the
 * listing its actions read (AGL-3790). The uninstall dialog scans published
 * pages by that listing's `pluginId`; a listing without one leaves the impact
 * unknown, so every uninstall from this page asked for the typed word.
 */

import { render } from '@testing-library/react'

const docs: Record<string, unknown> = {}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_firestore: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useHostOrgId: () => 'org-1',
  useFirestoreDoc: (ref: () => string | null) => {
    const path = ref()
    return { data: path ? docs[path] : undefined }
  },
}))

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  offeredPluginVersion: () => undefined,
}))

jest.mock('../hooks/use-marketplace-actions', () => ({
  __esModule: true,
  useMarketplaceActions: () => ({ installPlan: jest.fn(), uninstall: jest.fn() }),
}))

const siteSetProps = jest.fn()
jest.mock('./plugin-site-set.component', () => ({
  __esModule: true,
  default: (props: { listing: unknown }) => {
    siteSetProps(props)
    return null
  },
}))

import { PluginSiteSetPanel } from './plugin-site-set-panel.component'

const orgPin = {
  scope: 'org',
  pluginId: 'atlas',
  displayName: 'Atlas',
  version: '1.2.0',
}

describe('PluginSiteSetPanel', () => {
  beforeEach(() => {
    for (const key of Object.keys(docs)) delete docs[key]
    siteSetProps.mockClear()
  })

  it("passes the listing's pluginId, so the uninstall dialog can scan its impact", () => {
    docs['orgs/org-1/installs/listing-1'] = orgPin
    docs['marketplaceListings/listing-1'] = {
      pluginId: 'atlas',
      displayName: 'Atlas',
      latestVersion: '1.3.0',
    }

    render(<PluginSiteSetPanel hostId="host-1" listingId="listing-1" />)

    expect(siteSetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        listing: expect.objectContaining({ $id: 'listing-1', pluginId: 'atlas' }),
      }),
    )
  })

  it("falls back to the install pin's pluginId while the listing is unread", () => {
    docs['orgs/org-1/installs/listing-1'] = orgPin

    render(<PluginSiteSetPanel hostId="host-1" listingId="listing-1" />)

    expect(siteSetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        listing: expect.objectContaining({ pluginId: 'atlas' }),
      }),
    )
  })
})
