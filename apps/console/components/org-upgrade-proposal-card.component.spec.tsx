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
 * AGL-3466 — the proposal card is shown to the people who can buy the plan,
 * while it stands, and to nobody else.
 */

import { render, screen } from '@testing-library/react'

let mockOrg: Record<string, unknown> | undefined
let mockCanManageBilling = true
let mockPermissionsLoaded = true

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    loaded: mockPermissionsLoaded,
    can: (permission: string) => permission === 'billing.manage' && mockCanManageBilling,
  }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', orgName: 'Acme' } }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  default: () => ({ branding: { productName: 'Aglyn' } }),
}))

import OrgUpgradeProposalCard from './org-upgrade-proposal-card.component'

const proposal = { plan: 'starter', proposedBy: 'staff', proposedAt: 1, note: 'As agreed.' }

beforeEach(() => {
  mockOrg = { name: 'Acme', upgradeProposal: proposal }
  mockCanManageBilling = true
  mockPermissionsLoaded = true
})

describe('OrgUpgradeProposalCard (AGL-3466)', () => {
  it('names the workspace and plan, and links to Billing with it preselected', () => {
    render(<OrgUpgradeProposalCard />)
    expect(screen.getByText("Acme's Aglyn team proposed the Starter plan")).toBeTruthy()
    expect(screen.getByText('As agreed.')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Review the plan' }).getAttribute('href'),
    ).toBe('/acme/billing?plan=starter')
  })

  it('shows nothing to a member who cannot manage billing', () => {
    mockCanManageBilling = false
    const { container } = render(<OrgUpgradeProposalCard />)
    expect(container.textContent).toBe('')
  })

  it('shows nothing while permissions are loading', () => {
    mockPermissionsLoaded = false
    const { container } = render(<OrgUpgradeProposalCard />)
    expect(container.textContent).toBe('')
  })

  it('shows nothing once a subscription is live', () => {
    mockOrg = { ...mockOrg, billingStatus: 'active' }
    const { container } = render(<OrgUpgradeProposalCard />)
    expect(container.textContent).toBe('')
  })

  it('shows nothing when there is no proposal', () => {
    mockOrg = { name: 'Acme' }
    const { container } = render(<OrgUpgradeProposalCard />)
    expect(container.textContent).toBe('')
  })
})
