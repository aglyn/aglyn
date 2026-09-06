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
 * The contacts list's Owner and Stage columns (AGL-2596).
 *
 * Both read off the flattened row and resolve to something a reader can
 * sort and export by — the owner's NAME rather than a uid, the stage's LABEL
 * rather than its key — and both are `filterable: false`, because the grid's
 * filter panel becomes a Firestore query over top-level fields and a facet
 * path is not one. The rest of the grammar (name, sources, tags, updatedAt,
 * the hidden filter columns) is the v1 list's, moved here unchanged.
 */

import type { GridColDef } from '@mui/x-data-grid'
import {
  CONTACT_FILTER_COLUMNS,
  CONTACT_OPTIONAL_COLUMNS,
  contactListColumns,
} from './contact-list-columns'
import type { ContactRecord } from '../model/contact-record'

const row = (overrides: Partial<ContactRecord> = {}): ContactRecord => ({
  $id: 'con-1',
  groupId: 'host-a',
  capturedByHostIds: ['host-a'],
  email: 'jo@example.com',
  name: 'Jo',
  canonicalName: 'Jo',
  nameOverride: '',
  sources: { form: true },
  interactions: [],
  tags: [],
  notes: '',
  campaignIds: [],
  ltvCents: 0,
  ordersCount: 0,
  phone: '',
  jobTitle: '',
  companyName: '',
  companyId: '',
  companyLink: { companyId: null, companyIds: [], heldElsewhere: [] },
  address: null,
  ownerUid: '',
  lifecycleStage: '',
  lastEmailEngagementAtMs: null,
  ...overrides,
})

const NOW = Date.UTC(2026, 8, 5, 12)
const DAY = 86_400_000

const columns = contactListColumns({
  memberName: (uid) => (uid === 'owner-1' ? 'Grace Hopper' : uid),
  nowMs: NOW,
})
const column = (field: string) =>
  columns.find((definition) => definition.field === field) as GridColDef
const value = (field: string, record: ContactRecord) =>
  (column(field).valueGetter as any)(undefined, record)

describe('contactListColumns', () => {
  it('keeps the v1 grammar and adds Owner and Stage between Contact and Sources', () => {
    // The shown columns lead; the hidden filter-only columns follow them.
    expect(columns.slice(0, 7).map((definition) => definition.field)).toEqual([
      'name',
      'ownerUid',
      'lifecycleStage',
      'sources',
      'tags',
      'updatedAt',
      'lastEmailEngagementAtMs',
    ])
    for (const field of CONTACT_FILTER_COLUMNS) {
      expect(column(field)).toBeDefined()
    }
  })

  /*
   * "Last engaged" (AGL-2616): the facet stamp, as a date the grid can sort
   * and export, printed in the timeline's relative words. Optional — it is
   * the one column the list ships hidden.
   */
  it('reads the engagement stamp as a date, prints it relatively, and ships hidden', () => {
    const engaged = row({ lastEmailEngagementAtMs: NOW - 3 * DAY })
    expect(value('lastEmailEngagementAtMs', engaged)).toEqual(new Date(NOW - 3 * DAY))
    expect(value('lastEmailEngagementAtMs', row())).toBeNull()
    expect(column('lastEmailEngagementAtMs').type).toBe('date')
    expect(column('lastEmailEngagementAtMs').filterable).toBe(false)
    expect(CONTACT_OPTIONAL_COLUMNS).toEqual(['lastEmailEngagementAtMs'])
    const cell = (column('lastEmailEngagementAtMs').renderCell as any)({ row: engaged })
    expect(JSON.stringify(cell)).toContain('3 days ago')
  })

  it('names the owner through the roster, and never offers the column as a query', () => {
    expect(value('ownerUid', row({ ownerUid: 'owner-1' }))).toBe('Grace Hopper')
    // Somebody the roster no longer lists is still identified, by uid.
    expect(value('ownerUid', row({ ownerUid: 'gone' }))).toBe('gone')
    expect(value('ownerUid', row())).toBe('')
    expect(column('ownerUid').filterable).toBe(false)
  })

  it('labels the stage, and reads no stage as empty', () => {
    expect(value('lifecycleStage', row({ lifecycleStage: 'sales-qualified' }))).toBe(
      'Sales qualified',
    )
    expect(value('lifecycleStage', row())).toBe('')
    expect(column('lifecycleStage').filterable).toBe(false)
  })

  /*
   * "Known by" (AGL-2630): the organization-level list's cross-site fact.
   * Present only when the caller can name a site — under a site the column
   * would read the same on every row — and never a query, because the
   * array clause is the scope clause's under a site.
   */
  it('adds "Known by" only when handed a way to name a site', () => {
    expect(column('capturedByHostIds')).toBeUndefined()
    const orgLevel = contactListColumns({
      memberName: () => '',
      siteName: (hostId) => ({ 'host-a': 'Site A', 'host-b': 'Site B' })[hostId] ?? hostId,
    })
    const knownBy = orgLevel.find((definition) => definition.field === 'capturedByHostIds')
    expect(knownBy?.headerName).toBe('Known by')
    expect(knownBy?.filterable).toBe(false)
    expect(knownBy?.sortable).toBe(false)
    // Between Stage and Sources, where the row's who-knows-them belongs.
    expect(orgLevel.slice(0, 5).map((definition) => definition.field)).toEqual([
      'name',
      'ownerUid',
      'lifecycleStage',
      'capturedByHostIds',
      'sources',
    ])
    const both = row({ capturedByHostIds: ['host-a', 'host-b'] })
    expect((knownBy?.valueGetter as any)(undefined, both)).toBe('Site A, Site B')
    expect(JSON.stringify((knownBy?.renderCell as any)({ row: both }))).toContain('Site B')
    // Unattributed is said, not read as "every site".
    expect(
      JSON.stringify((knownBy?.renderCell as any)({ row: row({ capturedByHostIds: [] }) })),
    ).toContain('No site recorded')
  })

  it('still lets the name column reach the query grammar', () => {
    expect(column('name').filterable).not.toBe(false)
    expect(value('name', row({ name: '', email: 'jo@example.com' }))).toBe(
      'jo@example.com',
    )
  })
})
