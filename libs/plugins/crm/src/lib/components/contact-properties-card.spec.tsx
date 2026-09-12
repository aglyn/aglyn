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
 * THE PROPERTIES CARD'S ONE SAVE (AGL-2610, AGL-2804).
 *
 * What it must hold: the profile goes to `crm/contact-update` — a facet is
 * the server's to write, so nothing is written client-direct; a stage MOVE or
 * CLEAR goes to `crm/contact-stage` once the profile has landed, and a save
 * that leaves the stage alone never calls it; a refused stage is reported in
 * the route's own sentence after the fields that did save; and on a plan
 * without the CRM suite the owner, the stage and the company are not sent.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { soloConsentGroup } from '@aglyn/aglyn'
import type { ContactRecord } from '../model/contact-record'
import { ContactPropertiesCard } from './contact-properties-card'

/** Every client-direct write the store received — a save must leave this empty. */
let writes: Array<{ path: string; data: Record<string, unknown> }>
/** The order the two routes were reached in. */
let order: string[]

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => ({ op: 'delete' }),
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    writes.push({ path: ref.path, data })
  },
  writeBatch: () => ({
    update: (ref: { path: string }, data: Record<string, unknown>) =>
      void writes.push({ path: ref.path, data }),
    commit: async () => undefined,
  }),
}))

const FIRESTORE = {}
const USER = { uid: 'uid-1', getIdToken: async () => 'token' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: USER }),
  useHostActivityLogger: () => jest.fn(),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

/*
 * The Company field is the picker's, and the picker keeps a listen on the
 * companies collection with a spec of its own; here it is a field that
 * holds nothing, so the card's save is the only traffic.
 */
jest.mock('./company-picker', () => ({
  CompanyPicker: () => null,
  useCompanyOptions: () => ({ options: [], ready: true, truncated: false }),
  useCreateCompany: () => null,
}))

/** Every call the card made to the stage route, and what it should answer. */
const setContactStage = jest.fn()
jest.mock('../model/crm-api', () => ({
  setContactStage: (...args: unknown[]) => {
    order.push('stage')
    return setContactStage(...args)
  },
}))

/** Every post to a CRM route, as the card's API hook sent it. */
let posted: Array<{ route: string; payload: Record<string, any> }>
/** The sentence the profile route refuses the next save with, or `null`. */
let refuseSave: string | null
jest.mock('./use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, any>) => {
    posted.push({ route, payload })
    if (route === 'contact-update') order.push('profile')
    if (refuseSave) {
      return { response: { ok: false, status: 403 }, payload: { error: refuseSave } }
    }
    return {
      response: { ok: true, status: 200 },
      payload: {
        ok: true,
        results: (payload['contactIds'] ?? []).map((contactId: string) => ({
          contactId,
          ok: true,
        })),
      },
    }
  },
}))

let notices: Array<{ message: string; variant?: string }>
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: string, options?: { variant?: string }) =>
      notices.push({ message, variant: options?.variant }),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
}))

const GROUP = soloConsentGroup('host-1')

const record: ContactRecord = {
  $id: 'c1',
  email: 'maya@littlefoxcafe.com',
  alternateEmails: [],
  name: 'Maya Delgado',
  canonicalName: 'Maya Delgado',
  nameOverride: '',
  sources: { form: true },
  interactions: [],
  tags: ['wholesale'],
  notes: '',
  campaignIds: [],
  ltvCents: 0,
  ordersCount: 0,
  phone: '',
  jobTitle: 'Owner',
  companyName: '',
  companyId: '',
  companyLink: { companyId: null, companyIds: [], heldElsewhere: [] },
  address: null,
  custom: {},
  ownerUid: '',
  lifecycleStage: 'lead',
  updatedAt: undefined,
} as unknown as ContactRecord

const members = {
  options: [],
  ready: true,
  memberName: (uid: string) => uid,
  memberEmail: (uid: string) => uid,
}

function renderCard(seeded: Partial<ContactRecord> = {}, suiteLocked = false) {
  return render(
    <ContactPropertiesCard
      hostId="host-1"
      record={{ ...record, ...seeded }}
      consentGroup={GROUP}
      seed={{ status: 'success', fromCache: false }}
      members={members}
      suiteLocked={suiteLocked}
    />,
  )
}

