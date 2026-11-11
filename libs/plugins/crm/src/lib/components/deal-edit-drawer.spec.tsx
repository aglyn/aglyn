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
 * THE EDIT DEAL DRAWER SHOWS WHAT THE DEAL HOLDS AND WRITES WHAT THE READER
 * CHANGED (AGL-4132).
 *
 * Measured in production on v1.4.0 before this: Contact and Company stayed
 * blank on a deal that had both; erasing a letter typed into that blank field
 * took the link off on the next save; a snapshot while the drawer was open
 * replaced what had been typed; and with the lease-holding tab starved, Save
 * waited 12 s and refused, or held the drawer for 25 s on the write.
 *
 * The real Autocomplete and the real seed guard run here, because each of those
 * came from how the drawer used them.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { DealDoc, PipelineDoc } from '../model/deal-board-model'
import { DealEditDrawer } from './deal-edit-drawer'

const mockDeleteField = { isEqual: () => false, sentinel: 'delete' }

jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => mockDeleteField,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  endAt: () => ({}),
  getDocs: jest.fn(async () => ({
    docs: [{ id: 'co2', get: () => 'Babbage & Co' }],
  })),
  limit: () => ({}),
  orderBy: () => ({}),
  query: (...args: unknown[]) => ({ args }),
  startAt: () => ({}),
  updateDoc: jest.fn(),
  where: () => ({}),
}))

let mockContactRows: Array<Record<string, unknown>>
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: mockContactRows }),
  useUser: () => ({ data: { uid: 'uid-me' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

let mockNotices: Array<{ message: string; variant?: string }>
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown, options?: { variant?: string }) =>
      void mockNotices.push({ message: String(message), variant: options?.variant }),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  Container: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: unknown }) => <span>{children as never}</span>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: ({ open, children }: { open: boolean; children: unknown }) =>
    open ? <div>{children as never}</div> : null,
}))

jest.mock('../hooks/use-crm-scope', () => ({
  crmScopeListable: () => true,
  crmVisibleToClause: () => [],
  useCrmScope: () => ({
    orgId: 'org-1',
    consentGroup: null,
    visibleTo: ['org'],
    createHostId: '',
    createTokens: ['org'],
    createNeedsSite: false,
  }),
}))
jest.mock('../hooks/use-crm-picklist', () => {
  const { effectiveCrmPicklist } = jest.requireActual('@aglyn/aglyn/app-utils/crm')
  return {
    useCrmPicklist: (id: string) => ({
      picklist: effectiveCrmPicklist(id, null),
      stored: false,
      ready: true,
      fromCache: false,
    }),
  }
})
jest.mock('../hooks/use-contact-field-definitions', () => ({
  useContactFieldDefinitions: () => ({ active: [] }),
}))
jest.mock('../hooks/use-crm-activity-logger', () => ({
  useCrmActivityLogger: () => () => undefined,
}))
jest.mock('../hooks/use-crm-campaigns', () => ({
  useCrmCampaigns: () => ({ options: [], ready: true }),
}))
jest.mock('../hooks/use-crm-records-quota', () => ({
  useCrmRecordsQuota: () => ({ ready: true, quota: { allowed: true } }),
}))
jest.mock('../hooks/use-org-member-directory', () => ({
  useOrgMemberDirectory: () => ({ members: [], loading: false }),
}))
let mockFollowUps: string[][]
jest.mock('../hooks/use-crm-sharing', () => ({
  useCrmSharingFollowUp: () => (_object: string, ids: string[]) => void mockFollowUps.push(ids),
}))
/** The records' own names, for a deal that carries none. */
let mockRecordNames: Record<string, string>
jest.mock('../hooks/use-crm-record-names', () => ({
  useCrmRecordNames: () => (kind: string, id: string) => mockRecordNames[`${kind}:${id}`],
}))

jest.mock('./crm-custom-field-control', () => ({ CrmCustomFieldControl: () => null }))
jest.mock('./crm-site-picker', () => ({ CrmSitePicker: () => null }))
jest.mock('./picklist-select', () => ({ CrmPicklistSelect: () => null }))

