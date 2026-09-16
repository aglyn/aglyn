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
 * The staff org usage table's AI columns and credit pool line (AGL-2984),
 * contributed through the `staffOrgUsageColumn` zone.
 *
 * Three things are pinned. A rollup written before the credit meter renders
 * a DASH, never a zero — `0` there would state, as measurement, that the org
 * used no AI in a month nobody measured. Assist spend renders to four
 * decimals, so a month that really cost eight cents does not read `$0.00`.
 * And the pool line names the add-on, the whole band and the add-on's share
 * of it in three shapes that cannot drift into one — drawn above the table
 * where the page holds the org document, and nowhere it does not.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { AI_ADDON_CREDITS_PER_MONTH } from '@aglyn/aglyn/app-utils/plan-entitlements'
// The AI add-on's band is this plugin's declaration: without it the pool
// resolves no add-on credits at all.
import '../declarations'
import {
  aiCreditsCell,
  aiOverageCell,
  assistPoolSentence,
  staffAssistPool,
} from '../usage/staff-org-usage-ai'
import {
  StaffOrgUsageAiCreditsCell,
  StaffOrgUsageAiOverageCell,
  StaffOrgUsageAiPool,
  StaffOrgUsageAssistCell,
} from './staff-org-usage-ai-columns.component'

describe('the AI columns of the staff usage table', () => {
  it('renders the recorded credits and the billed overage per month', () => {
    const august = { assistCredits: 1_234, assistOverageUsd: 3.5 }
    const july = { assistCredits: null, assistOverageUsd: null }
    render(
      <>
        <span>
          <StaffOrgUsageAiCreditsCell month={august} />
        </span>
        <span>
          <StaffOrgUsageAiOverageCell month={august} />
        </span>
        <span>
          <StaffOrgUsageAiCreditsCell month={july} />
        </span>
        <span>
          <StaffOrgUsageAiOverageCell month={july} />
        </span>
      </>,
    )
    expect(screen.getByText('1,234')).toBeTruthy()
    expect(screen.getByText('$3.50')).toBeTruthy()
    // The July row predates the meter: two dashes, no zeros.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('renders null as a dash and a value as itself', () => {
    expect(aiCreditsCell(null)).toBe('—')
    expect(aiCreditsCell(undefined)).toBe('—')
    expect(aiCreditsCell(0)).toBe('0')
    expect(aiCreditsCell(18_750)).toBe('18,750')
    expect(aiOverageCell(null)).toBe('—')
    expect(aiOverageCell(0)).toBe('$0.00')
    expect(aiOverageCell(6.25)).toBe('$6.25')
  })

  it('renders an Assist column carrying the month’s spend, to four decimals', () => {
    render(<StaffOrgUsageAssistCell month={{ assistCostUsd: 44.125 }} />)
    expect(screen.getByText('$44.1250')).toBeTruthy()
  })

  it('does not print $0.00 for a sub-cent month', () => {
    render(<StaffOrgUsageAssistCell month={{ assistCostUsd: 0.085 }} />)
    expect(screen.getByText('$0.0850')).toBeTruthy()
  })
})

describe('the AI credit pool line on the staff usage table', () => {
  it('names the add-on, the whole band, and the add-on’s share of it', () => {
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

  it('resolves the pool from the org document as the meter does', () => {
    // The override replaces the plan band; the add-on stacks on it.
    expect(
      staffAssistPool({
        plan: 'pro',
        seatAddons: { aiAddon: 1 },
        entitlements: { assistCreditsPerMonth: 12_000 },
        subscription: { status: 'active' },
      } as never),
    ).toEqual({
      aiAddon: true,
      addonCredits: AI_ADDON_CREDITS_PER_MONTH.pro,
      creditsPerMonth: 12_000 + AI_ADDON_CREDITS_PER_MONTH.pro,
    })
    expect(
      staffAssistPool({ plan: 'starter', subscription: { status: 'active' } } as never),
    ).toEqual({ aiAddon: false, addonCredits: 0, creditsPerMonth: null })
  })

  it('names an uncapped staff comp as the reason there is no band, never ∞ (AGL-3049)', () => {
    const org = {
      plan: 'enterprise',
      enterprise: true,
      entitlements: {
        planComp: {
          plan: 'enterprise',
          uncapped: true,
          reason: 'other',
          note: 'Internal workspace',
          grantedBy: 'staff-1',
        },
      },
    } as never
    expect(staffAssistPool(org)).toEqual({
      aiAddon: false,
      addonCredits: 0,
      creditsPerMonth: null,
      uncapped: true,
    })
    expect(assistPoolSentence(staffAssistPool(org))).toBe(
      'Aglyn AI add-on off — no AI credit band (uncapped staff comp).',
    )
    // The control: the same grant capped names Enterprise's band.
    const capped = {
      plan: 'enterprise',
      enterprise: true,
      entitlements: {
        planComp: { plan: 'enterprise', uncapped: false, reason: 'other', grantedBy: 'staff-1' },
      },
    } as never
    expect(assistPoolSentence(staffAssistPool(capped))).toBe(
      'Aglyn AI add-on off — 116,000 AI credits/mo.',
    )
  })

  it('draws the line from the org document, and nothing without one', () => {
    const org = {
      plan: 'pro',
      seatAddons: { aiAddon: 1 },
      subscription: { status: 'active' },
    } as never
    const { container, unmount } = render(<StaffOrgUsageAiPool org={org} />)
    expect(container.textContent).toBe(assistPoolSentence(staffAssistPool(org)))
    expect(container.textContent).toMatch(/ add-on on — /)
    unmount()
    // The Organizations list's dialog holds an id and no document, so it
    // mounts no line — and a line claiming "add-on off" there would be a
    // claim nobody checked.
    expect(render(<StaffOrgUsageAiPool />).container.textContent).toBe('')
  })

  it('is drawn directly above the table on the org page, and not in the list’s dialog', () => {
    const repo = join(__dirname, '..', '..', '..', '..', '..', '..')
    const orgPage = readFileSync(
      join(repo, 'apps/console/app/(app)/admin/orgs/[orgId]/page.tsx'),
      'utf8',
    )
    const usageCard = orgPage.indexOf("header={'Metered usage'}")
    const line = orgPage.indexOf(
      '<PluginWidgetSlot slot="staffOrgUsageColumn" orgId={orgId} org={org',
    )
    const table = orgPage.indexOf('<StaffOrgUsageTable', line)
    expect(usageCard).toBeGreaterThan(0)
    expect(line).toBeGreaterThan(usageCard)
    // In the one branch that renders the table, which draws its empty state
    // too — so the line is above the rows and above "no rollups" alike.
    expect(table).toBeGreaterThan(line)
    expect(table - line).toBeLessThan(200)
    const listPage = readFileSync(
      join(repo, 'apps/console/app/(app)/admin/orgs/page.tsx'),
      'utf8',
    )
    expect(listPage).toContain("usePluginListColumns('staffOrgUsageColumn')")
    expect(listPage).not.toContain('slot="staffOrgUsageColumn"')
  })
})