const pickStage = (label: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
  fireEvent.click(screen.getByRole('option', { name: label }))
}
const typeJobTitle = (value: string) =>
  fireEvent.change(screen.getByLabelText('Job title'), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const profileSaves = () => posted.filter((call) => call.route === 'contact-update')

beforeEach(() => {
  writes = []
  order = []
  notices = []
  posted = []
  refuseSave = null
  setContactStage.mockReset()
  setContactStage.mockResolvedValue({
    ok: true,
    changed: true,
    lifecycleStage: 'customer',
    previousStage: 'lead',
  })
})

describe('the profile', () => {
  it('is saved through crm/contact-update, with nothing written client-direct', async () => {
    renderCard()
    typeJobTitle('Head roaster')
    save()
    await waitFor(() =>
      expect(notices).toContainEqual({ message: 'Contact saved', variant: 'success' }),
    )
    expect(writes).toEqual([])
    expect(profileSaves()).toHaveLength(1)
    const { payload } = profileSaves()[0]
    expect(payload['contactIds']).toEqual(['c1'])
    expect(payload['set']).toMatchObject({
      name: '',
      phone: '',
      jobTitle: 'Head roaster',
      tags: ['wholesale'],
      notes: '',
      ownerUid: '',
      companyId: null,
      companyName: '',
    })
    // The stage is the stage route's to write, never the profile route's.
    expect(payload['set']).not.toHaveProperty('lifecycleStage')
    expect(setContactStage).not.toHaveBeenCalled()
  })

  it("shows the route's own sentence when the save is refused, and keeps what was typed", async () => {
    refuseSave = 'Your organization role does not allow editing the CRM.'
    renderCard()
    typeJobTitle('Head roaster')
    save()
    await waitFor(() =>
      expect(notices.map((notice) => notice.message)).toContain(
        'Your organization role does not allow editing the CRM.',
      ),
    )
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe('Head roaster')
    expect(notices.map((notice) => notice.message)).not.toContain('Contact saved')
    expect(setContactStage).not.toHaveBeenCalled()
  })
})

describe('a stage move', () => {
  it('goes through crm/contact-stage once the profile has landed', async () => {
    renderCard()
    pickStage('Customer')
    save()
    await waitFor(() => expect(setContactStage).toHaveBeenCalledTimes(1))
    expect(setContactStage).toHaveBeenCalledWith(USER, 'host-1', 'c1', 'customer')
    expect(order).toEqual(['profile', 'stage'])
    expect(profileSaves()[0].payload['set']).not.toHaveProperty('lifecycleStage')
    expect(writes).toEqual([])
    await waitFor(() =>
      expect(notices).toContainEqual({ message: 'Contact saved', variant: 'success' }),
    )
  })

  it('reports a refused move on its own, after the profile it did not undo', async () => {
    setContactStage.mockRejectedValue(new Error('Not a site admin or editor'))
    renderCard()
    typeJobTitle('Head roaster')
    pickStage('Customer')
    save()
    await waitFor(() => expect(setContactStage).toHaveBeenCalledTimes(1))
    expect(profileSaves()[0].payload['set']).toMatchObject({ jobTitle: 'Head roaster' })
    await waitFor(() =>
      expect(notices).toContainEqual({
        message: 'Saved, but the stage could not be changed: Not a site admin or editor',
        variant: 'warning',
      }),
    )
    expect(notices.map((notice) => notice.message)).not.toContain('Contact saved')
  })
})

describe('a cleared stage', () => {
  it('goes through crm/contact-stage as a null — the facet is not the browser’s to write', async () => {
    renderCard()
    pickStage('Not placed yet')
    save()
    await waitFor(() => expect(setContactStage).toHaveBeenCalledTimes(1))
    expect(setContactStage).toHaveBeenCalledWith(USER, 'host-1', 'c1', null)
    expect(order).toEqual(['profile', 'stage'])
    expect(writes).toEqual([])
  })
})

/**
 * On a plan without the CRM suite (AGL-2788) the owner, the stage and the
 * company are the suite's: shown locked, and not sent — while the rest of
 * the profile, the tags and the notes save as on every plan.
 */
describe('on a plan without the CRM suite', () => {
  it('locks the owner and the stage, and says which plan includes them', () => {
    renderCard({ ownerUid: 'uid-7' }, true)
    expect(
      screen.getByRole('combobox', { name: 'Lifecycle stage' }).getAttribute('aria-disabled'),
    ).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Owner' }).getAttribute('aria-disabled')).toBe(
      'true',
    )
    expect(screen.getAllByText('Part of the CRM, included from Starter')).toHaveLength(2)
  })

  it('saves the profile and sends neither the owner, the stage nor the company', async () => {
    renderCard({ ownerUid: 'uid-7' }, true)
    typeJobTitle('Head roaster')
    save()
    await waitFor(() => expect(profileSaves()).toHaveLength(1))
    const set = profileSaves()[0].payload['set']
    expect(set).toMatchObject({ jobTitle: 'Head roaster', tags: ['wholesale'] })
    expect(set).not.toHaveProperty('ownerUid')
    expect(set).not.toHaveProperty('companyId')
    expect(set).not.toHaveProperty('companyName')
    expect(set).not.toHaveProperty('lifecycleStage')
    expect(setContactStage).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})

describe('a save that leaves the stage alone', () => {
  it('never calls the stage route', async () => {
    renderCard()
    typeJobTitle('Head roaster')
    save()
    await waitFor(() => expect(profileSaves()).toHaveLength(1))
    await waitFor(() =>
      expect(notices).toContainEqual({ message: 'Contact saved', variant: 'success' }),
    )
    expect(setContactStage).not.toHaveBeenCalled()
  })
})
