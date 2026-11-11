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

import { render, screen, waitFor } from '@testing-library/react'

const docs: Record<string, unknown> = {}
/**
 * A path's read as the live listen reports it before the server answers
 * (AGL-4047): `loading`, or a cached "missing" the server has not confirmed.
 */
const unconfirmed: Record<string, 'loading' | 'fromCache'> = {}
/** Site pins: `hosts/{id}/installs/{listing}` → the pin, absent = none. */
const sitePinDocs: Record<string, unknown> = {}
let mockOrgIdState = { orgId: 'org-1' as string | null, loaded: true }
let sitePinsReject = false

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_firestore: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn(async (path: string) => {
    if (sitePinsReject) throw new Error('client is offline')
    return {
      exists: () => path in sitePinDocs,
      data: () => sitePinDocs[path],
    }
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useHostOrgIdState: (hostId: string | undefined) =>
    hostId ? mockOrgIdState : { orgId: null, loaded: true },
  useFirestoreDoc: (ref: () => string | null) => {
    const path = ref()
    if (!path) return { data: undefined, status: 'loading', fromCache: true }
    const pending = unconfirmed[path]
    if (pending === 'loading')
      return { data: undefined, status: 'loading', fromCache: true }
    if (pending === 'fromCache')
      return { data: undefined, status: 'success', fromCache: true }
    return { data: docs[path], status: 'success', fromCache: false }
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
    for (const key of Object.keys(unconfirmed)) delete unconfirmed[key]
    for (const key of Object.keys(sitePinDocs)) delete sitePinDocs[key]
    mockOrgIdState = { orgId: 'org-1', loaded: true }
    sitePinsReject = false
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

  it('marks a site whose own switch has the listing off, from the hosts the page hands over (AGL-4047)', async () => {
    docs['orgs/org-1/installs/listing-1'] = orgPin

    render(
      <PluginSiteSetPanel
        hostId="host-1"
        listingId="listing-1"
        hosts={[
          { id: 'host-1', label: 'Bakery', disabledPlugins: null },
          { id: 'host-2', label: 'Cafe', disabledPlugins: ['listing-1'] },
        ]}
      />,
    )

    await waitFor(() => expect(siteSetProps).toHaveBeenCalled())
    const { orgInstall } = siteSetProps.mock.calls.at(-1)[0]
    expect(orgInstall.sites).toEqual([
      expect.not.objectContaining({ hostId: 'host-1', switchedOff: true }),
      expect.objectContaining({ hostId: 'host-2', pinnedBy: 'org', switchedOff: true }),
    ])
    expect('switchedOff' in orgInstall.sites[0]).toBe(false)
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

  /*
   * While loading it says loading, never a verdict (AGL-4047). "Not installed
   * on any site" rests on there being no pin anywhere, and the page said it
   * for about 9 s about a plugin installed org-wide while the org pin's
   * listen waited on the server.
   */
  describe('while the pins load', () => {
    const HOSTS = [
      { id: 'host-1', label: 'Bakery' },
      { id: 'host-2', label: 'Cafe' },
    ]
    const NOT_INSTALLED = 'Not installed on any site in this organization.'

    it('says loading, not "not installed", while the org pin is unanswered', async () => {
      unconfirmed['orgs/org-1/installs/listing-1'] = 'loading'

      render(
        <PluginSiteSetPanel hostId="host-1" listingId="listing-1" hosts={HOSTS} />,
      )

      await waitFor(() =>
        expect(screen.getByText('Loading where it is installed…')).toBeTruthy(),
      )
      expect(screen.queryByText(NOT_INSTALLED)).toBeNull()
      expect(siteSetProps).not.toHaveBeenCalled()
    })

    it('treats a cached "missing" the server has not confirmed as loading', async () => {
      unconfirmed['orgs/org-1/installs/listing-1'] = 'fromCache'

      render(
        <PluginSiteSetPanel hostId="host-1" listingId="listing-1" hosts={HOSTS} />,
      )

      await waitFor(() =>
        expect(screen.getByText('Loading where it is installed…')).toBeTruthy(),
      )
      expect(screen.queryByText(NOT_INSTALLED)).toBeNull()
    })

    it('holds while the site list itself is still loading', () => {
      render(
        <PluginSiteSetPanel
          hostId="host-1"
          listingId="listing-1"
          hosts={[]}
          hostsReady={false}
        />,
      )

      expect(screen.getByText('Loading where it is installed…')).toBeTruthy()
      expect(screen.queryByText(NOT_INSTALLED)).toBeNull()
    })

    it('says "not installed" once the server confirms no org pin and every site pin is read', async () => {
      render(
        <PluginSiteSetPanel hostId="host-1" listingId="listing-1" hosts={HOSTS} />,
      )

      await waitFor(() => expect(screen.getByText(NOT_INSTALLED)).toBeTruthy())
    })

    it('says a failed read failed, never "not installed"', async () => {
      sitePinsReject = true

      render(
        <PluginSiteSetPanel hostId="host-1" listingId="listing-1" hosts={HOSTS} />,
      )

      await waitFor(() =>
        expect(
          screen.getByText(/Could not load where this plugin is installed/),
        ).toBeTruthy(),
      )
      expect(screen.queryByText(NOT_INSTALLED)).toBeNull()
    })

    it("reads the org pin under the page's own org, not a lookup through a site", async () => {
      // The lookup through the acting site settled to "no org", as a failed
      // one-shot read does. The page's org still finds the org-wide pin.
      mockOrgIdState = { orgId: null, loaded: true }
      docs['orgs/org-1/installs/listing-1'] = orgPin

      render(
        <PluginSiteSetPanel
          hostId="host-1"
          listingId="listing-1"
          hosts={HOSTS}
          orgId="org-1"
        />,
      )

      await waitFor(() => expect(siteSetProps).toHaveBeenCalled())
      expect(siteSetProps.mock.calls.at(-1)[0].orgInstall.orgWide).toBe(true)
      expect(screen.queryByText(NOT_INSTALLED)).toBeNull()
    })
  })
})
