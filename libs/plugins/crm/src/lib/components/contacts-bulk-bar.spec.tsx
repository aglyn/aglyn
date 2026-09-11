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
 * THE BULK BAR OVER THE CONTACTS TABLE (AGL-2603, AGL-2804).
 *
 * What it must hold: it exists only for a selection and says how many; a
 * tag, an owner or a company set on the selection is ONE post to
 * `crm/contact-update` — a facet is the server's to write — and a stage is
 * moved through `crm/contact-stage` row by row, so every move is announced;
 * a row the server refuses is named by address on screen; and removing rows
 * is the record page's detach per row, behind the confirm, client-direct.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { soloConsentGroup } from '@aglyn/aglyn'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { ContactsBulkBar } from './contacts-bulk-bar'

/** Every client-direct write the store received, in order. */
let ops: Array<{ via: 'batch' | 'single'; kind: string; path: string; data?: any }>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: unknown) => base,
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
  arrayUnion: (...values: unknown[]) => ({ op: 'union', values }),
  arrayRemove: (...values: unknown[]) => ({ op: 'remove', values }),
  deleteField: () => ({ op: 'delete' }),
  increment: (by: number) => ({ op: 'increment', by }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
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
}))

const FIRESTORE = {}
/** The companies the picker's listen answers with, once its dialog is open. */
const COMPANY_ROWS = [
  { $id: 'c-acme', name: 'Acme', domain: 'acme.com', nameLower: 'acme' },
  { $id: 'c-globex', name: 'Globex', nameLower: 'globex' },
]
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useFirestoreCollection: (build: () => { path?: string } | null) => {
    const built = build()
    return {
      data: built && String(built.path).endsWith('/companies') ? COMPANY_ROWS : [],
      status: 'success',
      fromCache: false,
    }
  },
  useUser: () => ({ data: { uid: 'uid-me', getIdToken: async () => 'token' } }),
  useOrgMemberOptions: () => ({
    options: [{ uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com' }],
    ready: true,
    error: null,
  }),
}))

/** Everything the bar put in front of the reader through the snackbar. */
let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

/** Every post the bar made to a CRM route, in order. */
let posted: Array<{ route: string; payload: Record<string, any> }>
/** Contacts the profile route refuses, by id. */
let refuseRoute: Set<string>
jest.mock('../components/use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, any>) => {
    posted.push({ route, payload })
    if (route !== 'contact-update') {
      return { response: { ok: true, status: 200 }, payload: { ok: true } }
    }
    return {
      response: { ok: true, status: 200 },
      payload: {
        ok: true,
        results: (payload['contactIds'] as string[]).map((contactId) =>
          refuseRoute.has(contactId)
            ? { contactId, ok: false, error: 'not permitted' }
            : { contactId, ok: true },
        ),
      },
    }
  },
}))

/** Every stage move the bar asked for, and the rows the stage route refuses. */
const stageCalls = jest.fn()
let refuseStage: Set<string>
jest.mock('../model/crm-api', () => ({
  setContactStage: async (
    user: unknown,
    hostId: string,
    contactId: string,
    stage: string | null,
  ) => {
    stageCalls(user, hostId, contactId, stage)
    if (refuseStage.has(contactId)) throw new Error('Not a site admin or editor')
    return { ok: true, changed: true, lifecycleStage: stage ?? '', previousStage: '' }
  },
}))

/** Confirm resolves (proceed) or rejects (cancel), the way the real one does. */
let confirmAnswer: 'proceed' | 'cancel'
const confirmSpy = jest.fn(() =>
  confirmAnswer === 'proceed' ? Promise.resolve() : Promise.reject(new Error('cancel')),
)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  // The lock a plan without the CRM suite draws on its locked actions.
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: confirmSpy }),
}))
jest.mock('./add-to-list-dialog', () => ({
  __esModule: true,
  default: () => <div data-testid="add-to-list-dialog" />,
}))

const GROUP = soloConsentGroup('host-1')
const unlinked = { companyId: null, companyIds: [], heldElsewhere: [] }
const rows = [
  {
    $id: 'c1',
    email: 'a@example.com',
    name: 'Ada',
    tags: [],
    visibleTo: ['host:host-1'],
    companyLink: unlinked,
  },
  {
    $id: 'c2',
    email: 'b@example.com',
    name: 'Bea',
    tags: ['vip'],
    visibleTo: ['host:host-1', 'host:other'],
    companyLink: unlinked,
  },
  {
    $id: 'c3',
    email: 'c@example.com',
    name: 'Cy',
    tags: [],
    visibleTo: ['host:host-1'],
    // Already at Globex: setting Acme MOVES Cy.
    companyLink: { companyId: 'c-globex', companyIds: ['c-globex'], heldElsewhere: [] },
  },
]

