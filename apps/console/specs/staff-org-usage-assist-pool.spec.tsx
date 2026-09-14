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
 * The staff usage panel names the org's AI credit pool (AGL-2899).
 *
 * The Assist column is provider dollars; whoever reads it needs to know what
 * band those dollars are drawn against and whether the Aglyn AI add-on is
 * part of the band. The org detail page resolves the pool from the org
 * document and hands it in; the sentence is pinned here so its three shapes
 * — add-on on, add-on off, no band — cannot drift into one.
 */

import { render, screen } from '@testing-library/react'
import StaffOrgUsageTable, {
  assistPoolSentence,
} from '../components/staff-org-usage-table.component'

const MONTH = {
  month: '2026-09',
  storageGb: 1.2,
  pageViews: 10_000,
  formSubmissions: 3,
  costUsd: 0.4,
  assistCostUsd: 2.25,
  deltas: null,
}

describe('the AI credit pool line on the staff usage table (AGL-2899)', () => {
  it('names the add-on, the whole band, and the add-on\'s share of it', () => {
    expect(
      assistPoolSentence({ aiAddon: true, addonCredits: 9_000, creditsPerMonth: 11_750 }),
    ).toBe('Aglyn AI add-on on — 11,750 AI credits/mo, 9,000 of them from the add-on.')
    expect(
      assistPoolSentence({ aiAddon: false, addonCredits: 0, creditsPerMonth: 2_750 }),
    ).toBe('Aglyn AI add-on off — 2,750 AI credits/mo.')
    // No band at all (Free, Starter without the add-on): said as such, not
    // as "0 credits".
    expect(
      assistPoolSentence({ aiAddon: false, addonCredits: 0, creditsPerMonth: null }),
    ).toBe('Aglyn AI add-on off — no AI credit band.')
  })

  it('renders above the rollup rows, and above the empty state too', () => {
    const pool = { aiAddon: true, addonCredits: 9_000, creditsPerMonth: 11_750 }
    const { unmount } = render(
      <StaffOrgUsageTable months={[MONTH]} assistPool={pool} />,
    )
    expect(screen.getByText(assistPoolSentence(pool))).toBeTruthy()
    expect(screen.getByText('$2.2500')).toBeTruthy()
    unmount()

    render(<StaffOrgUsageTable months={[]} assistPool={pool} />)
    expect(screen.getByText(assistPoolSentence(pool))).toBeTruthy()
    expect(
      screen.getByText('No usage rollups recorded for this organization yet.'),
    ).toBeTruthy()
  })

  it('says nothing about the pool when the caller could not resolve one', () => {
    // The Organizations list's dialog holds an id and no document, so it
    // passes nothing — and a line claiming "add-on off" there would be a
    // claim nobody checked.
    render(<StaffOrgUsageTable months={[MONTH]} />)
    expect(screen.queryByText(/Aglyn AI add-on/)).toBeNull()
  })
})
