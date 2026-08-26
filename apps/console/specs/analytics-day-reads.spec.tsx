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
 * A run of day-docs is paid for once per window, on EVERY analytics panel
 * (AGL-1440 / AGL-703).
 *
 * `analytics-day-cache.spec.ts` pins the cache. This pins the last surface
 * that was not using it: the per-screen traffic panel walked its 14-day window
 * with 14 raw `getDoc`s on every mount, so clicking through twenty screens cost
 * 280 reads for data that cannot change — thirteen of those fourteen days are
 * CLOSED, written by the day they name and never again.
 *
 * It is the same defect Zach named on "Used by" (*"that will get expensive"*),
 * one collection over, and it survived the AGL-1440 sweep that fixed the media
 * drawer and the host traffic panel.
 *
 * The second assertion here is not about cost at all. These day-docs are
 * PER-SCREEN — `screenAnalytics/{screenId}:{day}` — unlike the host-level
 * `analytics/{day}` documents every other panel reads, so a cache key that
 * ignored the screen id would hand one screen's traffic to the next screen
 * opened. Caching the wrong thing is worse than not caching.
 */
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { resetAnalyticsDayCache } from '../utils/analytics-day-cache'
import ScreenAnalyticsCard from '../components/analytics/screen-analytics-card.component'

const mockGetDoc = jest.fn()

jest.mock('firebase/firestore', () => ({
  doc: (...path: unknown[]) => path.slice(1).join('/'),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'pro' }, ready: true }),
}))
jest.mock('../constants/entitlements', () => ({
  hasEntitlement: () => true,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}))

/** Every day-doc path the card asked the server for. */
const requestedPaths = () => mockGetDoc.mock.calls.map((call) => String(call[0]))

beforeEach(() => {
  resetAnalyticsDayCache()
  mockGetDoc.mockReset()
  mockGetDoc.mockImplementation(async (path: string) =>
    // The screen id is in the document id, so a mixed-up cache shows up as a
    // number belonging to the other screen.
    ({ get: (field: string) => (field === 'total' && path.includes('screen-a') ? 7 : 0) }),
  )
})

const DAYS = 14

describe('per-screen traffic reads its window once (AGL-703)', () => {
  it('THE COST: a second visit to the same screen reads nothing', async () => {
    const first = render(
      <ScreenAnalyticsCard hostId="h1" screenId="screen-a" />,
    )
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(DAYS))
    first.unmount()

    render(<ScreenAnalyticsCard hostId="h1" screenId="screen-a" />)
    // The live day carries a 60s TTL and everything behind it is closed, so
    // an immediate re-open pays nothing at all.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockGetDoc).toHaveBeenCalledTimes(DAYS)
  })

  it('keys the cache by SCREEN, so one screen cannot answer for another', async () => {
    render(<ScreenAnalyticsCard hostId="h1" screenId="screen-a" />)
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(DAYS))
    const forA = requestedPaths()

    render(<ScreenAnalyticsCard hostId="h1" screenId="screen-b" />)
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(DAYS * 2))
    const forB = requestedPaths().slice(DAYS)

    // A different screen is a different window, read in full.
    expect(forA.every((path) => path.includes('screen-a'))).toBe(true)
    expect(forB.every((path) => path.includes('screen-b'))).toBe(true)
    expect(forA).not.toEqual(forB)
  })

  it('reads the per-screen collection, not the host day-docs', async () => {
    // The shapes differ — a key collision with the host traffic panel would
    // return an object with no `total` and render the dashboard's numbers as
    // NaN, which is the trap `entry-analytics-card` documents.
    render(<ScreenAnalyticsCard hostId="h1" screenId="screen-a" />)
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(DAYS))
    for (const path of requestedPaths()) {
      expect(path).toContain('screenAnalytics')
      expect(path).toMatch(/screen-a:\d{4}-\d{2}-\d{2}$/)
    }
  })
})
