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

import { render, screen } from '@testing-library/react'

/**
 * The run line beside a site's automations (AGL-2171), and what it says for a
 * band with no figure (AGL-3049): an uncapped staff comp resolves the run
 * allowance `UNLIMITED`, and `Infinity.toLocaleString()` is "∞", so the line
 * read "∞ included".
 */

const MONTH = new Date().toISOString().slice(0, 7)
/** ONE Firestore handle, held: a double that minted one per call would re-key the read. */
const mockFirestore = {}
let mockCounter: Record<string, unknown> | undefined

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  useFirestoreDoc: () => ({ data: mockCounter, status: 'success' }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'
import RunQuotaLine from './run-quota-line.component'

beforeEach(() => {
  mockCounter = { [MONTH]: 1_284 }
})

describe('the run line says what the band includes', () => {
  it('a plan band: the runs this month against the figure it includes', () => {
    render(<RunQuotaLine hostId="host-1" org={{ plan: 'pro', billingStatus: 'active' }} counter="workflowRuns" />)
    expect(
      screen.getByText(
        `1,284 workflow runs this month · ${PLAN_ENTITLEMENTS.pro.workflowRunsPerMonth.toLocaleString()} included`,
      ),
    ).toBeTruthy()
  })

  it('an uncapped staff comp: no monthly limit, never ∞ or Infinity (AGL-3049)', () => {
    const org = {
      plan: 'enterprise',
      enterprise: true,
      entitlements: {
        planComp: { plan: 'enterprise', uncapped: true, reason: 'other', grantedBy: 'staff-1' },
      },
    }
    const { container } = render(<RunQuotaLine hostId="host-1" org={org} counter="actionRuns" />)
    expect(container.textContent).toBe('1,284 action runs this month · no monthly limit')
    expect(container.textContent).not.toMatch(/∞|Infinity/)
  })
})
