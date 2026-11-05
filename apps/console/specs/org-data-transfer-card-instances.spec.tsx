/**
 * A DATASET'S IMPORT ON THE HUB IS SWITCHED OFF WITH THE REASON (AGL-4047).
 *
 * Each dataset is listed with its own Import and Export. The route refuses an
 * import without "Manage data", and the row used to drop the button in silence.
 * It now stays, off, naming the key, but only for an answer about the key: while
 * `can` is still out it says no to both, and the plan has its own words.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockOpenImport = jest.fn()
const mockCan = { import: true, export: true }
const mockEntitled = { value: 'entitled' }
/** The permission the launcher names, once it knows one refuses. */
const mockRefused: { value: string | null } = { value: null }
/** Where the listed dataset is placed. */
let mockVisibleTo: string[] = ['org']
/** What the list was asked for. */
const mockListRequest = jest.fn()
/** The resource's own answer on an instance. */
const mockOwnAnswer = jest.fn()
const mockMemberRead: { value: { data: unknown; status: string } } = { value: { data: undefined, status: 'error' } }
const mockRoleRead: { value: { data: unknown; status: string } } = { value: { data: undefined, status: 'loading' } }

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDocs: async () => ({ docs: [{ id: 'dataset-1', data: () => ({ name: 'Trails', visibleTo: mockVisibleTo }) }] }),
}))
jest.mock('@aglyn/aglyn/app-utils/transfer-launcher-context', () => ({
  useTransferLauncher: () => ({
    openImport: mockOpenImport,
    openExport: jest.fn(),
    unfinished: () => [],
    can: (action: 'import' | 'export', target: { importAllowed?: boolean }) =>
      action === 'import' && typeof target.importAllowed === 'boolean' ? target.importAllowed : mockCan[action],
    refusedPermission: (_action: 'import' | 'export', target: { importAllowed?: boolean }) =>
      target.importAllowed === false ? 'data.manage' : mockRefused.value,
  }),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-record-lists', () => ({
  pluginRecordListQuery: (_kind: string, _db: unknown, request: unknown) => {
    mockListRequest(request)
    return 'dataset-query'
  },
  pluginRecordsFromRows: (_kind: string, rows: { $id: string; name: string; visibleTo?: string[] }[]) =>
    rows.map((row) => ({ id: row.$id, name: row.name, facts: { visibleTo: row.visibleTo ?? [] } })),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'reader-1' } }),
  useFirestoreDoc: (factory: () => string | null) => {
    const path = factory()
    if (!path) return { data: undefined, status: 'loading' }
    return path.includes('/members/') ? mockMemberRead.value : mockRoleRead.value
  },
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'starter', enabledPlugins: ['data'] }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-hosts', () => ({ useOrgHosts: () => ({ hosts: [] }) }))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ loaded: true, can: () => false }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-console-plugins', () => ({ useConsoleSlotPlugins: () => true }))
jest.mock('../utils/extension-entitlement', () => ({
  resolveExtensionEntitlement: () => mockEntitled.value,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-transfer-resources', () => {
  const actual = jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-transfer-resources')
  const dataset = {
    pluginId: 'data',
    key: 'data.dataset',
    label: 'Dataset records',
    scope: 'org',
    kinds: ['records'],
    instances: true,
    readableByMembers: true,
    featureFlag: 'datasetImports',
    featureFlagExempt: ['export'],
  }
  return {
    ...actual,
    listTransferResourcesFor: (subject: { scope: string }) => (subject.scope === 'org' ? [dataset] : []),
    pluginTransferResourceUi: () => ({
      label: 'Dataset records',
      instancesFrom: 'dataset',
      instanceImportAccess: (subject: unknown) => mockOwnAnswer(subject),
    }),
  }
})

import OrgDataTransferCard from '../components/settings/org-data-transfer-card.component'

const REFUSAL = 'Your role does not include "Manage data" — ask an organization admin'
const SITE_REFUSAL = 'Your role does not include "Manage this site’s data" — ask an organization admin'

const mountRow = async () => {
  render(<OrgDataTransferCard />)
  await screen.findByText('Trails')
}
const importButton = () => screen.queryByRole('button', { name: 'Import' }) as HTMLButtonElement | null

beforeEach(() => {
  mockOpenImport.mockReset()
  mockListRequest.mockClear()
  mockOwnAnswer.mockReset()
  mockOwnAnswer.mockImplementation(() => null)
  mockCan.import = true
  mockCan.export = true
  mockEntitled.value = 'entitled'
  mockRefused.value = null
  mockVisibleTo = ['org']
  mockMemberRead.value = { data: undefined, status: 'error' }
  mockRoleRead.value = { data: undefined, status: 'loading' }
})

describe('a dataset’s Import on the hub', () => {
  it('is on for a member who may import', async () => {
    await mountRow()
    expect(importButton()?.disabled).toBe(false)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    fireEvent.click(importButton() as HTMLButtonElement)
    expect(mockOpenImport).toHaveBeenCalledWith(expect.objectContaining({ resource: 'data.dataset:dataset-1' }))
  })

  it('is off for a member who may not, naming the permission, beside an Export that stays', async () => {
    mockCan.import = false
    mockRefused.value = 'data.manage'
    await mountRow()
    expect(importButton()?.disabled).toBe(true)
    expect(screen.getByLabelText(REFUSAL).contains(importButton())).toBe(true)
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('says so whether or not the member may export', async () => {
    mockCan.import = false
    mockCan.export = false
    mockRefused.value = 'data.manage'
    await mountRow()
    expect(importButton()?.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })

  it('says nothing while the launcher has not answered', async () => {
    mockCan.import = false
    mockCan.export = false
    await mountRow()
    expect(importButton()).toBeNull()
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('does not blame the permission for what the plan refuses', async () => {
    mockCan.import = false
    mockEntitled.value = 'locked'
    await mountRow()
    expect(importButton()).toBeNull()
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })
})

describe('a dataset’s Import follows where it is placed (AGL-4047)', () => {
  const SITE_MEMBER = { role: 'viewer', allHosts: false, hostAccess: { 'host-a': 'editor' }, scopeTokens: ['org', 'host:host-a'] }
  const EDITOR = { role: 'editor', allHosts: true, hostAccess: { 'host-a': 'author' } }

  it('is off with the placement’s own reason for a narrowed editor the workspace’s key would admit', async () => {
    mockMemberRead.value = { data: EDITOR, status: 'success' }
    mockVisibleTo = ['host:host-a']
    mockOwnAnswer.mockImplementation(() => ({ allowed: false, reason: SITE_REFUSAL }))
    await mountRow()
    expect(importButton()?.disabled).toBe(true)
    expect(screen.getByLabelText(SITE_REFUSAL).contains(importButton())).toBe(true)
    expect(mockOwnAnswer).toHaveBeenCalledWith({
      record: { id: 'dataset-1', name: 'Trails', facts: { visibleTo: ['host:host-a'] } },
      member: EDITOR,
      customRole: null,
    })
  })

  it('is on for a site Editor the workspace’s key would refuse', async () => {
    mockCan.import = false
    mockMemberRead.value = { data: SITE_MEMBER, status: 'success' }
    mockVisibleTo = ['host:host-a']
    mockOwnAnswer.mockImplementation(() => ({ allowed: true, reason: SITE_REFUSAL }))
    await mountRow()
    expect(importButton()?.disabled).toBe(false)
    expect(screen.queryByLabelText(SITE_REFUSAL)).toBeNull()
    fireEvent.click(importButton() as HTMLButtonElement)
    expect(mockOpenImport).toHaveBeenCalledWith(expect.objectContaining({ resource: 'data.dataset:dataset-1' }))
  })

  it('still answers to the plan first', async () => {
    mockEntitled.value = 'locked'
    mockCan.import = false
    mockMemberRead.value = { data: SITE_MEMBER, status: 'success' }
    mockOwnAnswer.mockImplementation(() => null)
    await mountRow()
    expect(importButton()).toBeNull()
  })

  it('asks a member who does not reach every site for what they reach, which the rules can prove', async () => {
    mockMemberRead.value = { data: SITE_MEMBER, status: 'success' }
    await mountRow()
    expect(mockListRequest).toHaveBeenCalledWith(expect.objectContaining({ memberScope: ['org', 'host:host-a'] }))
  })

  it('asks no scope of a member of the whole workspace', async () => {
    mockMemberRead.value = { data: { role: 'editor', allHosts: true }, status: 'success' }
    await mountRow()
    expect(mockListRequest).toHaveBeenCalledWith(expect.objectContaining({ memberScope: null }))
  })

  it('lists nothing until the member is known, since an unfiltered list is refused whole', async () => {
    mockMemberRead.value = { data: undefined, status: 'loading' }
    render(<OrgDataTransferCard />)
    await act(async () => {})
    expect(mockListRequest).not.toHaveBeenCalled()
  })

  it('reads a custom role only for someone it can decide, and holds the row until it lands', async () => {
    mockMemberRead.value = { data: { role: 'editor', allHosts: true, roleId: 'role-1' }, status: 'success' }
    mockRoleRead.value = { data: undefined, status: 'loading' }
    const view = render(<OrgDataTransferCard />)
    await act(async () => {})
    expect(screen.queryByText('Trails')).toBeNull()
    mockRoleRead.value = { data: { name: 'Custom' }, status: 'success' }
    view.rerender(<OrgDataTransferCard />)
    await screen.findByText('Trails')
    expect(mockOwnAnswer).toHaveBeenCalledWith(expect.objectContaining({ customRole: { name: 'Custom' } }))
  })
})
