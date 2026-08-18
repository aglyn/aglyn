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

import { fireEvent, render, screen } from '@testing-library/react'
import StaffOrgSummaryCard, {
  staffPersonLabel,
} from '../components/staff-org-summary-card.component'

jest.mock('next/navigation', () => ({ usePathname: () => '/' }))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

/**
 * AGL-938. What the old card got wrong, pinned: values rendered with no
 * field labels (`hz_KgetqSq · no slug` read as noise), the owner rendered as
 * a bare uid, and the org id — which staff paste into scripts constantly —
 * had no copy affordance. Each case asserts one of those stays fixed, plus
 * the degraded shapes: an unresolvable owner falls back to a visible uid
 * (never a blank), and a failed org read renders labelled em-dashes rather
 * than crashing.
 */

const org = {
  name: 'Northwind',
  slug: 'northwind',
  plan: 'agency',
  ownerUid: 'QQ7fixtureUid0000000000000002',
  stripeCustomerId: 'cus_123',
  subscription: { status: 'active' },
  createdAt: { seconds: 1_700_000_000 },
}

describe('StaffOrgSummaryCard (AGL-938)', () => {
  beforeEach(() => mockEnqueueSnackbar.mockClear())

  it('labels every value, grouped as Identity and Billing', () => {
    render(
      <StaffOrgSummaryCard
        orgId="hz_KgetqSq"
        org={org}
        owner={null}
        onImpersonateOwner={jest.fn()}
      />,
    )
    for (const label of [
      'Identity',
      'Name',
      'Org ID',
      'Slug',
      'Owner',
      'Created',
      'Billing',
      'Plan',
      'Subscription',
      'Stripe customer',
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('Northwind')).toBeTruthy()
    expect(screen.getByText('hz_KgetqSq')).toBeTruthy()
    expect(screen.getByText('northwind')).toBeTruthy()
    expect(screen.getByText('cus_123')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
  })

  it('renders a resolved owner as a person, uid demoted off the surface', () => {
    render(
      <StaffOrgSummaryCard
        orgId="hz_KgetqSq"
        org={org}
        owner={{
          uid: org.ownerUid,
          email: 'zach@aglyn.com',
          displayName: 'Zach Gover',
          source: 'auth',
        }}
        onImpersonateOwner={jest.fn()}
      />,
    )
    const link = screen.getByText('Zach Gover')
    expect(link.closest('a')?.getAttribute('href')).toContain(org.ownerUid)
    // The raw uid is not card text any more — it lives in the tooltip.
    expect(screen.queryByText(org.ownerUid)).toBeNull()
  })

  it('falls back to the visible uid when no store resolved the owner', () => {
    // The SSO-roster-gap / erased-account shape: unresolved must degrade to
    // the uid, still linked to the user page — never a blank or a crash.
    render(
      <StaffOrgSummaryCard
        orgId="hz_KgetqSq"
        org={org}
        owner={{
          uid: org.ownerUid,
          email: null,
          displayName: null,
          source: null,
        }}
        onImpersonateOwner={jest.fn()}
      />,
    )
    const uid = screen.getByText(org.ownerUid)
    expect(uid.closest('a')?.getAttribute('href')).toContain(org.ownerUid)
  })

  it('copies the org id from its copy affordance', () => {
    const writeText = jest.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <StaffOrgSummaryCard
        orgId="hz_KgetqSq"
        org={org}
        owner={null}
        onImpersonateOwner={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('Copy org id'))
    expect(writeText).toHaveBeenCalledWith('hz_KgetqSq')
    expect(mockEnqueueSnackbar).toHaveBeenCalled()
  })

  it('renders labelled em-dashes for a null org instead of crashing', () => {
    render(
      <StaffOrgSummaryCard
        orgId="hz_KgetqSq"
        org={null}
        owner={null}
        onImpersonateOwner={jest.fn()}
      />,
    )
    expect(screen.getByText('Owner')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    // No owner means no impersonation affordance.
    expect(screen.queryByText(/Impersonate owner/)).toBeNull()
  })
})

describe('staffPersonLabel', () => {
  it('prefers the display name, then the email, then null', () => {
    expect(
      staffPersonLabel({
        uid: 'u',
        displayName: 'A',
        email: 'a@b.c',
        source: 'auth',
      }),
    ).toBe('A')
    expect(
      staffPersonLabel({ uid: 'u', displayName: null, email: 'a@b.c', source: 'roster' }),
    ).toBe('a@b.c')
    expect(
      staffPersonLabel({ uid: 'u', displayName: null, email: null, source: null }),
    ).toBeNull()
    expect(staffPersonLabel(null)).toBeNull()
  })
})
