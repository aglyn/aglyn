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
 * THE IMPORT & EXPORT HUB ROWS FOR WHAT IS ONLY EXPORTED (AGL-3528, AGL-3548).
 *
 * A records resource its plugin only exports — a log of work done, a setup
 * edited on its own page, the record of a sale — offers Export and no Import
 * on the hub, because the upload route refuses it and a button that can
 * only fail is worse than none. An importable one offers both, each through
 * the shell's launcher with the resource's key, scope and site. The CRM's
 * own rows on each plan are `org-data-transfer-card-plan.spec.tsx`'s; here
 * a site's orders and products stand for every other plugin.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockOpenImport = jest.fn()
const mockOpenExport = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('@aglyn/aglyn/app-utils/transfer-launcher-context', () => ({
  useTransferLauncher: () => ({ openImport: mockOpenImport, openExport: mockOpenExport, can: () => true }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'owner-1' } }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'starter', enabledPlugins: ['commerce'] }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [{ $id: 'host-1', name: 'Shop', subdomain: 'shop' }] }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-console-plugins', () => ({ useConsoleSlotPlugins: () => true }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))
/** The site runs the store: one resource it imports, one it only exports. */
jest.mock('@aglyn/aglyn/plugin-manager/plugin-transfer-resources', () => {
  const actual = jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-transfer-resources')
  return {
    ...actual,
    listTransferResourcesFor: (subject: { scope: string }) =>
      actual
        .listDeclaredTransferResources()
        .filter(
          (resource: { key: string; scope: string }) =>
            resource.scope === subject.scope && ['commerce.products', 'commerce.orders'].includes(resource.key),
        ),
  }
})

import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import OrgDataTransferCard from '../components/settings/org-data-transfer-card.component'

/** A resource's row on the hub: the stack holding its name and its buttons. */
function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: 'p, span' }).closest('.MuiStack-root')?.parentElement?.closest('.MuiStack-root')
  if (!row) throw new Error(`No row for ${label}`)
  return row as HTMLElement
}

beforeEach(() => {
  mockOpenImport.mockReset()
  mockOpenExport.mockReset()
})

describe('the hub’s records rows', () => {
  const label = (key: string) => PLUGIN_TRANSFER_RESOURCES_DECLARED.find((resource) => resource.key === key)?.label as string

  it('declares the records only ever exported export-only', () => {
    const declared = (key: string) => PLUGIN_TRANSFER_RESOURCES_DECLARED.find((resource) => resource.key === key)
    for (const key of ['crm.activities', 'crm.pipelines', 'crm.fields', 'forms.submissions', 'bookings', 'commerce.orders']) {
      expect([key, declared(key)?.exportOnly]).toEqual([key, true])
    }
    expect(declared('commerce.products')?.exportOnly).not.toBe(true)
  })

  it('offers Export and no Import on a resource that is only exported', () => {
    render(<OrgDataTransferCard />)
    const orders = rowOf(label('commerce.orders'))
    expect(within(orders).getAllByRole('button').map((button) => button.textContent)).toEqual(['Export'])
    fireEvent.click(within(orders).getByRole('button', { name: 'Export' }))
    expect(mockOpenExport).toHaveBeenLastCalledWith({ resource: 'commerce.orders', scope: 'host', hostId: 'host-1' })
    expect(mockOpenImport).not.toHaveBeenCalled()
  })

  it('offers Import and Export on an importable resource', () => {
    render(<OrgDataTransferCard />)
    const products = rowOf(label('commerce.products'))
    expect(within(products).getAllByRole('button').map((button) => button.textContent)).toEqual(['Import', 'Export'])
    fireEvent.click(within(products).getByRole('button', { name: 'Import' }))
    expect(mockOpenImport).toHaveBeenLastCalledWith({ resource: 'commerce.products', scope: 'host', hostId: 'host-1' })
  })
})
