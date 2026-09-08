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
 * THE FIELDS SECTION'S TABS (AGL-2661).
 *
 * What the tabs have to hold: the list asks the definitions hook for the
 * tab's object and nothing else, a field created on a tab is STAMPED with
 * that object, and the drawer's copy names it — so a company field can
 * never be filed as a contact field by a tab that forgot to say which.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { ContactsFieldsSection } from './fields-section'

const definitionsFor = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  // `doc(db, ...segments)` and `doc(collectionRef, id)` both land here; the
  // db handle is `{}` and contributes nothing, a ref contributes its path.
  doc: (...segments: unknown[]) => ({
    path: segments
      .map((segment) =>
        typeof segment === 'string' ? segment : String((segment as { path?: string }).path ?? ''),
      )
      .filter(Boolean)
      .join('/'),
  }),
  setDoc: jest.fn(async () => undefined),
  updateDoc: jest.fn(async () => undefined),
  deleteDoc: jest.fn(async () => undefined),
  writeBatch: () => ({ update: jest.fn(), commit: jest.fn(async () => undefined) }),
}))
jest.mock('../hooks/use-crm-scope', () => ({
  useCrmScope: () => ({
    scope: ['orgs', 'org-1'],
    orgId: 'org-1',
    ready: true,
    createHostId: 'host-1',
  }),
}))
jest.mock('../hooks/use-contact-field-definitions', () => ({
  useContactFieldDefinitions: (orgId: string, object: string) => definitionsFor(orgId, object),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  writeGuardedBySeed: async (_seed: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: ({ label, action }: { label: string; action?: ReactNode }) => (
    <div>
      <p>{label}</p>
      {action}
    </div>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: () => null,
}))

const empty = { definitions: [], active: [], ready: true, fromCache: false }

beforeEach(() => {
  jest.clearAllMocks()
  definitionsFor.mockReturnValue(empty)
})

describe('the Fields section tabs (AGL-2661)', () => {
  it('opens on Contacts and asks the hook for that object alone', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    expect(screen.getByRole('tab', { name: 'Contacts' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Companies' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Deals' })).toBeTruthy()
    expect(definitionsFor).toHaveBeenLastCalledWith('org-1', 'contact')
    expect(screen.getByText('No custom contact fields yet')).toBeTruthy()
  })

  it('switches the list, the copy and the drawer to the picked object', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Companies' }))
    expect(definitionsFor).toHaveBeenLastCalledWith('org-1', 'company')
    expect(screen.getByText('No custom company fields yet')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'New field' })[0])
    expect(screen.getByText('New company field')).toBeTruthy()
    expect(screen.getByText(/saves into contact fields only/)).toBeTruthy()
  })

  it('stamps a field created on the Deals tab with object: deal', async () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'New field' })[0])
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Tier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create field' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, data] = (setDoc as jest.Mock).mock.calls[0]
    expect(ref.path).toMatch(/^orgs\/org-1\/contactFields\//)
    expect(data).toMatchObject({ key: 'tier', label: 'Tier', object: 'deal', hostId: 'host-1' })
  })
})
