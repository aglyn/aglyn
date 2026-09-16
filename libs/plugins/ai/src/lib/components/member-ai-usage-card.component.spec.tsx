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
 * One member's AI usage keeps its columns inside the card (AGL-3045).
 *
 * Two fixed months — a breakdown, so a table, in a box that scrolls sideways
 * inside the card rather than past its edge.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  aiAddonName: () => 'Acme AI',
}))

jest.mock('@aglyn/aglyn/app-utils/docs-help', () => ({
  __esModule: true,
  pluginDocsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  AppLink: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockUser = { uid: 'reader-1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

let mockPayload: unknown
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: async () => ({ ok: true, status: 200, json: async () => mockPayload }),
}))

import { aiUsageMonthKeys } from '../model/ai-usage-by-user'
import MemberAiUsageCard from './member-ai-usage-card.component'

describe('MemberAiUsageCard (AGL-3045)', () => {
  it('draws the two months in a box that scrolls sideways inside the card', async () => {
    const [thisMonth] = aiUsageMonthKeys(new Date(), 2)
    mockPayload = {
      months: [
        {
          month: thisMonth,
          credits: 1_800,
          share: 0.6,
          requests: 30,
          refusals: 2,
          byKind: { page: 1_000 },
          byHost: {},
        },
      ],
    }
    render(<MemberAiUsageCard orgId="org-1" uid="u-ada" orgSlug="acme" />)
    await waitFor(() => expect(screen.getByText('1,800')).toBeTruthy())
    const table = screen.getByRole('table')
    expect(getComputedStyle(table.parentElement as HTMLElement).overflowX).toBe('auto')
    // Positive control: both months are rows of it, the empty one included.
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })
})