function Harness(props: { initial: string[]; children?: ReactNode }) {
  return (
    <ContactsBulkBar
      hostId="host-1"
      scope={['orgs', 'org-1']}
      consentGroup={GROUP}
      rows={rows}
      selected={props.initial}
      onSelectedChange={onSelectedChange}
    />
  )
}
const onSelectedChange = jest.fn()

/**
 * The same bar beneath the organization hub (AGL-2630): no viewing site, so
 * each row is written through the holder it was flattened by, and moved on
 * that holder's site.
 */
const heldRows = rows.map((row) => ({
  ...row,
  groupId: GROUP.groupId,
  holderHostId: 'host-1',
}))
function OrgHarness(props: { initial: string[] }) {
  return (
    <CrmOrgMountProvider
      mount={{
        orgId: 'org-1',
        hosts: [{ id: 'host-1', name: 'Site 1', subdomain: 'one' }],
        hostsReady: true,
        hostsPath: '/acme/hosts',
      }}
    >
      <ContactsBulkBar
        hostId={null}
        scope={['orgs', 'org-1']}
        consentGroup={null}
        rows={heldRows}
        selected={props.initial}
        onSelectedChange={onSelectedChange}
      />
    </CrmOrgMountProvider>
  )
}

/** What the bar sent to the profile route, request by request. */
const updates = () =>
  posted.filter((call) => call.route === 'contact-update').map((call) => call.payload)

beforeEach(() => {
  ops = []
  notices = []
  posted = []
  refuseRoute = new Set()
  refuseStage = new Set()
  stageCalls.mockClear()
  confirmAnswer = 'proceed'
  confirmSpy.mockClear()
  onSelectedChange.mockClear()
})

