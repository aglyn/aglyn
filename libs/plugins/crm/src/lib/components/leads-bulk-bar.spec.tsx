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
 * THE BULK BAR OVER THE LEADS TABLE (AGL-2662).
 *
 * What it must hold: every write names the ROW'S site and document, so a
 * selection spanning sites at the organization level lands each lead
 * under its own site; the owner is batched; a status is set only on a
 * lead that is not converted and not already there, the rest named; one
 * reason unqualifies every open lead and the closed and converted ones
 * are named; the export is the list's file over the selection.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type LeadBulkRow, LeadsBulkBar } from './leads-bulk-bar'

let ops: Array<{ via: 'batch' | 'single'; kind: string; path: string; data?: any }>
jest.mock('firebase/firestore', () => ({
  // Rooted at the store, or at a collection reference (the filing entries).
  doc: (base: { path?: string }, ...segments: string[]) => ({
    path: [base?.path, ...segments].filter(Boolean).join('/'),
  }),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  arrayUnion: (...values: unknown[]) => ({ op: 'arrayUnion', values }),
  writeBatch: () => {
    const staged: typeof ops = []
    return {
      update: (ref: { path: string }, data: unknown) =>
        void staged.push({ via: 'batch', kind: 'update', path: ref.path, data }),
      delete: (ref: { path: string }) =>
        void staged.push({ via: 'batch', kind: 'delete', path: ref.path }),
      commit: async () => void ops.push(...staged),
    }
  },
  updateDoc: async (ref: { path: string }, data: unknown) =>
    void ops.push({ via: 'single', kind: 'update', path: ref.path, data }),
  deleteDoc: async (ref: { path: string }) =>
    void ops.push({ via: 'single', kind: 'delete', path: ref.path }),
  // The filing entries Add to campaign writes on each lead's Activity
  // (AGL-3274), each under a platform-minted id.
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: async (ref: { path: string }, data: unknown) =>
    void ops.push({ via: 'single', kind: 'set', path: ref.path, data }),
}))

/** The filing entries written, by the activity path they were named under. */
const filings = () => ops.filter((op) => op.kind === 'set' && op.path.startsWith('orgs/org-1/crmActivities/'))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-a' } }),
  useUserName: () => 'Ada Lovelace',
  // The site's campaigns the Add to campaign picker offers (AGL-3254).
  useHostCampaigns: () => ({
    options: [
      { value: 'founder-icp1', label: 'Founder · ICP 1' },
      { value: 'founder-icp2', label: 'Founder · ICP 2' },
    ],
    truncated: false,
    ready: true,
  }),
}))

let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

const downloads: Array<{ name: string; body: string }> = []
jest.mock('../model/contacts-csv', () => ({
  downloadTextFile: (name: string, _type: string, body: string) =>
    void downloads.push({ name, body }),
}))

