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
 * The Email templates card (AGL-2658): what it lists, what a create through
 * the drawer writes and where it lands at each level, what an edit changes
 * about ownership, and that a delete asks first.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { deleteDoc, setDoc, updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { EmailTemplatesCard } from './email-templates-card'

/** What the listener answers — the rows as stored, with ids. */
let rows: Array<Record<string, unknown>> = []
const confirm = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('firebase/firestore', () => ({
  doc: (base: unknown, ...segments: string[]) => ({
    path: (typeof base === 'string' ? [base, ...segments] : segments).join('/'),
  }),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => ({ path }),
  where: () => null,
  orderBy: () => null,
  limit: () => null,
  setDoc: jest.fn(async () => undefined),
  updateDoc: jest.fn(async () => undefined),
  deleteDoc: jest.fn(async () => undefined),
  deleteField: () => ({ __delete: true }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useUser: () => ({ data: { uid: 'u-1' } }),
  useFirestoreCollection: () => ({ data: rows, status: 'success', fromCache: false }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
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
  useConfirmationContext: () => ({ confirm: (...args: unknown[]) => confirm(...args) }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: ({ items, label }: { label: string; items: Array<{ key: string; label: string; onClick?: () => void; disabled?: boolean }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.key} disabled={item.disabled} onClick={item.onClick}>
          {`${label}: ${item.label}`}
        </button>
      ))}
    </div>
  ),
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

const stamp = { createdByUid: 'u-2', createdAtMs: 1, updatedAtMs: 1, hostId: 'host-1', visibleTo: ['host:host-1'] }
const ROWS = [
  { $id: 't-shared', name: 'Follow-up', subject: 'Following up', body: 'Still keen?', kind: 'template', visibility: 'shared', ...stamp },
  { $id: 's-mine', name: 'Signature', subject: '', body: '-- Me', kind: 'snippet', visibility: 'personal', ownerUid: 'u-1', ...stamp },
  { $id: 't-theirs', name: 'Secret', subject: 'S', body: 'B', kind: 'template', visibility: 'personal', ownerUid: 'u-9', ...stamp },
]

const card = () => screen.getByRole('region', { name: 'Email templates' })
const pick = (name: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option))
}
const writeDraft = (values: { name: string; subject?: string; body: string }) => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: values.name } })
  if (values.subject !== undefined) {
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: values.subject } })
  }
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: values.body } })
}

beforeEach(() => {
  jest.clearAllMocks()
  rows = ROWS
  confirm.mockResolvedValue(undefined)
})

