/**
 * A DATASET'S IMPORT ON THE HUB IS SWITCHED OFF WITH THE REASON (AGL-4047).
 *
 * Each dataset is listed with its own Import and Export. The route refuses an
 * import without "Manage data", and the row used to drop the button in silence.
 * It now stays, off, naming the key, but only for an answer about the key: while
 * `can` is still out it says no to both, and the plan has its own words.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockOpenImport = jest.fn()
const mockCan = { import: true, export: true }
const mockEntitled = { value: 'entitled' }

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('firebase/firestore', () => ({
  getDocs: async () => ({ docs: [{ id: 'dataset-1', data: () => ({ name: 'Trails' }) }] }),
}))
jest.mock('@aglyn/aglyn/app-utils/transfer-launcher-context', () => ({
  useTransferLauncher: () => ({
    openImport: mockOpenImport,
    openExport: jest.fn(),
    unfinished: () => [],
    can: (action: 'import' | 'export') => mockCan[action],
  }),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-record-lists', () => ({
  pluginRecordListQuery: () => 'dataset-query',
  pluginRecordsFromRows: (_kind: string, rows: { $id: string; name: string }[]) =>
    rows.map((row) => ({ id: row.$id, name: row.name })),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'reader-1' } }),
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
    pluginTransferResourceUi: () => ({ label: 'Dataset records', instancesFrom: 'dataset' }),
  }
})

import OrgDataTransferCard from '../components/settings/org-data-transfer-card.component'

const REFUSAL = 'Your role does not include "Manage data" — ask an organization admin'

const mountRow = async () => {
  render(<OrgDataTransferCard />)
  await screen.findByText('Trails')
}
const importButton = () => screen.queryByRole('button', { name: 'Import' }) as HTMLButtonElement | null

beforeEach(() => {
  mockOpenImport.mockReset()
  mockCan.import = true
  mockCan.export = true
  mockEntitled.value = 'entitled'
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
    await mountRow()
    expect(importButton()?.disabled).toBe(true)
    expect(screen.getByLabelText(REFUSAL).contains(importButton())).toBe(true)
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(false)
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
