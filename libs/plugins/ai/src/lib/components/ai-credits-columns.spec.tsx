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
 * The AI credits columns of the two member tables (AGL-2928), contributed
 * by the AI plugin (AGL-2939). A column is mounted once per ROW, so the
 * month is read once for the whole table; the Team table's header sorts
 * the roster by a comparator it hands the table.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** ONE signed-in user, held: a fresh object per call is not what the provider hands back. */
const mockUser = { uid: 'admin-1', getIdToken: async () => 'token' }
const mockFetchCalls: string[] = []
let mockAnswer: { status: number; body: unknown } = { status: 200, body: null }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: async (_user: unknown, url: string) => {
    mockFetchCalls.push(url)
    return {
      ok: mockAnswer.status >= 200 && mockAnswer.status < 300,
      status: mockAnswer.status,
      json: async () => mockAnswer.body,
    }
  },
}))

import { aiUsageMonthKeys } from '@aglyn/aglyn'
import {
  AiCollaboratorCreditsCell,
  AiMemberCreditsCell,
  AiMemberCreditsHeader,
} from './ai-credits-columns.component'
import { resetOrgAiUsageReadsForTests } from './use-org-ai-usage'

const MONTH = aiUsageMonthKeys()[0]

function table(rows: Array<{ uid: string; credits: number; hostCredits?: number }>) {
  return {
    orgId: 'org-1',
    month: MONTH,
    months: aiUsageMonthKeys(),
    orgCredits: rows.reduce((sum, row) => sum + row.credits, 0),
    rows: rows.map((row) => ({
      name: row.uid,
      email: null,
      share: 0,
      requests: 1,
      refusals: 0,
      byKind: {},
      ...row,
    })),
  }
}

beforeEach(() => {
  resetOrgAiUsageReadsForTests()
  mockFetchCalls.length = 0
  mockAnswer = {
    status: 200,
    body: table([
      { uid: 'u1', credits: 40, hostCredits: 4 },
      { uid: 'u2', credits: 900, hostCredits: 90 },
    ]),
  }
})

describe('the org Team column', () => {
  it('reads the month ONCE for every row, and shows each member’s credits', async () => {
    render(
      <>
        <div>
          <AiMemberCreditsCell orgId="org-1" member={{ $id: 'u1' }} />
        </div>
        <div>
          <AiMemberCreditsCell orgId="org-1" member={{ $id: 'u2' }} />
        </div>
        <div>
          <AiMemberCreditsCell orgId="org-1" member={{ $id: 'u3' }} />
        </div>
      </>,
    )
    expect(await screen.findByText('900')).toBeTruthy()
    expect(screen.getByText('40')).toBeTruthy()
    // A member with no month document drew nothing this month.
    expect(screen.getByText('0')).toBeTruthy()
    expect(mockFetchCalls).toEqual([`/api/ai/usage?orgId=org-1&month=${MONTH}`])
  })

  it('a reader the route refuses sees a dash in every row, not a warning', async () => {
    mockAnswer = { status: 403, body: { error: 'Forbidden' } }
    render(<AiMemberCreditsCell orgId="org-1" member={{ $id: 'u1' }} />)
    await waitFor(() => expect(mockFetchCalls).toHaveLength(1))
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('the header hands the table a comparator by credits once the month is read', async () => {
    const onSort = jest.fn()
    render(<AiMemberCreditsHeader orgId="org-1" onSort={onSort} sorted={false} />)
    await waitFor(() => expect(mockFetchCalls).toHaveLength(1))
    const label = screen.getByText('AI credits (month)')
    await waitFor(() =>
      expect(label.closest('[role="button"]')?.getAttribute('aria-disabled')).not.toBe('true'),
    )
    act(() => {
      fireEvent.click(label)
    })
    await waitFor(() => expect(onSort.mock.calls.at(-1)?.[0]).toEqual(expect.any(Function)))
    const compare = onSort.mock.calls.at(-1)?.[0] as (a: object, b: object) => number
    const rows = [{ $id: 'u1' }, { $id: 'u2' }]
    expect([...rows].sort(compare).map((row) => row.$id)).toEqual(['u2', 'u1'])
    // Sorting reuses the month the header already read.
    expect(mockFetchCalls).toHaveLength(1)
  })
})

describe('the site collaborators column', () => {
  it('shows the credits drawn on THIS site, and a dash for an invitation', async () => {
    render(
      <>
        <div>
          <AiCollaboratorCreditsCell orgId="org-1" hostId="host-1" member={{ uid: 'u2' }} />
        </div>
        <div>
          <AiCollaboratorCreditsCell
            orgId="org-1"
            hostId="host-1"
            member={{ $id: 'invite-1', status: 'invited' }}
          />
        </div>
      </>,
    )
    expect(await screen.findByText('90')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(mockFetchCalls).toEqual([`/api/ai/usage?orgId=org-1&month=${MONTH}&hostId=host-1`])
  })
})