describe('EmailTemplatesCard', () => {
  it('lists the shared rows and my own with their kind and audience, never a colleague\'s personal one', () => {
    render(<EmailTemplatesCard hostId="host-1" org={{}} />)
    const table = within(card()).getAllByRole('row')
    expect(table).toHaveLength(3)
    expect(table[1].textContent).toContain('Follow-up')
    expect(table[1].textContent).toContain('Template')
    expect(table[1].textContent).toContain('Shared')
    expect(table[1].textContent).toContain('Following up')
    expect(table[2].textContent).toContain('Signature')
    expect(table[2].textContent).toContain('Snippet')
    expect(table[2].textContent).toContain('Personal')
    expect(screen.queryByText('Secret')).toBeNull()
  })

  it('offers the empty state, and a create from it', () => {
    rows = []
    render(<EmailTemplatesCard hostId="host-1" org={{}} />)
    expect(screen.getByText('No templates yet')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'New template' }).length).toBe(2)
  })

  it('creates a shared template through the drawer, stamped for the site', async () => {
    render(<EmailTemplatesCard hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'New template' }))
    expect(await screen.findByText('New template', { selector: 'h6' })).toBeTruthy()
    const create = () => screen.getByRole('button', { name: 'Create template' }) as HTMLButtonElement
    expect(create().disabled).toBe(true)
    writeDraft({ name: ' Proposal ', subject: 'Your proposal, {{contact.firstName}}', body: 'Attached.' })
    expect(create().disabled).toBe(false)
    fireEvent.click(create())
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, data] = (setDoc as jest.Mock).mock.calls[0]
    expect(ref.path).toMatch(/^orgs\/org-1\/crmEmailTemplates\/[^/]+$/)
    expect(data).toMatchObject({
      name: 'Proposal',
      kind: 'template',
      visibility: 'shared',
      subject: 'Your proposal, {{contact.firstName}}',
      body: 'Attached.',
      createdByUid: 'u-1',
      hostId: 'host-1',
      visibleTo: ['host:host-1'],
    })
    expect('ownerUid' in data).toBe(false)
    expect(enqueueSnackbar).toHaveBeenCalledWith('Template "Proposal" added', expect.anything())
  })

  it('creates a personal snippet with no subject, owned by me', async () => {
    render(<EmailTemplatesCard hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'New template' }))
    await screen.findByText('New template', { selector: 'h6' })
    pick('Kind', 'Snippet')
    expect(screen.queryByLabelText('Subject')).toBeNull()
    pick('Who it is for', 'Personal')
    writeDraft({ name: 'Sign-off', body: 'Best,\nMe' })
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect((setDoc as jest.Mock).mock.calls[0][1]).toMatchObject({
      name: 'Sign-off',
      kind: 'snippet',
      visibility: 'personal',
      subject: '',
      body: 'Best,\nMe',
      ownerUid: 'u-1',
    })
  })

  it('files a template written from the organization\'s hub as the workspace\'s own', async () => {
    render(
      <CrmOrgMountProvider
        mount={{
          orgId: 'org-1',
          hosts: [
            { id: 'host-1', name: 'One', subdomain: 'one' },
            { id: 'host-2', name: 'Two', subdomain: 'two' },
          ],
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
      >
        <EmailTemplatesCard hostId={null} org={{}} />
      </CrmOrgMountProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'New template' }))
    await screen.findByText('New template', { selector: 'h6' })
    writeDraft({ name: 'Welcome', body: 'Hello {{contact.firstName}}' })
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect((setDoc as jest.Mock).mock.calls[0][1]).toMatchObject({ hostId: null, visibleTo: ['org'] })
  })

  it('edits a row in place — personal makes me the owner, shared drops the owner', async () => {
    render(<EmailTemplatesCard hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByText('Follow-up: Edit'))
    expect(await screen.findByText('Edit template')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Follow-up')
    expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Following up')
    pick('Who it is for', 'Personal')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Still interested?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [ref, data] = (updateDoc as jest.Mock).mock.calls[0]
    expect(ref).toEqual({ path: 'orgs/org-1/crmEmailTemplates/t-shared' })
    expect(data).toMatchObject({
      name: 'Follow-up',
      kind: 'template',
      visibility: 'personal',
      subject: 'Following up',
      body: 'Still interested?',
      ownerUid: 'u-1',
    })
    expect(setDoc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Signature: Edit'))
    await screen.findByText('Edit template')
    pick('Who it is for', 'Shared')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(2))
    expect((updateDoc as jest.Mock).mock.calls[1][1]).toMatchObject({
      visibility: 'shared',
      ownerUid: { __delete: true },
    })
  })

  it('deletes after the rep confirms, and not when they decline', async () => {
    render(<EmailTemplatesCard hostId="host-1" org={{}} />)
    confirm.mockRejectedValueOnce(new Error('cancelled'))
    fireEvent.click(screen.getByText('Follow-up: Delete'))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete "Follow-up"?' })))
    expect(deleteDoc).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Follow-up: Delete'))
    await waitFor(() => expect(deleteDoc).toHaveBeenCalledWith({ path: 'orgs/org-1/crmEmailTemplates/t-shared' }))
    expect(enqueueSnackbar).toHaveBeenCalledWith('Template deleted', expect.anything())
  })
})
