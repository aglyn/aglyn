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
 * A deal's catalog door without a plan that has the store (AGL-3982): the
 * Add line dialog says why the catalog is not offered and links to Billing,
 * rather than leaving "By hand" as the only door with no word on the other.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DealProductsCard } from './deal-products-card'

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDocs: async () => ({ docs: [] }),
  updateDoc: async () => undefined,
}))
/** ONE store object: the catalog search keys its effect on it, and a fresh one per render loops. */
const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  writeGuardedBySeed: async (_guard: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: { children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  MdiIcon: () => null,
}))
// No plugin keeps products in this spec, so the catalog search matches nothing.
jest.mock('@aglyn/aglyn/plugin-manager/plugin-record-lists', () => ({ pluginRecordListSource: () => null }))

const DEAL = { $id: 'deal-1', name: 'Fit-out', currency: 'usd', lineItems: [], hostId: 'host-1' } as never

function openAddLine(org: Record<string, unknown>, hostId: string | null = 'host-1', deal = DEAL) {
  render(
    <DealProductsCard deal={deal} orgId="org-1" hostId={hostId} org={org} fromCache={false} unreadable={false} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
  return screen.getByRole('dialog')
}

describe('the catalog door and the plan (AGL-3982)', () => {
  it('says the catalog needs a plan with the store, and links to Billing', () => {
    const dialog = openAddLine({ plan: 'free', slug: 'acme' })
    expect(dialog.textContent).toContain('Adding lines from your product catalog needs a plan with the store.')
    expect(screen.getByText('See plans').closest('a')?.getAttribute('href')).toBe('/acme/billing#plans')
    // The by-hand door still works: the name field is there, and no catalog toggle.
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'From the catalog' })).toBeNull()
  })

  it('names the step without a link where the org doc carries no slug', () => {
    openAddLine({ plan: 'free' })
    expect(screen.getByText(/needs a plan with the store/)).toBeTruthy()
    expect(screen.queryByText('See plans')).toBeNull()
  })

  it('offers the catalog, and no notice, on a plan with the store', () => {
    openAddLine({ plan: 'business', slug: 'acme' })
    expect(screen.getByRole('button', { name: 'From the catalog' })).toBeTruthy()
    expect(screen.queryByText(/needs a plan with the store/)).toBeNull()
  })

  it('says nothing about the catalog for a deal with no site to search', () => {
    openAddLine({ plan: 'free', slug: 'acme' }, null, { ...(DEAL as object), hostId: undefined } as never)
    expect(screen.queryByText(/needs a plan with the store/)).toBeNull()
  })
})