const roster = {
  options: [
    { uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' },
  ],
  labelFor: (ref: string | null | undefined) => (ref === 'uid-a' ? 'Ada Lovelace' : 'Unassigned'),
  emailFor: (ref: string | null | undefined) => (ref === 'uid-a' ? 'ada@example.com' : String(ref ?? '')),
  ready: true,
  loading: false,
  error: null,
} as any

const lead = (
  hostId: string,
  leadId: string,
  email: string,
  fields: Record<string, unknown> = {},
): LeadBulkRow => ({
  $id: `${hostId}/${leadId}`,
  leadId,
  hostId,
  email,
  name: email.split('@')[0],
  lastSeenAtMs: 1_000,
  ...fields,
})
const rows: LeadBulkRow[] = [
  lead('site-1', 'l-open', 'maya@example.com'),
  lead('site-2', 'l-working', 'theo@example.com', { status: 'working' }),
  lead('site-1', 'l-converted', 'june@example.com', {
    status: 'qualified',
    convertedContactId: 'c-june',
  }),
  lead('site-2', 'l-closed', 'sam@example.com', {
    status: 'unqualified',
    unqualifiedReason: 'Not a fit',
  }),
]

function mount(selected: string[], onSelectedChange = jest.fn()) {
  render(
    <LeadsBulkBar
      rows={rows}
      selected={selected}
      onSelectedChange={onSelectedChange}
      roster={roster}
      csv={{ ownerEmail: roster.emailFor, siteName: (id: string) => (id === 'site-1' ? 'Shop' : undefined) }}
    />,
  )
  return { onSelectedChange }
}

const dialog = () => within(screen.getByRole('dialog'))
const ALL = rows.map((row) => row.$id)

beforeEach(() => {
  ops = []
  notices = []
  downloads.length = 0
})

describe('the bar and its selection', () => {
  it('renders nothing when nothing is selected, and every action otherwise', () => {
    const { container } = render(
      <LeadsBulkBar rows={rows} selected={[]} onSelectedChange={jest.fn()} roster={roster} />,
    )
    expect(container.innerHTML).toBe('')
    mount(ALL.slice(0, 2))
    expect(screen.getByText('2 selected')).toBeTruthy()
    for (const name of ['Set owner', 'Set status', 'Unqualify', 'Export CSV', 'Clear']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})

describe('the owner', () => {
  it('writes the chosen owner to every row, each under its own site, in one batch', async () => {
    mount(ALL.slice(0, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Set owner' }))
    fireEvent.mouseDown(dialog().getByRole('combobox', { name: 'Owner' }))
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace (ada@example.com)' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Owner set on 2 leads']))
    expect(ops.map((op) => [op.via, op.path, (op.data as any).ownerUid])).toEqual([
      ['batch', 'hosts/site-1/leads/l-open', 'uid-a'],
      ['batch', 'hosts/site-2/leads/l-working', 'uid-a'],
    ])
  })
})

/*
 * Add to campaign (AGL-3254): under a site, the site's campaigns by name,
 * ADDED to each selected lead in one batch; nothing offered at the
 * organization level, where a selection spans sites.
 */
describe('the campaign', () => {
  it('adds the picked campaigns to every selected lead, in one batch', async () => {
    render(
      <LeadsBulkBar
        rows={rows}
        selected={ALL.slice(0, 2)}
        onSelectedChange={jest.fn()}
        roster={roster}
        orgId="org-1"
        hostId="site-1"
        org={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to campaign' }))
    fireEvent.mouseDown(dialog().getByRole('combobox', { name: 'Campaigns' }))
    fireEvent.click(screen.getByRole('option', { name: 'Founder · ICP 2' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    fireEvent.click(dialog().getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(notices).toEqual(['Added 2 leads to the campaign']))
    const writes = ops.filter((op) => op.kind === 'update')
    expect(writes.map((op) => [op.via, op.path, (op.data as any).campaignIds])).toEqual([
      ['batch', 'hosts/site-1/leads/l-open', { op: 'arrayUnion', values: ['founder-icp2'] }],
      ['batch', 'hosts/site-2/leads/l-working', { op: 'arrayUnion', values: ['founder-icp2'] }],
    ])
    /*
     * And each lead's Activity says so (AGL-3274): one "Filed under" per
     * lead, named, by the member, into the org's activity collection with
     * the site's scope — after the batch, never in it.
     */
    await waitFor(() => expect(filings()).toHaveLength(2))
    const adds = filings()
    expect(adds.map((op) => [(op.data as any).leadId, (op.data as any).body])).toEqual([
      ['l-open', 'Filed under Founder · ICP 2'],
      ['l-working', 'Filed under Founder · ICP 2'],
    ])
    expect(adds[0].data).toMatchObject({
      kind: 'note',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
      byUid: 'uid-a',
      byName: 'Ada Lovelace',
      sourcePluginId: 'crm',
      campaignId: 'founder-icp2',
    })
  })

  it('files nothing on a lead already in the campaign (AGL-3274)', async () => {
    render(
      <LeadsBulkBar
        rows={[lead('site-1', 'l-in', 'in@example.com', { campaignIds: ['founder-icp2'] })]}
        selected={['site-1/l-in']}
        onSelectedChange={jest.fn()}
        roster={roster}
        orgId="org-1"
        hostId="site-1"
        org={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to campaign' }))
    fireEvent.mouseDown(dialog().getByRole('combobox', { name: 'Campaigns' }))
    fireEvent.click(screen.getByRole('option', { name: 'Founder · ICP 2' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    fireEvent.click(dialog().getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(notices).toEqual(['Added 1 lead to the campaign']))
    expect(filings()).toEqual([])
  })

  it('is not offered at the organization level', () => {
    mount(ALL.slice(0, 2))
    expect(screen.queryByRole('button', { name: 'Add to campaign' })).toBeNull()
  })
})

describe('the status', () => {
  it('sets it on the leads that can take it and names the converted and the already-there', async () => {
    mount(ALL)
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }))
    fireEvent.mouseDown(dialog().getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Working' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Status set on 2 leads']))
    expect(ops.map((op) => [op.path, (op.data as any).status, (op.data as any).unqualifiedReason])).toEqual([
      ['hosts/site-1/leads/l-open', 'working', undefined],
      // Reopening a closed lead clears its reason.
      ['hosts/site-2/leads/l-closed', 'working', { op: 'delete' }],
    ])
    expect(screen.getByText(/june — was converted/)).toBeTruthy()
    expect(screen.getByText(/theo — already Working/)).toBeTruthy()
  })
})

describe('unqualifying', () => {
  it('closes every open lead with the one reason and names the rest', async () => {
    mount(ALL)
    fireEvent.click(screen.getByRole('button', { name: 'Unqualify' }))
    const apply = dialog().getByRole('button', { name: 'Unqualify' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.change(dialog().getByLabelText('Reason'), { target: { value: ' No budget ' } })
    fireEvent.click(apply)
    await waitFor(() => expect(notices).toEqual(['Marked 2 leads unqualified']))
    expect(ops.map((op) => [op.path, (op.data as any).status, (op.data as any).unqualifiedReason])).toEqual([
      ['hosts/site-1/leads/l-open', 'unqualified', 'No budget'],
      ['hosts/site-2/leads/l-working', 'unqualified', 'No budget'],
    ])
    expect(screen.getByText(/june — was converted/)).toBeTruthy()
    expect(screen.getByText(/sam — is already closed/)).toBeTruthy()
  })
})

describe('the file', () => {
  it('exports the selection with the owner by address and the site by name', () => {
    mount([ALL[0]])
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toBe('leads-selected.csv')
    const [header, line] = downloads[0].body.split('\n')
    // The profile columns (AGL-3231) come before the working state, and
    // the site sits beside the owner; a lead with no profile leaves them blank.
    expect(header.split(',').slice(0, 9)).toEqual([
      'Email',
      'Name',
      'Company',
      'Job title',
      'Phone',
      'Website',
      'Status',
      'Owner',
      'Site',
    ])
    expect(line.startsWith('maya@example.com,maya,,,,,New,,Shop,')).toBe(true)
  })
})
