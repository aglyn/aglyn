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
 * The Contacts list's Source filter and Sources header (AGL-3680), through the
 * real section, the real `planListQuery` and the list-query double.
 *
 *  1. A SOURCE A PLUGIN DECLARED IS A CHOICE, by its label. The CRM names no
 *     plugin, so the door here is a made-up one.
 *  2. PICKING IT IS A QUERY. It asks the `facetKeys` the writer stamps, so a
 *     person past the first page is still found.
 *  3. THE HEADER SORTS THE PAGE by the words on the chips.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { crmContactFacetKeys } from '@aglyn/aglyn/app-utils/crm'
import { registerPluginContactSource } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { lastListQueryPlan } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ContactsPeopleSection } from './contacts-section'

const ORG = { $id: 'org-1', plan: 'pro' } as any
const BASE_PATH = '/acme/hosts/shop/crm'

let mockRows: Array<Record<string, unknown>> = []
/** What the section last handed the table. */
let mockTable: any = null

jest.mock('./recent-activity-feed', () => ({
  __esModule: true,
  default: () => null,
  RecentActivityFeed: () => null,
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/list-query-double')
    .listQueryModule(
      () => mockRows,
      jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    ),
)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] as const, orgId: 'org-1' }),
  useSiteContainerOptions: () => ({ options: [], truncated: false, ready: true }),
  useOrgContainerOptions: () => ({ options: [], truncated: false, ready: true }),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useFirestoreDoc: () => ({ data: { total: 0 }, status: 'success', fromCache: false }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
  useUser: () => ({ data: { uid: 'user-1' } }),
  useHostActivityLogger: () => jest.fn(),
}))
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string, ...constraints: unknown[]) => ({ name, constraints }),
  where: (path: string, op: string, value: unknown) => ({ where: path, op, value }),
  orderBy: (path: string, direction?: string) => ({ orderBy: path, direction }),
  limit: (value: number) => ({ limit: value }),
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: 1 }) }),
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx/components/list-table.component'),
  ListTable: (props: unknown) => {
    mockTable = props
    return null
  },
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

const contact = (id: string, sources: Record<string, true>, updatedAtMs: number) => {
  const record = {
    $id: id,
    email: `${id}@example.com`,
    name: id,
    updatedAt: new Date(updatedAtMs),
    visibleTo: ['host:site-1'],
    facets: { 'site-1': { sources, interactions: [], tags: [] } },
  }
  // Stamped by the writer's own function, so the query is asked what is written.
  return { ...record, facetKeys: crmContactFacetKeys(record) }
}

const renderList = () =>
  render(
    <ContactsPeopleSection
      hostId="site-1"
      entitled
      org={ORG}
      basePath={BASE_PATH}
      releaseFlag={{ released: true, ready: true } as any}
    />,
  )

const sourceChoices = (): Array<{ value: string; label: string }> =>
  mockTable.columns.find((column: { field: string }) => column.field === 'source').valueOptions

const pickSource = (value: string) =>
  act(() =>
    mockTable.onFilterModelChange({
      items: [{ id: 1, field: 'source', operator: 'is', value }],
    }),
  )

beforeEach(() => {
  mockRows = []
  mockTable = null
})

afterEach(() => unregisterPluginServices('kiosk'))

describe('the Source filter', () => {
  it('offers a source a plugin declared, by its label, beside the core’s', async () => {
    registerPluginContactSource({ source: 'kiosk', label: 'Guest book' }, { pluginId: 'kiosk' })
    mockRows = [contact('one', { form: true }, Date.UTC(2026, 9, 1))]
    renderList()
    await waitFor(() => expect(mockTable).not.toBeNull())
    expect(sourceChoices()).toContainEqual({ value: 'kiosk', label: 'Guest book' })
    expect(sourceChoices()).toContainEqual({ value: 'order', label: 'Customer' })
  })

  it('THE CONTROL: offers nothing for a door nobody declared', async () => {
    mockRows = [contact('one', { form: true }, Date.UTC(2026, 9, 1))]
    renderList()
    await waitFor(() => expect(mockTable).not.toBeNull())
    expect(sourceChoices().map((choice) => choice.value)).not.toContain('kiosk')
    expect(sourceChoices()).toContainEqual({ value: 'order', label: 'Customer' })
  })

  it('asks the query for the holder’s key, and finds a match past the first page', async () => {
    registerPluginContactSource({ source: 'kiosk', label: 'Guest book' }, { pluginId: 'kiosk' })
    // The one match is the oldest of a hundred, so no first page holds it.
    const newest = Date.UTC(2026, 9, 1)
    mockRows = [
      ...Array.from({ length: 99 }, (_unused, index) =>
        contact(`form-${index}`, { form: true }, newest - index * 1000),
      ),
      contact('signed', { kiosk: true }, newest - 1000 * 1000),
    ]
    renderList()
    pickSource('kiosk')
    await waitFor(() => {
      expect(lastListQueryPlan()?.filters).toEqual([
        { path: 'facetKeys', op: 'array-contains', value: 'site-1:source=kiosk' },
      ])
    })
    const plan = lastListQueryPlan()
    expect(plan?.refused).toEqual([])
    expect(plan?.orderBy).toMatchObject({ path: 'updatedAt', direction: 'desc' })
    await waitFor(() => {
      expect(mockTable.rows.map((row: { $id: string }) => row.$id)).toEqual(['signed'])
    })
  })
})

describe('the Sources header', () => {
  it('sorts the page by the words on the chips, and says it is the page', async () => {
    registerPluginContactSource({ source: 'kiosk', label: 'Guest book' }, { pluginId: 'kiosk' })
    const at = Date.UTC(2026, 9, 1)
    mockRows = [
      contact('by-form', { form: true }, at),
      contact('by-kiosk', { kiosk: true }, at - 1000),
      // Stored `order`, which spells after `form` and reads "Customer", before it.
      contact('by-order', { order: true }, at - 2000),
      contact('no-source', {}, at - 3000),
    ]
    renderList()
    await waitFor(() => expect(mockTable.rows).toHaveLength(4))
    expect(mockTable.columnSort.columns['sources']).toMatchObject({ mode: 'page' })
    const ids = () => mockTable.rows.map((row: { $id: string }) => row.$id)

    act(() => mockTable.columnSort.onSortModelChange([{ field: 'sources', sort: 'asc' }]))
    await waitFor(() =>
      expect(ids()).toEqual(['by-order', 'by-form', 'by-kiosk', 'no-source']),
    )
    expect(mockTable.columnSort.notices.join(' ')).toMatch(/Sources on this page only/)

    // Nobody's blank row leads, either way.
    act(() => mockTable.columnSort.onSortModelChange([{ field: 'sources', sort: 'desc' }]))
    await waitFor(() =>
      expect(ids()).toEqual(['by-kiosk', 'by-form', 'by-order', 'no-source']),
    )
  })
})
