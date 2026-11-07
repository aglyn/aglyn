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
 * dotted path the capture door reads, and movable only by a member holding
 * "Change CRM settings", the key the org document's client rule asks. And the assignment cards (AGL-2618): a
 * site's default owner by field-path segments, the rules as one array by
 * its dotted path — added through a drawer, reordered, deleted — and the
 * pool as one array, with the server's pointer read back as "next up".
 */

import type { OrgCrmAssignmentRule } from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { CRM_PERMISSIONS } from '../model/crm-permissions'
import { CrmSettingsSection } from './settings-section'

// The CRM's key, as the declarations register it in every process.
registerPluginPermissions(CRM_PERMISSIONS)

const REFUSAL = 'Your role does not include "Change CRM settings" — ask an organization admin'

/** The caller's org role, as their own membership document answers. */
let memberRole: string | null = 'owner'
/** The rest of their membership document: their reach and their own permissions. */
let memberExtra: Record<string, unknown> = {}

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
  // The Email templates card's listener and writers (AGL-2658); the card's
  // own spec exercises them, this one only mounts it.
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => ({ path }),
  where: () => null,
  orderBy: () => null,
  limit: () => null,
  setDoc: jest.fn(async () => undefined),
  deleteDoc: jest.fn(async () => undefined),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}))
