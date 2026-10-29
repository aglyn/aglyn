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

import type { SiteStarterSummary } from '../plugin-manager/plugin-site-starters'
import { readSiteStarterPickRefusal, siteStarterPickBlock } from './site-starter-pick'

/**
 * A pick in "Choose your starter" (AGL-4049 lane 3): whether Create site can
 * create from it, and what the create's refusal of it asks for.
 */

const FREE: SiteStarterSummary = {
  listingId: 'fp-starter-restaurant-base',
  displayName: 'Restaurant & café',
  description: '',
  authorName: 'Aglyn',
  official: true,
  priceUsd: 0,
  previewImageUrl: null,
  facets: { kind: 'restaurant', base: 'starter', fonts: null, pages: 4, mode: 'base' },
}
const PAID: SiteStarterSummary = { ...FREE, listingId: 'northwind-studio', official: false, priceUsd: 12 }

describe('siteStarterPickBlock', () => {
  it('waits for a pick: nothing is chosen for anyone', () => {
    expect(siteStarterPickBlock(null)).toBe('none')
    expect(siteStarterPickBlock(undefined)).toBe('none')
  })

  it('creates from a free pick, and from a priced one the workspace owns', () => {
    expect(siteStarterPickBlock(FREE)).toBeNull()
    expect(siteStarterPickBlock({ ...PAID, owned: true })).toBeNull()
  })

  it('asks for the price of one it does not own, and lets the surface know better', () => {
    expect(siteStarterPickBlock(PAID)).toBe('purchase')
    expect(siteStarterPickBlock({ ...PAID, owned: false })).toBe('purchase')
    // Just paid for, before the search has caught up.
    expect(siteStarterPickBlock({ ...PAID, owned: false }, true)).toBeNull()
    // The create still asked for payment.
    expect(siteStarterPickBlock({ ...PAID, owned: true }, false)).toBe('purchase')
  })
})

describe('readSiteStarterPickRefusal', () => {
  it('keeps a pick the create asked payment for, with Buy offered', () => {
    expect(
      readSiteStarterPickRefusal(402, { error: 'Purchase required', code: 'purchase_required', listingId: 'l-1', priceUsd: 12 }, 'l-1'),
    ).toEqual({ keep: true, purchase: true, message: 'Purchase required' })
  })

  it.each([
    [403, 'Site starters are not available for this workspace yet'],
    [404, 'That starter is no longer available'],
    [409, 'This starter needs the AI start, which is coming soon'],
    [403, 'This starter has 6 pages; your plan includes 5. Pick a smaller starter or upgrade in Billing.'],
  ])('clears a pick refused with a %i, in the create’s words', (status, error) => {
    expect(readSiteStarterPickRefusal(status, { error, listingId: 'l-1' }, 'l-1')).toEqual({
      keep: false,
      purchase: false,
      message: error,
    })
  })

  it('leaves a refusal of anything else — the address, the site count — to the create', () => {
    expect(readSiteStarterPickRefusal(409, { error: 'That subdomain is taken', suggestions: [] }, 'l-1')).toBeNull()
    expect(readSiteStarterPickRefusal(403, { error: 'Site limit reached (1)' }, 'l-1')).toBeNull()
    expect(readSiteStarterPickRefusal(404, { error: 'gone', listingId: 'other' }, 'l-1')).toBeNull()
    expect(readSiteStarterPickRefusal(402, null, 'l-1')).toBeNull()
  })
})
