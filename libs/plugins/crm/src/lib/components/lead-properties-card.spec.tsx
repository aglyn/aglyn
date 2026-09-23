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
 * CONVERT IS GATED ON A PENDING ERASURE (AGL-2632).
 *
 * The overflow's items already disable themselves, with the reason as a
 * tooltip, while an erasure request waits on the person; the Convert button
 * beside them did not, and a conversion filed against a pending erasure
 * reaches the capture door only to be refused there. The button has to stay
 * where it is — an absent button and an inapplicable one look alike — say
 * why, and never open the dialog.
 */

import { soloConsentGroup } from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { LeadPropertiesCard } from './lead-properties-card'

const updateDoc = jest.fn(async (..._args: unknown[]) => undefined)
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  updateDoc: (...args: unknown[]) => updateDoc(...(args as [])),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  writeGuardedBySeed: async (_seed: unknown, run: () => Promise<unknown>) => {
    await run()
    return { ok: true }
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))
/*
 * The header is the record's chrome — the trail, the help affordance, the
 * overflow — with a spec of its own; here it is the slot the actions render
 * into. The send-email button and the owner picker each open reads this
 * spec has no interest in.
 */
jest.mock('./crm-record-header', () => ({
  CrmRecordHeader: ({ actions, children }: { actions?: ReactNode; children?: ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  CrmRecordChip: () => null,
}))
jest.mock('./crm-send-email-button', () => ({ CrmSendEmailButton: () => null }))
/*
 * The call button resolves the activity scope this spec's instance double
 * does not carry, and has a spec of its own; the phone link beside it is
 * pure and stays real.
 */
jest.mock('./crm-call-actions', () => ({
  ...jest.requireActual('./crm-call-actions'),
  CrmCallButton: () => null,
}))
jest.mock('./lead-owner-select', () => ({ LeadOwnerSelect: () => null }))
/*
 * The org's lead field definitions (AGL-3272), which the real hook reads
 * off a live Firestore listen. The control under them stays real: what
 * this spec is about is which values Save writes, and a doubled control
 * would prove nothing about that.
 */
const definitionsFor = jest.fn(() => ({
  definitions: [] as unknown[],
  active: [] as unknown[],
  ready: true,
  fromCache: false,
}))
jest.mock('../hooks/use-contact-field-definitions', () => ({
  useContactFieldDefinitions: (...args: unknown[]) => definitionsFor(...(args as [])),
}))

const PENDING_REASON = 'An erasure is pending for this person'

/** A lead as the capture left it: open, unowned, never converted. */
const lead = {
  email: 'jane@example.com',
  name: 'Jane Doe',
  sources: ['form'],
  submissionCount: 1,
  lastSeenAtMs: 1_000,
}

function renderCard(props: Partial<ComponentProps<typeof LeadPropertiesCard>> = {}) {
  const onConvert = jest.fn()
  render(
    <LeadPropertiesCard
      hostId="host-1"
      consentGroup={soloConsentGroup('host-1')}
      orgId="org-1"
      leadId="lead-1"
      lead={lead}
      leadStatus="success"
      fromCache={false}
      basePath="/acme/hosts/site/crm"
      roster={{
        options: [],
        labelFor: (ref) => String(ref ?? ''),
        emailFor: (ref) => String(ref ?? ''),
        ready: true,
        loading: false,
        error: null,
      }}
      onConvert={onConvert}
      onUnqualify={() => undefined}
      {...props}
    />,
  )
  return { onConvert }
}

const convert = () => screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement

describe('Convert on the lead page', () => {
  it('opens the dialog on an open lead', () => {
    const { onConvert } = renderCard()
    expect(convert().disabled).toBe(false)
    fireEvent.click(convert())
    expect(onConvert).toHaveBeenCalledTimes(1)
  })

  it('stays, disabled, with the reason, while an erasure is pending — and never opens the dialog', () => {
    const { onConvert } = renderCard({ erasurePending: true })
    expect(convert().disabled).toBe(true)
    // The reason is the tooltip's, hung off the wrapper a disabled button
    // needs to receive a pointer at all.
    expect(screen.getByLabelText(PENDING_REASON)).not.toBeNull()
    fireEvent.click(convert())
    expect(onConvert).not.toHaveBeenCalled()
  })
})

/**
 * The lead's own profile (AGL-3231): one Save writes every field through
 * the record's normalizer, a cleared field is deleted rather than blanked,
 * and a phone the record cannot hold is refused under the field with
 * nothing written.
 */
describe('the profile on the lead page', () => {
  beforeEach(() => updateDoc.mockClear())

  it('saves the profile as the record stores it, deleting what was cleared', async () => {
    renderCard({ lead: { ...lead, jobTitle: 'CMO', tags: ['warm'] } })
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: ' Acme  Brands ' } })
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'acme.com' } })
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'ICP2, a-list' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Save' })
    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(updateDoc.mock.calls[0]?.[1]).toMatchObject({
      company: 'Acme Brands',
      jobTitle: { op: 'delete' },
      website: 'https://acme.com/',
      tags: ['icp2', 'a-list'],
      phone: { op: 'delete' },
      leadSource: { op: 'delete' },
      address: { op: 'delete' },
    })
  })

  it('refuses a phone it cannot read under the field, and writes nothing', async () => {
    renderCard()
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: 'call me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/could not be read/)).not.toBeNull()
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('is read-only once the lead is converted', () => {
    renderCard({ lead: { ...lead, status: 'qualified', convertedContactId: 'c-1' } })
    expect((screen.getByLabelText('Company') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

/**
 * THE ORG'S OWN LEAD FIELDS ON THE LEAD PAGE (AGL-3272).
 *
 * What the card has to get right is the SHAPE of the write: one dotted
 * path per key the reader touched, never the map whole — a `custom` map
 * written whole would take out every key the card did not show, which is
 * where a retired field's values and an integration's writes sit.
 */
describe('the custom lead fields on the lead page', () => {
  const definition = {
    $id: 'f-budget',
    key: 'budget',
    label: 'Budget',
    type: 'text' as const,
    order: 0,
  }

  beforeEach(() => {
    updateDoc.mockClear()
    definitionsFor.mockReturnValue({
      definitions: [definition],
      active: [definition],
      ready: true,
      fromCache: false,
    })
  })

  afterEach(() =>
    definitionsFor.mockReturnValue({
      definitions: [],
      active: [],
      ready: true,
      fromCache: false,
    }),
  )

  it('asks for the LEAD definitions, not the contact ones', () => {
    renderCard()
    expect(definitionsFor).toHaveBeenLastCalledWith('org-1', 'lead')
  })

  it('writes one dotted path per touched key, leaving the rest of the map alone', async () => {
    renderCard({ lead: { ...lead, custom: { budget: '1000', untouched: 'keep me' } } })
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Save' })
    expect(updateDoc).toHaveBeenCalledTimes(1)
    const written = updateDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written['custom.budget']).toBe('5000')
    expect(written).not.toHaveProperty('custom')
    expect(written).not.toHaveProperty('custom.untouched')
  })

  it('offers Save for a custom edit alone, and refuses a required field cleared', async () => {
    const required = { ...definition, required: true }
    definitionsFor.mockReturnValue({
      definitions: [required],
      active: [required],
      ready: true,
      fromCache: false,
    })
    renderCard({ lead: { ...lead, custom: { budget: '1000' } } })
    // Nothing on the profile was touched, so Save is offered for the
    // custom edit or not at all.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    // A required field's label carries MUI's asterisk, so it is matched
    // by its text rather than in full.
    fireEvent.change(screen.getByLabelText(/Budget/), { target: { value: '' } })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Save' })
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('is read-only once the lead is converted', () => {
    renderCard({
      lead: { ...lead, status: 'qualified', convertedContactId: 'c-1', custom: { budget: '1' } },
    })
    expect((screen.getByLabelText('Budget') as HTMLInputElement).disabled).toBe(true)
  })
})