// `crm/sharing`, for the default card's sites and its "Apply to existing
// records" run (AGL-4047).
const sharingCalls: Array<{ action: string; body: Record<string, unknown> }> = []
jest.mock('../model/crm-sharing-api', () => ({
  callCrmSharing: async (_user: unknown, _scope: unknown, action: string, body: Record<string, unknown> = {}) => {
    sharingCalls.push({ action, body })
    if (action === 'sites') {
      return {
        ok: true,
        sites: [
          { id: 'host-1', name: 'Site A' },
          { id: 'host-2', name: 'Site B' },
          { id: 'host-3', name: 'Site C' },
        ],
      }
    }
    return {
      ok: true,
      more: false,
      applyRun: { status: 'done', processed: 12, changed: 9, capped: 0, cursor: null, startedAtMs: 1 },
    }
  },
  followUpCrmSharing: async () => undefined,
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: ({ label }: { label: string }) => <p>{label}</p>,
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
  // The Sharing rules card (AGL-3336) offers campaigns as a condition.
  useSiteContainerOptions: () => ({ options: [], truncated: false, ready: true }),
  useOrgContainerOptions: () => ({ options: [], truncated: false, ready: true }),
  // The viewer's reach, which `useCrmScope` reads only for a site in a
  // declared consent group (AGL-3320); an org-wide member here.
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreDoc: () => ({
    data: memberRole ? { role: memberRole, ...memberExtra } : undefined,
    status: 'success',
    fromCache: false,
  }),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  // The email templates card offers Duplicate; nothing here opens it.
  useDuplicateResource: () => ({ request: jest.fn(), dialog: null }),
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
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
// The Email capture card's route (AGL-2657) has a spec of its own; here it
// only has to answer, so the section renders whole. One function for every
// render, as the real hook memoizes: a fresh identity each time would run
// the card's effect forever.
const mockInboundApi = jest.fn(async () => ({
  response: { ok: true },
  payload: { address: 'crm+abcdefghijklmnopqrstuvwxyz012345@in.aglyn.com' },
}))
jest.mock('./use-crm-api', () => ({
  useCrmApi: () => mockInboundApi,
}))
// Your sending addresses (AGL-2975) has a spec of its own, and asks its
// route once the scope resolves; here the section is mounted with its slot
// named, so the mount itself is asserted without a request.
jest.mock('./sending-addresses-card', () => ({
  __esModule: true,
  default: ({ orgId, ready }: { orgId: string | null; ready: boolean }) => (
    <section aria-label="Your sending addresses" data-org={orgId ?? ''} data-ready={String(ready)} />
  ),
}))

const LABEL = 'Create companies from work email domains'

beforeEach(() => {
  jest.clearAllMocks()
  memberRole = 'owner'
  memberExtra = {}
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

  it('is disabled, naming the permission, for a member without "Change CRM settings"', () => {
    memberRole = 'editor'
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText(REFUSAL).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText(LABEL))
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('moves for an org-wide editor whose own permissions grant the key', () => {
    memberRole = 'editor'
    memberExtra = { allHosts: true, permissions: { 'crm.settings': true } }
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(false)
    expect(screen.queryAllByText(REFUSAL)).toEqual([])
  })

  it('is disabled for an admin whose own permissions refuse the key', () => {
    memberRole = 'admin'
    memberExtra = { allHosts: true, permissions: { 'crm.settings': false } }
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText(REFUSAL).length).toBeGreaterThan(0)
  })

  it('is disabled for a site collaborator granted the key: it is the whole workspace’s', () => {
    memberRole = 'editor'
    memberExtra = { allHosts: false, hostAccess: { 'host-1': 'admin' }, permissions: { 'crm.settings': true } }
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(true)
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
    pick('Default owner for this site', 'Kim (kim@example.com)')
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

  /*
   * A site with nobody set still DRAWS a value, because the empty choice is
   * a choice here. The label has to be shrunk to say so: left to decide from
   * the value, it stays in the box and paints itself over "Nobody — leave
   * unassigned", which is what every unassigned site looked like in
   * production until it was fixed.
   */
  it('keeps the label out of the box when nobody is the owner', () => {
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    const combo = screen.getByRole('combobox', { name: 'Default owner for this site' })
    expect(combo.textContent).toContain('Nobody')
    const label = combo
      .closest('.MuiFormControl-root')
      ?.querySelector('.MuiInputLabel-root')
    expect(label).toBeTruthy()
    expect(label?.className).toContain('MuiInputLabel-shrink')
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
    pick('Member', 'Sam (sam@example.com)')
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
    pick('Member', 'Sam (sam@example.com)')
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
    expect((within(pool).getByLabelText('Sam (sam@example.com)') as HTMLInputElement).checked).toBe(true)
    expect((within(pool).getByLabelText('Kim (kim@example.com)') as HTMLInputElement).checked).toBe(true)
    expect(pool.textContent).toContain('Rotation: Sam (sam@example.com) → Kim (kim@example.com). Next up: Kim (kim@example.com).')
  })

  it('appends a checked member to the end of the rotation and drops an unchecked one', async () => {
    render(
      <CrmSettingsSection hostId="host-1" org={{ crm: { roundRobin: { memberUids: ['uid-sam'] } } }} />,
    )
    const pool = screen.getByRole('region', { name: 'Round robin' })
    fireEvent.click(within(pool).getByLabelText('Kim (kim@example.com)'))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect(updateDoc).toHaveBeenCalledWith(ORG_REF, {
      'crm.roundRobin.memberUids': ['uid-sam', 'uid-kim'],
    })
    fireEvent.click(within(pool).getByLabelText('Sam (sam@example.com)'))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(2))
    expect(updateDoc).toHaveBeenLastCalledWith(ORG_REF, { 'crm.roundRobin.memberUids': [] })
  })

  it('is read-only, naming the permission, for a member without "Change CRM settings"', () => {
    memberRole = 'editor'
    render(<CrmSettingsSection hostId="host-1" org={{ crm: { assignmentRules: [{ id: 'r', when: {}, assign: { roundRobin: true } }] } }} />)
    const pool = screen.getByRole('region', { name: 'Round robin' })
    expect((within(pool).getByLabelText('Kim (kim@example.com)') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add rule' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Move rule 1 down').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText(REFUSAL).length).toBeGreaterThanOrEqual(3)
  })
})

describe('the email templates card (AGL-2658)', () => {
  it('mounts under a site, open to every CRM editor, and at the organization level', () => {
    memberRole = 'editor'
    const { rerender } = render(<CrmSettingsSection hostId="host-1" org={{}} />)
    const region = screen.getByRole('region', { name: 'Email templates' })
    expect((within(region).getByRole('button', { name: 'New template' }) as HTMLButtonElement).disabled).toBe(false)
    rerender(
      <CrmOrgMountProvider
        mount={{ orgId: 'org-1', hosts: [], hostsReady: true, orgSlug: 'acme', hostsPath: '/acme/hosts' }}
      >
        <CrmSettingsSection hostId={null} org={{}} />
      </CrmOrgMountProvider>,
    )
    expect(screen.getByRole('region', { name: 'Email templates' })).toBeTruthy()
  })
})

describe('default sharing for new records: all sites except some (AGL-4047)', () => {
  const EXCEPT = /^All sites except/
  // The org document as stored; `defaultRecordExcept` is read off it raw.
  const stored = { crm: { defaultRecordScope: 'host', defaultRecordExcept: ['host-3'] } } as never

  beforeEach(() => {
    sharingCalls.length = 0
  })

  it('offers three choices as radios and a visible list, and saves the sites left out', async () => {
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect(screen.queryByRole('combobox', { name: /are shared with/ })).toBeNull()
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'All sites in the organization' }).checked,
    ).toBe(true)
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('radio', { name: EXCEPT }).disabled).toBe(false),
    )
    fireEvent.click(screen.getByRole('radio', { name: EXCEPT }))
    // Nothing left out yet: refused before any write.
    expect(
      screen.getByText('Choose at least one site to leave out, or share with All sites.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Site C' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith(
        { path: 'orgs/org-1' },
        {
          'crm.defaultRecordScope': 'host',
          'crm.defaultRecordExcept': ['host-3'],
          'crm.defaultRecordExceptAt': { __serverTimestamp: true },
        },
      ),
    )
  })

  it('opens a saved choice on its sites, and moving away deletes the sites left out', async () => {
    render(<CrmSettingsSection hostId="host-1" org={stored} />)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: EXCEPT }).checked).toBe(true)
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Site C' }).checked).toBe(true),
    )
    fireEvent.click(screen.getByRole('radio', { name: 'All sites in the organization' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith(
        { path: 'orgs/org-1' },
        {
          'crm.defaultRecordScope': 'org',
          'crm.defaultRecordExcept': { __delete: true },
          'crm.defaultRecordExceptAt': { __delete: true },
        },
      ),
    )
  })

  it('switches "Apply to existing records" off with the reason until the default leaves sites out', () => {
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Apply to existing records…' }).disabled,
    ).toBe(true)
    expect(screen.getByLabelText('Choose All sites except… and save it first.')).toBeTruthy()
  })

  it('applies to existing records only when asked, and says what it changed', async () => {
    render(<CrmSettingsSection hostId="host-1" org={stored} />)
    expect(sharingCalls.some((call) => call.action === 'default-apply')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Apply to existing records…' }))
    await waitFor(() =>
      expect(sharingCalls.some((call) => call.action === 'default-apply')).toBe(true),
    )
    await waitFor(() =>
      expect(screen.getByText('Applied: 12 records checked, 9 changed.')).toBeTruthy(),
    )
  })

  it('switches the choice off, with the reason, in a workspace with one site', () => {
    render(
      <CrmOrgMountProvider
        mount={{
          orgId: 'org-1',
          hosts: [{ id: 'host-1', name: 'Site A', subdomain: 'site-a' }],
          hostsReady: true,
          orgSlug: 'acme',
          hostsPath: '/acme/hosts',
        }}
      >
        <CrmSettingsSection hostId={null} org={{}} />
      </CrmOrgMountProvider>,
    )
    expect(screen.getByRole<HTMLInputElement>('radio', { name: EXCEPT }).disabled).toBe(true)
    expect(
      screen.getByText('This workspace has one site, so there is nothing to leave out.'),
    ).toBeTruthy()
  })

  it('switches Save and Apply off, naming the permission, for a member without "Change CRM settings"', () => {
    memberRole = 'editor'
    render(<CrmSettingsSection hostId="host-1" org={stored} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Apply to existing records…' }).disabled,
    ).toBe(true)
    expect(sharingCalls.some((call) => call.action === 'sites')).toBe(false)
  })
})

describe('your sending addresses (AGL-2975)', () => {
  it('mounts directly under Email capture, for any member, with the org the scope resolved', () => {
    memberRole = 'viewer'
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    const regions = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(regions.indexOf('Your sending addresses')).toBe(regions.indexOf('Email capture') + 1)
    const card = screen.getByRole('region', { name: 'Your sending addresses' })
    expect(card.getAttribute('data-org')).toBe('org-1')
    expect(card.getAttribute('data-ready')).toBe('true')
  })
})