const PIPELINE = {
  $id: 'default',
  name: 'Sales',
  stages: [{ id: 'prospecting', name: 'Prospecting', kind: 'open', probability: 10 }],
} as unknown as PipelineDoc

const DEAL = {
  $id: 'deal-1',
  title: 'Roaster',
  pipelineId: 'default',
  stageId: 'prospecting',
  status: 'open',
  currency: 'usd',
  amountCents: 5000,
  contactId: 'c1',
  contactName: 'Ada Lovelace',
  companyId: 'co1',
  companyName: 'Analytical Engines',
  contactRoles: [{ contactId: 'c1', primary: true }],
  visibleTo: ['org'],
  hostId: 'site-a',
} as unknown as DealDoc

const NEW_CONTACT = { $id: 'c2', name: 'Grace Hopper', email: 'grace@example.com' }

interface Seed {
  deal?: DealDoc
  fromCache?: boolean
  unreadable?: boolean
}

function drawerFor({ deal = DEAL, fromCache = false, unreadable = false }: Seed, onClose: () => void) {
  return (
    <DealEditDrawer
      open
      onClose={onClose}
      hostId={null}
      org={{} as never}
      deal={deal}
      pipelines={[PIPELINE]}
      defaultPipeline={PIPELINE}
      fromCache={fromCache}
      unreadable={unreadable}
    />
  )
}

function openDrawer(seed: Seed = {}) {
  const onClose = jest.fn()
  const view = render(drawerFor(seed, onClose))
  return {
    onClose,
    snapshot: (next: Seed) => view.rerender(drawerFor(next, onClose)),
  }
}

