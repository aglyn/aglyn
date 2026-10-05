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
 * THE IMPORT & EXPORT HUB ON A PLAN WITHOUT THE CRM (AGL-3555).
 *
 * Free reaches no part of the CRM, so the hub offers none of its buttons —
 * no Import or Export on companies, deals, tasks, activities, pipelines,
 * fields or email templates, no Import on contacts or leads — but the
 * contacts and leads exports, Settings → Privacy's people files, stay. Each
 * row the plan refuses whole says which plan includes it. On Starter every
 * button is back. The launcher's `can` here is the shell's own verdict
 * (`transferAccessVerdict`) for a member holding "Manage data".
 */

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockOrg: Record<string, unknown> = { plan: 'free', enabledPlugins: ['crm'] }

jest.mock('@aglyn/aglyn/app-utils/transfer-launcher-context', () => {
  const { transferAccessVerdict } = jest.requireActual('../components/transfer-launcher-provider.component')
  const plans = jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
  return {
    useTransferLauncher: () => ({
      openImport: jest.fn(),
      openExport: jest.fn(),
      close: jest.fn(),
      can: (action: string, target: unknown) =>
        transferAccessVerdict(
          {
            permissionsLoaded: true,
            can: () => true,
            orgWide: true,
            member: null,
            entitled: (feature: string) => plans.checkEntitlement(mockOrg, feature),
          },
          action,
          target,
        ),
    }),
  }
})
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'owner-1' } }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: true, entitlementsFromCache: false }),
}))
jest.mock('../hooks/use-org-hosts', () => ({ useOrgHosts: () => ({ hosts: [] }) }))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-console-plugins', () => ({ useConsoleSlotPlugins: () => true }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  CardDisplay: ({ header, children, HeaderProps }: { header: ReactNode; children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <section>
      <h2>{header}</h2>
      {HeaderProps?.action}
      {children}
    </section>
  ),
}))

import OrgDataTransferCard from '../components/settings/org-data-transfer-card.component'

/** The buttons on one resource's row, by the row's label. */
function buttonsOf(label: string): string[] {
  const row = screen.getByText(label, { selector: 'p, span' }).closest('.MuiStack-root')?.parentElement?.closest('.MuiStack-root')
  if (!row) throw new Error(`no row for ${label}`)
  return within(row as HTMLElement)
    .queryAllByRole('button')
    .map((button) => button.textContent ?? '')
}

beforeEach(() => {
  mockOrg = { plan: 'free', enabledPlugins: ['crm'] }
})

describe('the hub on Free', () => {
  it('offers only the people files’ exports of the CRM', () => {
    expect(checkEntitlement(mockOrg as never, 'crm')).toBe(false)
    render(<OrgDataTransferCard />)
    expect(buttonsOf('Contacts')).toEqual(['Export'])
    expect(buttonsOf('Leads')).toEqual(['Export'])
    for (const label of ['Companies', 'Deals', 'Tasks', 'Activities', 'Pipelines and stages', 'Custom fields', 'Email templates']) {
      expect([label, buttonsOf(label)]).toEqual([label, []])
    }
    expect(screen.getAllByText('Not included in your current plan. Included from Starter.')).toHaveLength(7)
  })
})

describe('the hub on Starter', () => {
  it('offers every CRM button', () => {
    mockOrg = { plan: 'starter', enabledPlugins: ['crm'] }
    render(<OrgDataTransferCard />)
    for (const label of ['Contacts', 'Leads', 'Companies', 'Deals', 'Tasks', 'Email templates']) {
      expect([label, buttonsOf(label)]).toEqual([label, ['Import', 'Export']])
    }
    for (const label of ['Activities', 'Pipelines and stages', 'Custom fields']) {
      expect([label, buttonsOf(label)]).toEqual([label, ['Export']])
    }
    expect(screen.queryByText(/Not included in your current plan/)).toBeNull()
  })
})
