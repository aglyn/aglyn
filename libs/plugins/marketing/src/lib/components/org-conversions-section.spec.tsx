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
 *
 * @jest-environment jsdom
 */

/**
 * THE ORGANIZATION'S CONVERSIONS: one site at a time, the site hub's own card.
 *
 * The card is stubbed to what it was handed, because what this section owns
 * is WHICH site it hands over and under which hub — the card's reads are the
 * site hub's, pinned by its own spec and by the read-cost meter.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Every set of props the conversions card was mounted with, in order. */
const mockMounted: Array<{ hostId: string; basePath: string; campaignId?: string }> = []

jest.mock('./campaign-conversions-card', () => ({
  __esModule: true,
  default: (props: { hostId: string; basePath: string; campaignId?: string }) => {
    mockMounted.push(props)
    return <div data-testid="conversions-card">{props.hostId}</div>
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useOrgDataScope: () => ({ orgId: 'org1', ready: true, scope: ['orgs', 'org1'] }),
}))

import { MarketingOrgMountProvider } from './marketing-org-mount'
import {
  conversionsSiteStorageKey,
  OrgConversionsSection,
} from './org-conversions-section'

type Site = { id: string; name: string; subdomain: string | null }

const SHOP: Site = { id: 'shop1', name: 'Shop', subdomain: 'shop' }
const BLOG: Site = { id: 'blog1', name: 'Blog', subdomain: 'blog' }

function renderSection(hosts: Site[], campaignId?: string) {
  return render(
    (
      <MarketingOrgMountProvider
        value={{
          orgId: 'org1',
          orgSlug: 'acme',
          hosts,
          hostsReady: true,
          hostsPath: '/acme/hosts',
          basePath: '/acme/marketing',
        }}
      >
        <OrgConversionsSection basePath="/acme/marketing" campaignId={campaignId} />
      </MarketingOrgMountProvider>
    ) as ReactNode as never,
  )
}

/** The site the card on screen is reading. */
const cardSite = () => screen.getByTestId('conversions-card').textContent

beforeEach(() => {
  mockMounted.length = 0
  window.sessionStorage.clear()
})

describe('which site', () => {
  it('reads the first site until the reader picks, under the org hub', () => {
    renderSection([SHOP, BLOG])
    expect(cardSite()).toBe('shop1')
    // Every mount was the first site's — none on the way to it.
    expect(mockMounted.map((props) => props.hostId)).toEqual(
      mockMounted.map(() => 'shop1'),
    )
    // A credited campaign opens under the ORG hub, where campaigns live.
    expect(mockMounted[0].basePath).toBe('/acme/marketing')
  })

  it('reads the site picked under “Conversions on”, and remembers it', () => {
    renderSection([SHOP, BLOG])
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Conversions on' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Blog'))

    expect(cardSite()).toBe('blog1')
    expect(window.sessionStorage.getItem(conversionsSiteStorageKey('org1'))).toBe(
      'blog1',
    )
  })

  it('opens on the remembered site, without reading the first on the way', () => {
    window.sessionStorage.setItem(conversionsSiteStorageKey('org1'), 'blog1')
    renderSection([SHOP, BLOG])
    expect(cardSite()).toBe('blog1')
    expect(mockMounted.some((props) => props.hostId === 'shop1')).toBe(false)
  })

  it('forgets a remembered site the organization no longer lists', () => {
    window.sessionStorage.setItem(conversionsSiteStorageKey('org1'), 'gone1')
    renderSection([SHOP, BLOG])
    expect(cardSite()).toBe('shop1')
  })

  it('asks nothing of an organization with one site', () => {
    renderSection([SHOP])
    expect(screen.queryByRole('combobox', { name: 'Conversions on' })).toBeNull()
    expect(cardSite()).toBe('shop1')
  })

  it('says why there is nothing to show before the organization has a site', () => {
    renderSection([])
    expect(screen.queryByTestId('conversions-card')).toBeNull()
    expect(screen.getByText(/has no sites yet/)).toBeTruthy()
  })
})

describe('one campaign', () => {
  it('hands the campaign in the URL to the card, as a site hub does', () => {
    renderSection([SHOP, BLOG], 'camp_7')
    expect(mockMounted[mockMounted.length - 1]).toEqual({
      hostId: 'shop1',
      basePath: '/acme/marketing',
      campaignId: 'camp_7',
    })
  })
})
