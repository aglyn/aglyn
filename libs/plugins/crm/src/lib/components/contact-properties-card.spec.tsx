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
 * THE PROPERTIES CARD'S ONE SAVE (AGL-2610).
 *
 * What it must hold: a stage MOVE is left out of the facet write and sent to
 * `crm/contact-stage`, the one path that announces `contactStageChanged`; a
 * save that does not move the stage never calls the route; a cleared stage
 * stays a client-direct `deleteField`; and a route refusal is reported as
 * its own sentence after the fields that did save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { soloConsentGroup } from '@aglyn/aglyn'
import type { ContactRecord } from '../model/contact-record'
import { ContactPropertiesCard } from './contact-properties-card'

/** Every facet write the store received, in order. */
let writes: Array<{ path: string; data: Record<string, unknown> }>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => ({ op: 'delete' }),
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    writes.push({ path: ref.path, data })
  },
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
 * holds nothing, so the card's write is the only Firestore traffic.
 */
jest.mock('./company-picker', () => ({
  CompanyPicker: () => null,
  useCompanyOptions: () => ({ options: [], ready: true, truncated: false }),
  useCreateCompany: () => null,
}))

/** Every call the card made to the stage route, and what it should answer. */
const setContactStage = jest.fn()
jest.mock('../model/crm-api', () => ({
  setContactStage: (...args: unknown[]) => setContactStage(...args),
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
// Dotted, as the document path is; handed to `toHaveProperty` as a one-element
// array so the matcher reads it as one key rather than as a path of three.
const facetPath = (field: string) => `facets.${GROUP.groupId}.${field}`

const record: ContactRecord = {
  $id: 'c1',
  email: 'maya@littlefoxcafe.com',
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

function renderCard(seeded: Partial<ContactRecord> = {}) {
  return render(
    <ContactPropertiesCard
      hostId="host-1"
      record={{ ...record, ...seeded }}
      consentGroup={GROUP}
      scope={['orgs', 'org-1']}
      seed={{ status: 'success', fromCache: false }}
      members={{ options: [], ready: true, memberName: (uid) => uid }}
    />,
  )
}

const pickStage = (label: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
  fireEvent.click(screen.getByRole('option', { name: label }))
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

beforeEach(() => {
  writes = []
  notices = []
  setContactStage.mockReset()
  setContactStage.mockResolvedValue({
    ok: true,
    changed: true,
    lifecycleStage: 'customer',
    previousStage: 'lead',
  })
})

describe('a stage move', () => {
  it('goes through crm/contact-stage and stays out of the facet write', async () => {
    renderCard()
    pickStage('Customer')
    save()
    await waitFor(() => expect(setContactStage).toHaveBeenCalledTimes(1))
    expect(setContactStage).toHaveBeenCalledWith(USER, 'host-1', 'c1', 'customer')
    expect(writes).toHaveLength(1)
    // The route reads the stage the facet still holds to name `previousStage`
    // — a write that carried the new one first would leave it announcing
    // nothing.
    expect(writes[0].data).not.toHaveProperty([facetPath('lifecycleStage')])
    expect(writes[0].data).toHaveProperty([facetPath('jobTitle')], 'Owner')
    await waitFor(() =>
      expect(notices).toContainEqual({ message: 'Contact saved', variant: 'success' }),
    )
  })

  it('is written after the profile, so a refused move leaves the profile saved', async () => {
    setContactStage.mockRejectedValue(new Error('Not a site admin or editor'))
    renderCard()
    fireEvent.change(screen.getByLabelText('Job title'), {
      target: { value: 'Head roaster' },
    })
    pickStage('Customer')
    save()
    await waitFor(() => expect(setContactStage).toHaveBeenCalledTimes(1))
    expect(writes[0].data).toHaveProperty([facetPath('jobTitle')], 'Head roaster')
    await waitFor(() =>
      expect(notices).toContainEqual({
        message: 'Saved, but the stage could not be changed: Not a site admin or editor',
        variant: 'warning',
      }),
    )
    expect(notices.map((notice) => notice.message)).not.toContain('Contact saved')
  })
})

describe('a save that moves nothing', () => {
  it('never calls the route, and keeps the stage it has in the write', async () => {
    renderCard()
    fireEvent.change(screen.getByLabelText('Job title'), {
      target: { value: 'Head roaster' },
    })
    save()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(setContactStage).not.toHaveBeenCalled()
    expect(writes[0].data).toHaveProperty([facetPath('lifecycleStage')], 'lead')
  })

  it('clears a stage client-direct — there is no event for "no stage"', async () => {
    renderCard()
    pickStage('Not placed yet')
    save()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(setContactStage).not.toHaveBeenCalled()
    expect(writes[0].data).toHaveProperty([facetPath('lifecycleStage')], { op: 'delete' })
  })
})
