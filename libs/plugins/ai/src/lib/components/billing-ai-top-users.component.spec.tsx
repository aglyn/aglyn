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
 * Who is generating what, on Billing → Usage (AGL-2928), drawn as a record
 * list (AGL-3045).
 *
 * One row per member for a month: a list of people, paged and sorted, so it
 * is the shared grid — which scrolls its own columns inside the card rather
 * than cutting them off at the card's edge — and the row opens the member.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OrgAiUsageRowWire } from '../usage/ai-usage-wire'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  aiAddonName: () => 'Acme AI',
  countCsvDataRows: () => 0,
}))

jest.mock('@aglyn/aglyn/app-utils/docs-help', () => ({
  __esModule: true,
  pluginDocsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: { header?: ReactNode; children?: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'manager-1' } }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: jest.fn(),
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/acme/billing/usage',
}))

let mockRows: OrgAiUsageRowWire[] = []
/** Held, so the hook hands back the same maps on every render. */
const mockCredits = new Map()
jest.mock('./use-org-ai-usage', () => ({
  __esModule: true,
  // The month the picker asked for, or the current one: the card reads
  // whichever month its picker names.
  useOrgAiUsage: (_orgId: string, options: { month?: string }) => {
    const month = options?.month ?? '2026-09'
    return {
      status: 'ready',
      data: { month, months: ['2026-09', '2026-08'], orgCredits: 3_000, rows: mockRows },
      month,
      months: ['2026-09', '2026-08'],
      creditsByUid: mockCredits,
      hostCreditsByUid: mockCredits,
      reload: () => undefined,
    }
  },
}))

import { BillingAiTopUsersComponent } from './billing-ai-top-users.component'

const member = (patch: Partial<OrgAiUsageRowWire>): OrgAiUsageRowWire => ({
  uid: 'u-ada',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'admin',
  credits: 1_800,
  share: 0.6,
  requests: 30,
  refusals: 2,
  byKind: { page: 1_000, assist: 800 },
  byHost: {},
  ...patch,
})

beforeEach(() => {
  mockPush.mockClear()
  mockRows = [
    member({}),
    member({
      uid: 'u-grace',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      credits: 1_200,
      share: 0.4,
      requests: 12,
      refusals: 0,
      byKind: { theme: 1_200 },
    }),
  ]
})

describe('BillingAiTopUsersComponent (AGL-3045)', () => {
  it('lists each member’s month in the shared grid, not a bare table', () => {
    const { container } = render(<BillingAiTopUsersComponent orgId="org-1" orgSlug="acme" />)
    const grid = screen.getByRole('grid')
    // No bare table is left for the card to cut off.
    expect(container.querySelectorAll('table')).toHaveLength(0)
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    expect(headers).toEqual(
      expect.arrayContaining(['Member', 'Credits', 'Share', 'Requests', 'Refusals', 'Mostly']),
    )
    const ada = within(grid).getByText('Ada Lovelace').closest('[role="row"]') as HTMLElement
    expect(within(ada).getByText('ada@example.com')).toBeTruthy()
    expect(within(ada).getByText('1,800')).toBeTruthy()
    expect(within(ada).getByText('page, assist')).toBeTruthy()
    const grace = within(grid).getByText('Grace Hopper').closest('[role="row"]') as HTMLElement
    expect(within(grace).getByText('theme')).toBeTruthy()
  })

  it('opens the member from the row', () => {
    render(<BillingAiTopUsersComponent orgId="org-1" orgSlug="acme" />)
    fireEvent.click(screen.getByRole('gridcell', { name: '1,200' }))
    expect(mockPush).toHaveBeenCalledWith('/acme/team/u-grace')
  })

  it('opens another month on its first page', () => {
    mockRows = Array.from({ length: 12 }, (_, index) =>
      member({ uid: `u-${index + 1}`, name: `Member ${index + 1}`, email: null, credits: 1_200 - index }),
    )
    render(<BillingAiTopUsersComponent orgId="org-1" orgSlug="acme" />)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(screen.getByText('Member 11')).toBeTruthy()
    expect(screen.queryByText('Member 1')).toBeNull()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Month' }))
    fireEvent.click(screen.getByRole('option', { name: /August/ }))
    expect(screen.getByText('Member 1')).toBeTruthy()
    expect(screen.queryByText('Member 11')).toBeNull()
  })

  it('says nobody is attributed rather than drawing an empty grid', () => {
    mockRows = []
    render(<BillingAiTopUsersComponent orgId="org-1" orgSlug="acme" />)
    expect(screen.getByText(/No Acme AI usage attributed to a member/)).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeNull()
  })
})
