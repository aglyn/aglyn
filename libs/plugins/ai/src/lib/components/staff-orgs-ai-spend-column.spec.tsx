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
 * The staff Organizations list's AI spend column (AGL-2984), contributed
 * through the `staffOrgsListColumn` zone. The column is mounted once per ROW
 * and once for its header, so the page's orgs are read ONCE for all of them.
 * A cell reads `$` and four decimals, or a dash for an unmeasured org and
 * for a read that has not answered; the header sorts the page by a
 * comparator it hands the list — dearest first, cheapest first, then the
 * list's own order — with the unmeasured last both ways.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** ONE signed-in staff user, held: a provider hands back the same instance. */
const mockStaffUser = { uid: 'staff-1', getIdToken: async () => 'tok' }
const mockFetchCalls: string[] = []
let mockAnswer: { status: number; body: unknown } = { status: 200, body: null }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockStaffUser }),
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

import {
  StaffOrgsAiSpendCell,
  StaffOrgsAiSpendHeader,
} from './staff-orgs-ai-spend-column.component'
import { resetStaffOrgsAiSpendReadsForTests } from './use-staff-orgs-ai-spend'

const ORG_IDS = ['org-1', 'org-2', 'org-3', 'org-4']

const askedIds = (url: string) =>
  new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('orgIds')

beforeEach(() => {
  resetStaffOrgsAiSpendReadsForTests()
  mockFetchCalls.length = 0
  // org-3 has no month document; org-4 is not in the answer at all.
  mockAnswer = {
    status: 200,
    body: { month: '2026-09', spendUsd: { 'org-1': 9, 'org-2': 10, 'org-3': null } },
  }
})

describe('the AI spend cells', () => {
  it('read the page ONCE for every row, and show each org’s spend', async () => {
    render(
      <>
        {ORG_IDS.map((orgId) => (
          <div key={orgId} data-testid={orgId}>
            <StaffOrgsAiSpendCell orgId={orgId} orgIds={ORG_IDS} />
          </div>
        ))}
      </>,
    )
    expect(await screen.findByText('$10.0000')).toBeTruthy()
    expect(screen.getByTestId('org-1').textContent).toBe('$9.0000')
    // No month document, and absent from the answer: unmeasured, never $0.
    expect(screen.getByTestId('org-3').textContent).toBe('—')
    expect(screen.getByTestId('org-4').textContent).toBe('—')
    expect(mockFetchCalls).toHaveLength(1)
    expect(mockFetchCalls[0].startsWith('/api/ai/admin/orgs-spend?')).toBe(true)
    expect(askedIds(mockFetchCalls[0])).toBe('org-1,org-2,org-3,org-4')
  })

  it('show a dash when the read fails, never a figure', async () => {
    mockAnswer = { status: 500, body: { error: 'AI spend lookup failed' } }
    render(
      <div data-testid="cell">
        <StaffOrgsAiSpendCell orgId="org-2" orgIds={ORG_IDS} />
      </div>,
    )
    await waitFor(() => expect(mockFetchCalls).toHaveLength(1))
    await act(async () => undefined)
    expect(screen.getByTestId('cell').textContent).toBe('—')
  })

  it('ask again for another page of orgs, and not for the same page in another order', async () => {
    const { rerender } = render(
      <StaffOrgsAiSpendCell orgId="org-1" orgIds={ORG_IDS} />,
    )
    await waitFor(() => expect(mockFetchCalls).toHaveLength(1))
    rerender(
      <StaffOrgsAiSpendCell orgId="org-1" orgIds={[...ORG_IDS].reverse()} />,
    )
    await act(async () => undefined)
    expect(mockFetchCalls).toHaveLength(1)
    rerender(<StaffOrgsAiSpendCell orgId="org-1" orgIds={['org-1', 'org-5']} />)
    await waitFor(() => expect(mockFetchCalls).toHaveLength(2))
    expect(askedIds(mockFetchCalls[1])).toBe('org-1,org-5')
  })
})

describe('the AI spend header', () => {
  const order = (compare: unknown) =>
    ORG_IDS.map((orgId) => ({ $id: orgId }))
      .sort(compare as (a: object, b: object) => number)
      .map((row) => row.$id)
  const lastSort = (onSort: jest.Mock) => onSort.mock.calls.at(-1)?.[0]
  const enabled = (label: HTMLElement) =>
    label.closest('[role="button"]')?.getAttribute('aria-disabled') !== 'true'

  it('sorts dearest first, then cheapest first, then hands the order back — the unmeasured last both ways', async () => {
    const onSort = jest.fn()
    render(
      <StaffOrgsAiSpendHeader orgIds={ORG_IDS} onSort={onSort} sorted={false} />,
    )
    const label = screen.getByText('AI spend (month)')
    await waitFor(() => expect(enabled(label)).toBe(true))

    act(() => {
      fireEvent.click(label)
    })
    await waitFor(() => expect(lastSort(onSort)).toEqual(expect.any(Function)))
    expect(order(lastSort(onSort))).toEqual(['org-2', 'org-1', 'org-3', 'org-4'])

    act(() => {
      fireEvent.click(label)
    })
    await waitFor(() =>
      expect(order(lastSort(onSort))).toEqual(['org-1', 'org-2', 'org-3', 'org-4']),
    )

    act(() => {
      fireEvent.click(label)
    })
    await waitFor(() => expect(lastSort(onSort)).toBeNull())
    // Sorting reuses the page the header already read.
    expect(mockFetchCalls).toHaveLength(1)
  })

  it('goes back to unsorted when another column takes the sort', async () => {
    const onSort = jest.fn()
    const { rerender } = render(
      <StaffOrgsAiSpendHeader orgIds={ORG_IDS} onSort={onSort} sorted={false} />,
    )
    const label = screen.getByText('AI spend (month)')
    await waitFor(() => expect(enabled(label)).toBe(true))
    act(() => {
      fireEvent.click(label)
    })
    await waitFor(() => expect(lastSort(onSort)).toEqual(expect.any(Function)))
    rerender(<StaffOrgsAiSpendHeader orgIds={ORG_IDS} onSort={onSort} sorted />)
    rerender(
      <StaffOrgsAiSpendHeader orgIds={ORG_IDS} onSort={onSort} sorted={false} />,
    )
    await waitFor(() => expect(lastSort(onSort)).toBeNull())
  })
})

describe('the column draws the figures its helpers define', () => {
  const read = (path: string) => readFileSync(join(__dirname, path), 'utf8')

  it('formats its cell and sorts its header through the pure helpers', () => {
    const source = read('staff-orgs-ai-spend-column.component.tsx')
    expect(source).toContain('aiSpendCell(spend.spendUsd[orgId])')
    expect(source).toContain('aiSpendRowComparator(spend.spendUsd, direction)')
  })

  it('is served per org by the staff spend route', () => {
    const source = read('../server/ai-admin-orgs-spend.ts')
    expect(source).toContain(".collection('assistUsage').doc(month)")
    expect(source).toContain('spendOf(snapshots?.[index])')
  })
})
