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
 * `/crm/settings` (AGL-2613): one switch, written to the org document by the
 * dotted path the capture door reads, and movable only by the roles the org
 * document's client rule admits. And the assignment cards (AGL-2618): a
 * site's default owner by field-path segments, the rules as one array by
 * its dotted path — added through a drawer, reordered, deleted — and the
 * pool as one array, with the server's pointer read back as "next up".
 */

import type { OrgCrmAssignmentRule } from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { CrmSettingsSection } from './settings-section'

/** The caller's org role, as their own membership document answers. */
let memberRole: string | null = 'owner'

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: jest.fn(async () => undefined),
  deleteField: () => ({ __delete: true }),
  FieldPath: class {
    segments: string[]
    constructor(...segments: string[]) {
      this.segments = segments
    }
  },
}))
jest.mock('../hooks/use-org-member-directory', () => ({
  useOrgMemberDirectory: () => ({
    members: [
      { uid: 'uid-kim', label: 'Kim', email: 'kim@example.com', role: 'editor' },
      { uid: 'uid-sam', label: 'Sam', email: 'sam@example.com', role: 'admin' },
    ],
    loading: false,
    error: null,
    nameOf: (uid: string) => ({ 'uid-kim': 'Kim', 'uid-sam': 'Sam' })[uid] ?? uid,
  }),
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

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreDoc: () => ({
    data: memberRole ? { role: memberRole } : undefined,
    status: 'success',
    fromCache: false,
  }),
}))

const enqueueSnackbar = jest.fn()
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
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

const LABEL = 'Create companies from work email domains'

beforeEach(() => {
  jest.clearAllMocks()
  memberRole = 'owner'
})

describe('the auto-create switch', () => {
  it('reflects the org document, off when it says nothing', () => {
    const { rerender } = render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).checked).toBe(false)
    rerender(
      <CrmSettingsSection hostId="host-1" org={{ crm: { autoCreateCompanies: true } }} />,
    )
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).checked).toBe(true)
  })

  it('writes the switch by dotted path onto the org document, and nothing else', async () => {
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByLabelText(LABEL))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'orgs/org-1' },
      { 'crm.autoCreateCompanies': true },
    )
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      expect.stringMatching(/will be created/),
      expect.anything(),
    )
  })

  it('is disabled, with the reason, for a member who is not an owner or admin', () => {
    memberRole = 'editor'
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText('Only a workspace owner or admin can change this.').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText(LABEL))
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('admits an admin as it admits an owner', () => {
    memberRole = 'admin'
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(false)
    expect(screen.queryByText(/Only a workspace owner/)).toBeNull()
  })
})

const ORG_REF = { path: 'orgs/org-1' }
const pick = (name: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option))
}

describe('the default owner (AGL-2618)', () => {
  it('reads the site’s own slot and writes it by field-path segments', async () => {
    render(
      <CrmSettingsSection
        hostId="host-1"
        org={{ crm: { hosts: { 'host-2': { defaultOwnerUid: 'uid-sam' } } } }}
      />,
    )
    expect(
      screen.getByRole('combobox', { name: 'Default owner for this site' }).textContent,
    ).toContain('Nobody')
    pick('Default owner for this site', 'Kim')
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [ref, path, value] = (updateDoc as jest.Mock).mock.calls[0]
    expect(ref).toEqual(ORG_REF)
    expect(path.segments).toEqual(['crm', 'hosts', 'host-1', 'defaultOwnerUid'])
    expect(value).toBe('uid-kim')
  })

  it('deletes the field for nobody, and still names a former member the org set', async () => {
    render(
      <CrmSettingsSection
        hostId="host-1"
        org={{ crm: { hosts: { 'host-1': { defaultOwnerUid: 'uid-gone' } } } }}
      />,
    )
    expect(
      screen.getByRole('combobox', { name: 'Default owner for this site' }).textContent,
    ).toContain('uid-gone (former member)')
    pick('Default owner for this site', 'Nobody — leave unassigned')
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect((updateDoc as jest.Mock).mock.calls[0][2]).toEqual({ __delete: true })
  })
})

