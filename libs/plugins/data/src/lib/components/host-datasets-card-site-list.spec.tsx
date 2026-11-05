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
 * A site's Data page lists that site's datasets, whoever is looking (AGL-4047).
 *
 * A dataset shared with one site showed on every other site's Data page for
 * anyone who reaches the whole workspace: the card's filter asked only the
 * VIEWER's reach, and an org-wide member's reach has no filter at all. Every
 * other site surface (the pickers, the published page, the AI, the record
 * templates) already asks the site.
 *
 * The stand-in applies the constraints the card really builds to the documents,
 * the way Firestore would, so what is asserted is what would come back. Member
 * tokens are the real projection's, `projectMemberScopeTokens`.
 *
 * NO PRODUCTION DATA IS READ; every Firestore call is a local stub.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { projectMemberScopeTokens } from '@aglyn/aglyn/app-utils/organizations'
import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'
import { holdsDatasetPermission } from './use-dataset-writes-blocked'

const text = { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } }
const ON_A = { $id: 'ds-a', displayName: 'Only on A', model: text, visibleTo: ['host:site-a'] }
const ON_B = { $id: 'ds-b', displayName: 'Only on B', model: text, visibleTo: ['host:site-b'] }
const WIDE = { $id: 'ds-wide', displayName: 'Everywhere', model: text, visibleTo: ['org'] }
const ON_A_AND_B = { $id: 'ds-both', displayName: 'On A and B', model: text, visibleTo: ['host:site-a', 'host:site-b'] }
const UNSHARED = { $id: 'ds-none', displayName: 'Shared with nobody', model: text }
const STORED: Array<Record<string, any>> = [ON_A, ON_B, WIDE, ON_A_AND_B, UNSHARED]

/** Replaced per case; stable within one, like the real listener's answer. */
let datasets: Array<Record<string, any>> = STORED
let viewer: { tokens: string[]; orgWide: boolean; loaded: boolean }
let member: Record<string, unknown> | undefined
let recordDocs: Array<Record<string, any>>
/** What a `records` read finds, by dataset id. */
let recordsOf: Record<string, Array<{ id: string; values: Record<string, unknown> }>>
let reachReadRejects = false

const answers = new Map<string, any[]>()
/** The documents a built query matches, as Firestore would pick them. */
const matching = (built: { constraints?: Array<Record<string, any>> }) => {
  const clause = built.constraints?.find((one) => one['field'] === 'visibleTo')
  if (!clause) return datasets
  return datasets.filter((row) =>
    (row['visibleTo'] ?? []).some((token: string) => clause['value'].includes(token)),
  )
}

const getDocsSpy = jest.fn(async (built: any) => {
  if (String(built.path).endsWith('/datasets')) {
    if (reachReadRejects) throw new Error('permission-denied')
    return {
      docs: matching(built).map(({ $id, ...data }) => ({ id: $id, data: () => data })),
    }
  }
  const datasetId = String(built.path).split('/').at(-2) as string
  return {
    docs: (recordsOf[datasetId] ?? []).map((hit) => ({
      id: hit.id,
      ref: { id: hit.id },
      get: (field: string) => (field === 'values' ? hit.values : undefined),
    })),
  }
})
const deleteDocSpy = jest.fn(async (_ref: unknown) => undefined)

const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreDoc: () =>
    member ? { data: member, status: 'success' } : { data: undefined, status: 'loading' },
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => viewer,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (!String(built?.path ?? '').endsWith('/datasets')) {
      return { data: [], status: 'success', fromCache: false }
    }
    // Stable per query, or the reference effect re-runs into a render loop.
    const key = JSON.stringify(built.constraints)
    if (!answers.has(key)) answers.set(key, matching(built))
    return { data: answers.get(key), status: 'success', fromCache: false }
  },
  usePagedCollection: () => ({
    rows: recordDocs,
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => undefined,
  getCountFromServer: async () => ({ data: () => ({ count: 2 }) }),
  getDoc: async (ref: { path: string }) => {
    const id = ref.path.split('/').at(-1)
    const row = STORED.find((one) => one['$id'] === id) ?? datasets.find((one) => one['$id'] === id)
    if (!row) return { exists: () => false, id }
    const { $id, ...data } = row
    return { exists: () => true, id: $id, data: () => data }
  },
  getDocs: (built: unknown) => getDocsSpy(built),
  deleteDoc: (ref: unknown) => deleteDocSpy(ref),
  setDoc: jest.fn(async () => undefined),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

const ORG_WIDE = { tokens: ['org'], orgWide: true, loaded: true }
/** A collaborator invited to one site, as the projection stamps them. */
const collaborator = (hostId: string) => ({
  tokens: projectMemberScopeTokens({ role: 'editor', allHosts: false, hostAccess: { [hostId]: 'editor' } } as never),
  orgWide: false,
  loaded: true,
})

beforeEach(() => {
  jest.clearAllMocks()
  answers.clear()
  datasets = STORED
  viewer = ORG_WIDE
  member = undefined
  recordDocs = []
  recordsOf = {}
  reachReadRejects = false
})

const mountCard = async (props: Record<string, unknown>) => {
  render(<HostDatasetsCard org={{ $id: 'org-1', plan: 'scale' } as any} {...props} />)
  await act(async () => {
    await Promise.resolve()
  })
}

/** The names the Dataset picker offers. */
const listed = () => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Dataset' }))
  const names = within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent)
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  return names
}

