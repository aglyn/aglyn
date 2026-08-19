/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * The churn report SURFACE (AGL-2248).
 *
 * The route is only half the fix. `orgs/{orgId}/retention` was write-only
 * because nothing read it, and a route nobody renders is the same condition
 * with an extra file in it — Zach's AGL-1900 rule: a capability is not a
 * feature until the console exposes it. So the first assertion here is not a
 * behaviour, it is that the card is MOUNTED, read off the page source.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: any) => (
    <section aria-label={String(header)}>{children}</section>
  ),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

import StaffChurnReportCard from './staff-churn-report-card.component'

/** The body the route returns, minus whatever a given test does not care for. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    byReason: { too_expensive: 3, missing_features: 1, not_using_enough: 0 },
    bySurface: { subscription_cancel: 3, account_delete: 1 },
    byPlan: { pro: 3, starter: 1 },
    surveys: 4,
    cancels: { total: 6, funnelSkipped: 2 },
    winbacks: { reserved: 3, applied: 2 },
    scanned: 13,
    capped: false,
    ...overrides,
  }
}

let answer: { ok: boolean; status: number; payload: unknown }

beforeEach(() => {
  answer = { ok: true, status: 200, payload: body() }
  global.fetch = jest.fn(async () => ({
    ok: answer.ok,
    status: answer.status,
    json: async () => answer.payload,
  })) as any
})

afterEach(() => jest.restoreAllMocks())

describe('the card is actually on the staff overview (AGL-2248)', () => {
  it('is imported AND rendered by the overview page', () => {
    const source = readFileSync(
      join(__dirname, '../app/(app)/admin/overview/page.tsx'),
      'utf8',
    )
    // Both halves: an import with no JSX is the "computed but not wired"
    // shape that has bitten this repo repeatedly.
    expect(source).toContain(
      "from '../../../../components/staff-churn-report-card.component'",
    )
    expect(source).toContain('<StaffChurnReportCard />')
  })
})

describe('what the card says (AGL-2248)', () => {
  it('ranks the reasons people gave, with their share', async () => {
    render(<StaffChurnReportCard />)
    // Descending — the reason people actually give is the first line read.
    const expensive = await screen.findByText('Too expensive')
    expect(expensive).toBeTruthy()
    expect(screen.getByText('3 (75%)')).toBeTruthy()
    expect(screen.getByText('Missing features')).toBeTruthy()
    // A reason nobody chose is not a row — the route already reports its 0.
    expect(screen.queryByText('Not using enough')).toBeNull()
  })

  it('states the departures the survey never saw — the honesty line', async () => {
    render(<StaffChurnReportCard />)
    // 4 surveys against 6 departures: the breakdown above describes two
    // thirds of the people who left, and saying so is the difference between
    // a report and a flattering one.
    const line = await screen.findByText(/6 departures recorded/)
    expect(line.textContent).toContain('2 without the funnel')
    expect(line.textContent).toContain('2/3 winback offers applied')
  })

  it('NEGATIVE CONTROL: a capped scan says so instead of reading as a total', async () => {
    answer = { ok: true, status: 200, payload: body({ capped: true, scanned: 2000 }) }
    render(<StaffChurnReportCard />)
    expect(
      await screen.findByText(/Showing the first 2000 retention records/),
    ).toBeTruthy()
  })

  it('NEGATIVE CONTROL: an UNCAPPED scan shows no such warning', async () => {
    render(<StaffChurnReportCard />)
    await screen.findByText('Too expensive')
    expect(screen.queryByText(/Showing the first/)).toBeNull()
  })

  it('no surveys but real departures is a FINDING, not an empty state', async () => {
    answer = {
      ok: true,
      status: 200,
      payload: body({
        surveys: 0,
        byReason: {},
        cancels: { total: 5, funnelSkipped: 5 },
      }),
    }
    render(<StaffChurnReportCard />)
    const line = await screen.findByText(/5 departures recorded/)
    expect(line.textContent).toContain('5 of them without the funnel')
  })

  it('a refusal is shown, never silently blank', async () => {
    answer = { ok: false, status: 403, payload: { error: 'Staff only' } }
    render(<StaffChurnReportCard />)
    expect(await screen.findByText('Staff only')).toBeTruthy()
  })
})