describe('the assignment rules (AGL-2618)', () => {
  const rules: OrgCrmAssignmentRule[] = [
    { id: 'r-bookings', when: { source: 'booking' }, assign: { memberUid: 'uid-kim' } },
    { id: 'r-rest', when: {}, assign: { roundRobin: true } },
  ]

  it('lists the rules in order, in words, with the target by name', () => {
    render(<CrmSettingsSection hostId="host-1" org={{ crm: { assignmentRules: rules } }} />)
    const rows = within(screen.getByRole('region', { name: 'Assignment rules' })).getAllByRole('row')
    expect(rows[1].textContent).toContain('1st')
    expect(rows[1].textContent).toContain('source is Booking')
    expect(rows[1].textContent).toContain('Kim')
    expect(rows[2].textContent).toContain('2nd')
    expect(rows[2].textContent).toContain('Every capture')
    expect(rows[2].textContent).toContain('Round robin')
  })

  it('writes the whole list, reordered, by its dotted path', async () => {
    render(<CrmSettingsSection hostId="host-1" org={{ crm: { assignmentRules: rules } }} />)
    expect((screen.getByText('Move rule 1 up').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('Move rule 1 down'))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect(updateDoc).toHaveBeenCalledWith(ORG_REF, {
      'crm.assignmentRules': [rules[1], rules[0]],
    })
  })

  it('deletes a rule from the row menu', async () => {
    render(<CrmSettingsSection hostId="host-1" org={{ crm: { assignmentRules: rules } }} />)
    fireEvent.click(screen.getByText('Rule 1: Delete rule'))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect(updateDoc).toHaveBeenCalledWith(ORG_REF, { 'crm.assignmentRules': [rules[1]] })
  })

  it('adds a rule through the drawer, appended, with a fresh id', async () => {
    render(<CrmSettingsSection hostId="host-1" org={{ crm: { assignmentRules: rules } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(screen.getByText('New assignment rule')).toBeTruthy()
    // Nothing named yet: the drawer's button waits for a member.
    const drawerButton = () => {
      const buttons = screen.getAllByRole('button', { name: 'Add rule' })
      return buttons[buttons.length - 1] as HTMLButtonElement
    }
    expect(drawerButton().disabled).toBe(true)
    pick('Source', 'Form')
    fireEvent.change(screen.getByLabelText('Email domain'), { target: { value: '@Acme.com' } })
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: ' VIP ' } })
    pick('Member', 'Sam')
    fireEvent.click(drawerButton())
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const written = (updateDoc as jest.Mock).mock.calls[0][1]['crm.assignmentRules']
    expect(written).toHaveLength(3)
    expect(written.slice(0, 2)).toEqual(rules)
    expect(written[2]).toEqual({
      id: expect.stringMatching(/^rule-/),
      when: { source: 'form', emailDomain: 'acme.com', tag: 'vip' },
      assign: { memberUid: 'uid-sam' },
    })
    expect(['r-bookings', 'r-rest']).not.toContain(written[2].id)
  })

  it('refuses a domain it cannot read, with the field', () => {
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    fireEvent.change(screen.getByLabelText('Email domain'), { target: { value: 'not a domain' } })
    expect(screen.getByText('That does not look like a domain.')).toBeTruthy()
    pick('Member', 'Sam')
    const buttons = screen.getAllByRole('button', { name: 'Add rule' })
    expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the rotation, and says when the pool is empty', () => {
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    fireEvent.click(screen.getByLabelText('Round robin — the next member of the pool'))
    expect(screen.getByText(/The pool is empty/)).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Add rule' })
    expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the round-robin pool (AGL-2618)', () => {
  it('checks the members in the pool and reads back who is next', () => {
    render(
      <CrmSettingsSection
        hostId="host-1"
        org={{ crm: { roundRobin: { memberUids: ['uid-sam', 'uid-kim'], lastAssignedUid: 'uid-sam' } } }}
      />,
    )
    const pool = screen.getByRole('region', { name: 'Round robin' })
    expect((within(pool).getByLabelText('Sam') as HTMLInputElement).checked).toBe(true)
    expect((within(pool).getByLabelText('Kim') as HTMLInputElement).checked).toBe(true)
    expect(pool.textContent).toContain('Rotation: Sam → Kim. Next up: Kim.')
  })

  it('appends a checked member to the end of the rotation and drops an unchecked one', async () => {
    render(
      <CrmSettingsSection hostId="host-1" org={{ crm: { roundRobin: { memberUids: ['uid-sam'] } } }} />,
    )
    const pool = screen.getByRole('region', { name: 'Round robin' })
    fireEvent.click(within(pool).getByLabelText('Kim'))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect(updateDoc).toHaveBeenCalledWith(ORG_REF, {
      'crm.roundRobin.memberUids': ['uid-sam', 'uid-kim'],
    })
    fireEvent.click(within(pool).getByLabelText('Sam'))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(2))
    expect(updateDoc).toHaveBeenLastCalledWith(ORG_REF, { 'crm.roundRobin.memberUids': [] })
  })

  it('is read-only, with the reason, for a member who is not an owner or admin', () => {
    memberRole = 'editor'
    render(<CrmSettingsSection hostId="host-1" org={{ crm: { assignmentRules: [{ id: 'r', when: {}, assign: { roundRobin: true } }] } }} />)
    const pool = screen.getByRole('region', { name: 'Round robin' })
    expect((within(pool).getByLabelText('Kim') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add rule' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Move rule 1 down').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('Only a workspace owner or admin can change this.').length).toBeGreaterThanOrEqual(3)
  })
})