describe("a site's Data page lists what is shared with that site", () => {
  it('shows an org-wide member only site B’s and the workspace-wide ones on site B', async () => {
    await mountCard({ hostId: 'site-b' })
    expect(listed()).toEqual(['Everywhere', 'On A and B', 'Only on B'])
  })

  it('shows the same member site A’s on site A', async () => {
    await mountCard({ hostId: 'site-a' })
    expect(listed()).toEqual(['Everywhere', 'On A and B', 'Only on A'])
  })

  it('narrows a member who reaches two sites to the site being worked on', async () => {
    viewer = {
      tokens: projectMemberScopeTokens({ role: 'editor', allHosts: false, hostAccess: { 'site-a': 'editor', 'site-b': 'editor' } } as never),
      orgWide: false,
      loaded: true,
    }
    await mountCard({ hostId: 'site-a' })
    expect(listed()).toEqual(['Everywhere', 'On A and B', 'Only on A'])
  })

  it('asks Firestore, rather than matching over what loaded', async () => {
    const ceiling = jest.spyOn(answers, 'set')
    await mountCard({ hostId: 'site-b' })
    expect(ceiling).toHaveBeenCalled()
    const key = JSON.parse(String(ceiling.mock.calls[0]?.[0]))
    expect(key).toEqual([
      { field: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:site-b'] },
      { limit: 100 },
    ])
  })
})

describe('the organization Data page is unchanged', () => {
  it('lists everything for an org-wide member, a dataset shared with nobody included', async () => {
    await mountCard({ orgId: 'org-1' })
    expect(listed()).toEqual(['Everywhere', 'On A and B', 'Only on A', 'Only on B', 'Shared with nobody'])
  })

  it('lists a collaborator’s own reach', async () => {
    viewer = collaborator('site-a')
    await mountCard({ orgId: 'org-1' })
    expect(listed()).toEqual(['Everywhere', 'On A and B', 'Only on A'])
  })

  it('takes the organization when handed both', async () => {
    await mountCard({ orgId: 'org-1', hostId: 'site-a' })
    expect(listed()).toContain('Only on B')
  })
})

describe('narrowing the list does not narrow what a delete protects', () => {
  /** On both sites, sorted first so the picker selects it. */
  const referenced = { ...ON_A_AND_B, displayName: 'Attendees' }
  /** Holds references to it, on site A alone, so site B’s list does not show it. */
  const holder = {
    $id: 'ds-holder',
    displayName: 'Bookings',
    visibleTo: ['host:site-a'],
    model: {
      order: ['attendee'],
      fields: {
        attendee: {
          name: 'Attendee',
          type: 'reference',
          reference: { datasetId: 'ds-both', onDelete: 'restrict' },
        },
      },
    },
  }

  const arm = () => {
    datasets = [referenced, holder]
    recordDocs = [{ $id: 'rec-1', values: { name: 'Ada' } }]
    recordsOf = { 'ds-holder': [{ id: 'bk-1', values: { attendee: 'rec-1' } }] }
  }
  const deleteRecord = () => fireEvent.click(screen.getAllByText('Delete')[1] as HTMLElement)

  it('still refuses when a dataset the site does not list holds the record', async () => {
    arm()
    await mountCard({ hostId: 'site-b' })
    expect(listed()).toEqual(['Attendees'])

    deleteRecord()
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(String(enqueueSnackbar.mock.calls.at(-1)?.[0])).toContain('Bookings')
    expect(deleteDocSpy).not.toHaveBeenCalled()
  })

  it('reads the viewer’s reach, not the site, for a collaborator on two sites', async () => {
    arm()
    viewer = {
      tokens: projectMemberScopeTokens({ role: 'editor', allHosts: false, hostAccess: { 'site-a': 'editor', 'site-b': 'editor' } } as never),
      orgWide: false,
      loaded: true,
    }
    await mountCard({ hostId: 'site-b' })
    deleteRecord()
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(getDocsSpy.mock.calls[0]?.[0]).toMatchObject({
      path: 'orgs/org-1/datasets',
      constraints: [
        { field: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:site-a', 'host:site-b'] },
        { limit: 100 },
      ],
    })
    expect(deleteDocSpy).not.toHaveBeenCalled()
  })

  it('FAILS CLOSED when the reach cannot be read', async () => {
    arm()
    reachReadRejects = true
    await mountCard({ hostId: 'site-b' })
    deleteRecord()
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(String(enqueueSnackbar.mock.calls.at(-1)?.[0])).toContain('Nothing was deleted')
    expect(deleteDocSpy).not.toHaveBeenCalled()
  })

  it('THE CONTROL: with nothing holding it, the delete goes through', async () => {
    arm()
    recordsOf = {}
    await mountCard({ hostId: 'site-b' })
    deleteRecord()
    await waitFor(() => expect(deleteDocSpy).toHaveBeenCalled())
  })

  it('costs the organization page no extra read', async () => {
    arm()
    recordsOf = {}
    await mountCard({ orgId: 'org-1' })
    deleteRecord()
    await waitFor(() => expect(deleteDocSpy).toHaveBeenCalled())
    expect(
      getDocsSpy.mock.calls.filter(([built]) => String(built.path).endsWith('/datasets')),
    ).toHaveLength(0)
  })
})

describe('a reference to a dataset this site does not list keeps its label', () => {
  it('names the row, reading the target once by id', async () => {
    const shown = {
      $id: 'ds-shown',
      displayName: 'Shown',
      visibleTo: ['host:site-b'],
      model: {
        order: ['who'],
        fields: { who: { name: 'Who', type: 'reference', reference: { datasetId: 'ds-a' } } },
      },
    }
    datasets = [shown, ON_A]
    recordDocs = [{ $id: 'rec-1', values: { who: 'target-1' } }]
    recordsOf = { 'ds-a': [{ id: 'target-1', values: { name: 'Ada' } }] }
    await mountCard({ hostId: 'site-b' })
    await waitFor(() => expect(screen.getByText('Ada')).toBeTruthy())
    expect(screen.queryByText('target-1')).toBeNull()
  })
})

describe('write controls follow the key, switched off with the reason', () => {
  const REASON = 'Your role does not include "Manage data" — ask an organization admin'

  const buttons = () => ({
    add: screen.getByRole('button', { name: 'Add dataset' }) as HTMLButtonElement,
    record: screen.getByRole('button', { name: 'Add record' }) as HTMLButtonElement,
    schema: screen.getByRole('button', { name: 'Schema' }) as HTMLButtonElement,
    remove: screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLButtonElement,
  })

  it('shows a viewer every write control off, naming the permission', async () => {
    member = { role: 'viewer' }
    await mountCard({ hostId: 'site-a' })
    const { add, record, schema, remove } = buttons()
    expect([add.disabled, record.disabled, schema.disabled, remove.disabled]).toEqual([true, true, true, true])
    expect(screen.getAllByLabelText(REASON).length).toBeGreaterThan(0)
    expect(
      screen.getAllByLabelText('Your role does not include "Delete workspace records" — ask an organization admin').length,
    ).toBe(1)
  })

  it('leaves them on for an editor', async () => {
    member = { role: 'editor' }
    await mountCard({ hostId: 'site-a' })
    const { add, record, schema, remove } = buttons()
    expect([add.disabled, record.disabled, schema.disabled, remove.disabled]).toEqual([false, false, false, false])
  })

  it('follows a stamped grant and a stamped refusal, not the role', async () => {
    expect(holdsDatasetPermission({ role: 'viewer', resolvedPermissions: { 'data.manage': true } }, 'data.manage')).toBe(true)
    expect(holdsDatasetPermission({ role: 'editor', resolvedPermissions: { 'data.manage': false } }, 'data.manage')).toBe(false)
    expect(holdsDatasetPermission({ role: 'viewer', permissions: { 'data.manage': true } } as never, 'data.manage')).toBe(true)
    expect(holdsDatasetPermission({ role: 'viewer' }, 'data.manage')).toBe(false)
    expect(holdsDatasetPermission({ role: 'owner' }, 'data.manage')).toBe(true)
  })

  it('holds nothing off while the member loads', async () => {
    member = undefined
    await mountCard({ hostId: 'site-a' })
    expect(buttons().add.disabled).toBe(false)
  })
})
