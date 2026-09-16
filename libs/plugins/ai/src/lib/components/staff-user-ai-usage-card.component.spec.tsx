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
 * One account's AI usage across workspaces, on the staff user page, as a
 * record list (AGL-3045).
 *
 * One row per workspace per month kept — a list of records, so the shared
 * grid, which scrolls its own columns inside the card, and whose row opens
 * the workspace.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
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

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/admin/users/u-ada',
}))

import StaffUserAiUsageCard from './staff-user-ai-usage-card.component'

describe('StaffUserAiUsageCard (AGL-3045)', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockPayload = {
      rows: [
        { orgId: 'org-1', orgName: 'Northwind', slug: 'northwind', month: '2026-09', credits: 900, requests: 12, refusals: 1 },
        { orgId: 'org-2', orgName: null, slug: null, month: '2026-08', credits: 40, requests: 2, refusals: 0 },
      ],
    }
  })

  it('lists the workspace months in the shared grid, not a bare table', async () => {
    const { container } = render(<StaffUserAiUsageCard uid="u-ada" />)
    const grid = await screen.findByRole('grid')
    expect(container.querySelectorAll('table')).toHaveLength(0)
    const northwind = within(grid).getByText('Northwind').closest('[role="row"]') as HTMLElement
    expect(within(northwind).getByText('900')).toBeTruthy()
    // A workspace the route could not name keeps its id.
    expect(within(grid).getByText('org-2')).toBeTruthy()
  })

  it('opens the workspace from its row', async () => {
    render(<StaffUserAiUsageCard uid="u-ada" />)
    const grid = await screen.findByRole('grid')
    fireEvent.click(within(grid).getByText('Northwind'))
    expect(mockPush).toHaveBeenCalledWith('/admin/orgs/org-1')
  })
})