// A text box by its label; an open picker's list carries the same label.
const field = (label: string) =>
  screen.getByRole(label === 'Contact' || label === 'Company' ? 'combobox' : 'textbox', {
    name: label,
  }) as HTMLInputElement
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } })
/** Types in a picker, which a person can only do with the picker focused. */
const search = (label: string, value: string) => {
  act(() => field(label).focus())
  type(label, value)
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save deal' }))

/** The one payload the drawer wrote to the deal. */
function written(): Record<string, unknown> {
  expect(updateDoc).toHaveBeenCalledTimes(1)
  return jest.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>
}

beforeEach(() => {
  mockContactRows = [{ $id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com' }, NEW_CONTACT]
  mockNotices = []
  mockFollowUps = []
  mockRecordNames = {}
  jest.mocked(updateDoc).mockReset().mockResolvedValue(undefined)
})

describe('the deal’s links show in the drawer', () => {
  it('shows the contact and the company the moment it opens', () => {
    openDrawer()
    expect(field('Contact').value).toBe('Ada Lovelace')
    expect(field('Company').value).toBe('Analytical Engines')
  })

  it('names a link the deal carries no name for, from its record', () => {
    mockRecordNames = { 'contact:c1': 'Ada from the record', 'company:co1': 'Engines from the record' }
    openDrawer({ deal: { ...DEAL, contactName: undefined, companyName: undefined } as DealDoc })
    expect(field('Contact').value).toBe('Ada from the record')
    expect(field('Company').value).toBe('Engines from the record')
  })

  it('never shows a link blank, even when its record cannot be read', () => {
    openDrawer({ deal: { ...DEAL, contactName: undefined, companyName: undefined } as DealDoc })
    expect(field('Contact').value).toBe('Linked contact')
    expect(field('Company').value).toBe('Linked company')
  })

  it('shows nothing for a deal with no links', () => {
    openDrawer({
      deal: { ...DEAL, contactId: undefined, contactName: undefined, companyId: undefined, companyName: undefined } as DealDoc,
    })
    expect(field('Contact').value).toBe('')
    expect(field('Company').value).toBe('')
  })

  it('leaves what is typed alone, and searches that and not the name it showed', () => {
    openDrawer()
    act(() => field('Contact').focus())
    fireEvent.mouseDown(field('Contact'))
    expect(screen.getAllByRole('option')).toHaveLength(2)

    type('Contact', 'gra')
    expect(field('Contact').value).toBe('gra')
    const [only, ...rest] = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(only.textContent).toMatch(/Grace Hopper/)
    expect(rest).toEqual([])
  })

  it('shows the contact picked in place of the linked one', () => {
    openDrawer()
    search('Contact', 'gra')
    fireEvent.click(screen.getByRole('option', { name: /Grace Hopper/ }))
    expect(field('Contact').value).toBe('Grace Hopper')
  })
})

describe('what is typed survives a snapshot', () => {
  it('keeps it through a confirmation of the same deal, which is a new object', () => {
    const { snapshot } = openDrawer({ fromCache: true })
    type('Next step', 'Send the proposal')

    snapshot({ deal: { ...DEAL }, fromCache: false })
    expect(field('Next step').value).toBe('Send the proposal')

    // And back: a client taken off the network flips the same row to cached.
    snapshot({ deal: { ...DEAL }, fromCache: true })
    expect(field('Next step').value).toBe('Send the proposal')
  })

  it('follows a stored change in a field nobody touched', () => {
    const { snapshot } = openDrawer()
    type('Next step', 'Send the proposal')

    snapshot({ deal: { ...DEAL, notes: 'Added from another tab' } as DealDoc })
    expect(field('Next step').value).toBe('Send the proposal')
    expect(field('Notes').value).toBe('Added from another tab')
  })

  it('writes only the typed field when the stored deal moved underneath it', async () => {
    const { snapshot, onClose } = openDrawer()
    type('Next step', 'Send the proposal')
    snapshot({ deal: { ...DEAL, notes: 'Added from another tab' } as DealDoc })

    save()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(written()).toEqual({ nextStep: 'Send the proposal', updatedAt: expect.any(Date) })
  })
})

describe('a save writes what the reader changed', () => {
  it('writes one changed field as one field, with the links untouched', async () => {
    const { onClose } = openDrawer()
    type('Next step', 'Send the proposal')
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(written()).toEqual({ nextStep: 'Send the proposal', updatedAt: expect.any(Date) })
    expect(mockNotices).toEqual([{ message: 'Deal saved', variant: 'success' }])
    expect(mockFollowUps).toEqual([['deal-1']])
  })

  it('saves at once on a read the server has not confirmed', async () => {
    const { onClose } = openDrawer({ fromCache: true })
    type('Next step', 'Send the proposal')
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(written()).toEqual({ nextStep: 'Send the proposal', updatedAt: expect.any(Date) })
  })

  it('cannot take a link off a deal when an old read does not hold it', async () => {
    // The read behind the form predates both links, and the server has them.
    const stale = {
      ...DEAL,
      contactId: undefined,
      contactName: undefined,
      companyId: undefined,
      companyName: undefined,
      contactRoles: undefined,
    } as unknown as DealDoc
    const { onClose } = openDrawer({ deal: stale, fromCache: true })
    type('Next step', 'Send the proposal')
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const payload = written()
    expect(Object.keys(payload).sort()).toEqual(['nextStep', 'updatedAt'])
    expect(Object.values(payload)).not.toContain(mockDeleteField)
  })

  it('restamps the list fields of a changed title and no others', async () => {
    const { onClose } = openDrawer()
    type('Title', 'Espresso roaster')
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const payload = written()
    expect(payload).toMatchObject({ title: 'Espresso roaster', titleLower: 'espresso roaster' })
    expect(payload).toHaveProperty('searchTokens')
    expect(payload).not.toHaveProperty('contactRoleContactIds')
    expect(payload).not.toHaveProperty('amountSortCents')
  })

  it('writes nothing when nothing changed, and closes', async () => {
    const { onClose } = openDrawer()
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    expect(mockNotices).toEqual([{ message: 'Deal saved', variant: 'success' }])
  })

  it('takes a link off only when the reader clears it where they can see it', async () => {
    const { onClose } = openDrawer()
    search('Company', '')
    expect(field('Company').value).toBe('')
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(written()).toEqual({
      companyId: mockDeleteField,
      companyName: mockDeleteField,
      updatedAt: expect.any(Date),
    })
  })

  it('moves the Primary with a contact the reader picks', async () => {
    const { onClose } = openDrawer()
    search('Contact', 'gra')
    fireEvent.click(screen.getByRole('option', { name: /Grace Hopper/ }))
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(written()).toMatchObject({
      contactId: 'c2',
      contactName: 'Grace Hopper',
      contactRoleContactIds: ['c2', 'c1'],
    })
  })
})

describe('what still waits for a confirmed read', () => {
  /**
   * The first press is never refused for a late server (AGL-4047): an edit
   * worked out from the read holds Save, with the reason beside it, rather
   * than pressing into a wait that ends refused, and what was picked stays.
   */
  it('holds Save on a contact change over an unconfirmed read, keeping what was picked', async () => {
    const { onClose, snapshot } = openDrawer({ fromCache: true })
    search('Contact', 'gra')
    fireEvent.click(screen.getByRole('option', { name: /Grace Hopper/ }))
    expect(
      (screen.getByRole('button', { name: 'Save deal' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Checking your deal with the server…')
    save()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockNotices).toEqual([])
    expect(updateDoc).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(field('Contact').value).toBe('Grace Hopper')

    // The server answers; the first press saves.
    snapshot({ fromCache: false })
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(written()).toMatchObject({ contactId: 'c2' })
  })

  it('holds Save on an amount change over an unconfirmed read', async () => {
    openDrawer({ fromCache: true })
    type('Amount', '75.00')
    expect(
      (screen.getByRole('button', { name: 'Save deal' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    save()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockNotices).toEqual([])
    expect(updateDoc).not.toHaveBeenCalled()
    expect(field('Amount').value).toBe('75.00')
  })

  it('still refuses any save on a read that failed', async () => {
    openDrawer({ unreadable: true })
    type('Next step', 'Send the proposal')
    save()

    await waitFor(() => expect(mockNotices.map((notice) => notice.message)).toEqual([
      expect.stringMatching(/could not be loaded/),
    ]))
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe('a write the lease holder is slow to answer (AGL-3806)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  /** Runs a save whose write answers only when the spec says so. */
  function saveHeld() {
    let settle: { resolve: () => void; reject: (error: Error) => void } | undefined
    jest.mocked(updateDoc).mockReturnValue(
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject }
      }),
    )
    const { onClose } = openDrawer()
    type('Next step', 'Send the proposal')
    save()
    return { onClose, settle: settle as NonNullable<typeof settle> }
  }

  const passTheHold = () => act(() => jest.advanceTimersByTimeAsync(4_000))

  it('lets the drawer go after the hold, and follows up once the write lands', async () => {
    const { onClose, settle } = saveHeld()
    await act(() => jest.advanceTimersByTimeAsync(3_999))
    expect(onClose).not.toHaveBeenCalled()

    await passTheHold()
    expect(onClose).toHaveBeenCalled()
    expect(mockNotices).toEqual([{ message: 'Deal saved', variant: 'success' }])
    expect(mockFollowUps).toEqual([])

    await act(async () => settle.resolve())
    expect(mockFollowUps).toEqual([['deal-1']])
  })

  it('says so when the write fails after the drawer has gone', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onClose, settle } = saveHeld()
    await passTheHold()
    expect(onClose).toHaveBeenCalled()

    await act(async () => settle.reject(new Error('permission-denied')))
    expect(mockNotices).toEqual([
      { message: 'Deal saved', variant: 'success' },
      { message: expect.stringMatching(/could not be saved/), variant: 'error' },
    ])
    expect(mockFollowUps).toEqual([])
    quiet.mockRestore()
  })

  it('keeps the drawer open when the write fails inside the hold', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { onClose, settle } = saveHeld()

    await act(async () => settle.reject(new Error('permission-denied')))
    expect(onClose).not.toHaveBeenCalled()
    expect(mockNotices).toEqual([{ message: 'An error has occurred', variant: 'error' }])
    expect(field('Next step').value).toBe('Send the proposal')
    quiet.mockRestore()
  })
})