describe('the bar and its selection', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = render(<Harness initial={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('says how many are selected and offers every action', () => {
    render(<Harness initial={['c1', 'c2']} />)
    expect(screen.getByText('2 selected')).toBeTruthy()
    for (const label of [
      'Add tag',
      'Remove tag',
      'Set owner',
      'Set stage',
      'Set company',
      'Add to list',
      'Export CSV',
      'Remove from this site',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })
})

/**
 * On a plan without the CRM suite (AGL-2788) a selection's owner, stage and
 * company are the suite's and stand locked; tagging, the exports, the
 * audience door and removing people from the site are not, and stay.
 */
describe('on a plan without the CRM suite', () => {
  it('locks the owner, the stage and the company, and keeps the rest', () => {
    render(
      <ContactsBulkBar
        hostId="host-1"
        scope={['orgs', 'org-1']}
        consentGroup={GROUP}
        rows={rows}
        selected={['c1', 'c2']}
        onSelectedChange={onSelectedChange}
        suiteLocked
      />,
    )
    for (const locked of ['Set owner', 'Set stage', 'Set company']) {
      const control = screen.getByRole('button', { name: locked }) as HTMLButtonElement
      expect([locked, control.disabled]).toEqual([locked, true])
    }
    for (const open of ['Add tag', 'Remove tag', 'Export CSV', 'Remove from this site']) {
      const control = screen.getByRole('button', { name: open }) as HTMLButtonElement
      expect([open, control.disabled]).toEqual([open, false])
    }
    expect(screen.getByRole('button', { name: 'Add to list' })).toBeTruthy()
    // A locked act opens nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ops).toEqual([])
    expect(posted).toEqual([])
  })
})

/**
 * Filing the selection under a company (AGL-2613): one request for the
 * selection, and the server plans each row's link, mirror and count.
 */
describe('setting the company', () => {
  it('files the selection under the picked company in one request, writing nothing client-direct', async () => {
    render(<Harness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set company' }))
    // Focused before typing, as a person's input is: the picker resets an
    // unfocused input to the selection's label.
    fireEvent.focus(screen.getByRole('combobox', { name: 'Company' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), {
      target: { value: 'acme' },
    })
    fireEvent.click(await screen.findByText('Acme · acme.com'))
    expect(screen.queryByText('Globex')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(notices).toContain('Company set on 2 contacts'))
    expect(updates()).toEqual([{ contactIds: ['c1', 'c3'], set: { companyId: 'c-acme' } }])
    expect(ops).toEqual([])
  })

  it('unlinks the selection when the picker is left empty, leaving alone a row with no company', async () => {
    render(<Harness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set company' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(notices.length).toBeGreaterThan(0))
    expect(updates()).toEqual([{ contactIds: ['c3'], set: { companyId: null } }])
    expect(ops).toEqual([])
  })
})

describe('tagging the selection', () => {
  it('adds the tag to every selected row in one request', async () => {
    render(<Harness initial={['c1', 'c2']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: ' Wholesale ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toContain('Tagged 2 contacts'))
    expect(updates()).toEqual([{ contactIds: ['c1', 'c2'], set: { addTag: 'wholesale' } }])
    expect(ops).toEqual([])
  })

  it('removes a tag only from the rows that carry it', async () => {
    render(<Harness initial={['c1', 'c2']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag' }))
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'vip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices.length).toBeGreaterThan(0))
    expect(updates()).toEqual([{ contactIds: ['c2'], set: { removeTag: 'vip' } }])
    expect(ops).toEqual([])
  })
})

describe('setting the stage and the owner', () => {
  it('moves each row through crm/contact-stage, one at a time, so every move is announced', async () => {
    render(<Harness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Customer'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toContain('Stage set on 2 contacts'))
    expect(stageCalls.mock.calls).toEqual([
      [expect.objectContaining({ uid: 'uid-me' }), 'host-1', 'c1', 'customer'],
      [expect.objectContaining({ uid: 'uid-me' }), 'host-1', 'c3', 'customer'],
    ])
    expect(updates()).toEqual([])
    expect(ops).toEqual([])
  })

  it('offers the team as owners and sends the chosen uid in one request', async () => {
    render(<Harness initial={['c1']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set owner' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Owner' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Ada Lovelace'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toContain('Owner set on 1 contact'))
    expect(updates()).toEqual([{ contactIds: ['c1'], set: { ownerUid: 'uid-a' } }])
    expect(ops).toEqual([])
  })
})

describe('a refused row', () => {
  it('names the row the route refused by address, and the rest are saved', async () => {
    refuseRoute = new Set(['c3'])
    render(<Harness initial={['c1', 'c2', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    // c2 already carries `vip`, so the request names c1 and c3; c3 is refused.
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'vip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText(/c@example\.com — not permitted/)).toBeTruthy()
    expect(updates()).toEqual([{ contactIds: ['c1', 'c3'], set: { addTag: 'vip' } }])
    expect(notices).toContain('Tagged 1 contact')
  })

  it("names a stage move the route refused, in the route's own sentence", async () => {
    refuseStage = new Set(['c3'])
    render(<Harness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Lead'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(
      await screen.findByText(/c@example\.com — Not a site admin or editor/),
    ).toBeTruthy()
    expect(screen.getByText('One contact was not changed:')).toBeTruthy()
    expect(notices).toContain('Stage set on 1 contact')
  })
})

describe('removing the selection from this site', () => {
  it('deletes a row this site alone holds and detaches from a shared one, after the confirm', async () => {
    render(<Harness initial={['c1', 'c2']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from this site' }))
    await waitFor(() => expect(ops).toHaveLength(2))
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove 2 contacts?',
        confirmationText: 'Remove contacts',
      }),
    )
    expect(ops[0]).toMatchObject({ kind: 'delete', path: 'orgs/org-1/contacts/c1' })
    expect(ops[1]).toMatchObject({ kind: 'update', path: 'orgs/org-1/contacts/c2' })
    // Letting a holder go is the one facet change left to the client.
    expect(ops[1].data[`facets.${GROUP.groupId}`]).toEqual({ op: 'delete' })
    expect(ops[1].data.visibleTo).toEqual({ op: 'remove', values: ['host:host-1'] })
    // The rows are gone from the table, so the selection lets go of them.
    expect(onSelectedChange).toHaveBeenLastCalledWith([])
    expect(notices).toContain('2 contacts removed from this site')
    expect(updates()).toEqual([])
  })

  it('writes nothing when the confirm is cancelled', async () => {
    confirmAnswer = 'cancel'
    render(<Harness initial={['c1']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from this site' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ops).toEqual([])
    expect(onSelectedChange).not.toHaveBeenCalled()
  })
})

describe('the audience door', () => {
  it('opens the shared add-to-list dialog for the selection', () => {
    render(<Harness initial={['c1', 'c2']} />)
    expect(screen.queryByTestId('add-to-list-dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }))
    expect(screen.getByTestId('add-to-list-dialog')).toBeTruthy()
  })
})

describe('beneath the organization hub', () => {
  it("moves each row on its own holder's site, then posts the sentence once as the org feed's contact line", async () => {
    render(<OrgHarness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Customer'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(stageCalls).toHaveBeenCalledTimes(2))
    expect(stageCalls.mock.calls.map((call) => [call[1], call[2], call[3]])).toEqual([
      ['host-1', 'c1', 'customer'],
      ['host-1', 'c3', 'customer'],
    ])
    await waitFor(() =>
      expect(posted.filter((call) => call.route === 'org-activity')).toEqual([
        {
          route: 'org-activity',
          payload: { action: 'Stage set on 2 contacts', target: { type: 'contact' } },
        },
      ]),
    )
  })

  it('posts no org line under a site, where the bar writes into the site feed itself', async () => {
    render(<Harness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Customer'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toContain('Stage set on 2 contacts'))
    expect(posted.filter((call) => call.route === 'org-activity')).toEqual([])
  })
})
