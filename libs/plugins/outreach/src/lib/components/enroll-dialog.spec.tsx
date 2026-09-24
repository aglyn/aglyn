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

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type {
  OutreachEnrollPreviewPerson,
  OutreachEnrollPreviewResponse,
} from '../model/outreach-api'
import type { OutreachSequence } from '../model/outreach.types'
import { OutreachEnrollDialog, outreachPersonReady } from './enroll-dialog'
import type { OutreachApi } from './use-outreach-api'
import type {
  OutreachContactOption,
  OutreachViewOption,
} from './use-outreach-crm'
import type { OutreachLoad } from './use-outreach-data'

/**
 * Enrolling people (AGL-2980): the two sources, the gate preview with each
 * person's standing and reasons, what a cold contact needs from the rep
 * before they count as ready, the email a person would get, and Confirm —
 * which sends only the ready people and then shows what the server refused
 * when it checked again. The CRM reads are stubbed at the dialog's hooks and
 * the routes at the API it is handed.
 */

let mockViews: OutreachLoad<OutreachViewOption[]>
let mockSearch: OutreachLoad<OutreachContactOption[]> & { idle: boolean }
let mockLeadSearch: OutreachLoad<OutreachContactOption[]> & { idle: boolean }

jest.mock('./use-outreach-crm', () => ({
  useOutreachSavedViews: () => mockViews,
  useOutreachContactSearch: () => mockSearch,
  useOutreachLeadSearch: () => mockLeadSearch,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({ HelpTip: () => null }))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => ({ excerpt: '' }) }))

const sequence = {
  id: 'seq-1',
  name: 'Second locations',
  hostId: 'host-1',
} as OutreachSequence

const person = (
  overrides: Partial<OutreachEnrollPreviewPerson>,
): OutreachEnrollPreviewPerson => ({
  personId: overrides.contactId ?? 'c-1',
  target: 'contact',
  contactId: 'c-1',
  leadId: null,
  name: 'Casey Morgan',
  email: 'casey.morgan@example.com',
  cold: false,
  country: 'US',
  status: 'eligible',
  blocks: [],
  requires: { personalLine: false, attestations: [] },
  ...overrides,
})

const PREVIEW: OutreachEnrollPreviewResponse = {
  ok: true,
  total: 3,
  truncated: false,
  people: [
    person({ contactId: 'c-warm' }),
    person({
      contactId: 'c-cold',
      name: 'Avery Quinn',
      email: 'avery.quinn@example.org',
      cold: true,
      status: 'needs_confirmation',
      requires: {
        personalLine: true,
        attestations: [
          'us_business_address',
          'published_or_given',
          'verified_deliverable',
        ],
      },
    }),
    person({
      contactId: 'c-blocked',
      name: 'Jordan Lee',
      email: 'jordan.lee@example.net',
      status: 'blocked',
      blocks: [
        {
          code: 'do_not_contact',
          reason:
            "jordan.lee@example.net is on your organization's do-not-contact list.",
        },
      ],
    }),
  ],
}

let api: jest.Mocked<
  Pick<OutreachApi, 'previewEnrollment' | 'enroll' | 'previewEmail' | 'sendStepTest'>
>

const renderDialog = () => {
  const onClose = jest.fn()
  render(
    <OutreachEnrollDialog
      open
      onClose={onClose}
      orgId="org-1"
      sequence={sequence}
      contactGroupId="host-1"
      uid="uid-rep"
      api={api as unknown as OutreachApi}
    />,
  )
  return { onClose }
}

const row = (name: string) => screen.getByRole('listitem', { name })

beforeEach(() => {
  mockViews = { status: 'ready', data: [{ id: 'view-1', name: 'Warm leads', section: 'contacts' }] }
  mockSearch = { status: 'ready', data: [], idle: true }
  mockLeadSearch = { status: 'ready', data: [], idle: true }
  api = {
    previewEnrollment: jest.fn().mockResolvedValue(PREVIEW),
    enroll: jest.fn(),
    previewEmail: jest.fn(),
    sendStepTest: jest.fn(),
  }
})

describe('enrolling: the source (AGL-2980)', () => {
  it('checks the people a saved view selects', async () => {
    renderDialog()
    const check = screen.getByRole('button', {
      name: 'Check people',
    }) as HTMLButtonElement
    expect(check.disabled).toBe(true)
    fireEvent.mouseDown(
      screen.getByRole('combobox', { name: 'Saved Contacts view' }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Warm leads' }))
    fireEvent.click(check)
    await screen.findByText('1 eligible · 1 need you · 1 blocked')
    expect(api.previewEnrollment).toHaveBeenCalledWith('seq-1', {
      kind: 'view',
      viewId: 'view-1',
    })
  })

  it('says when there is no view to enroll from, and when the CRM refuses the reader', () => {
    mockViews = { status: 'ready', data: [] }
    const { onClose } = renderDialog()
    expect(
      screen.getByText(/You have no saved Contacts views to enroll from/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('says the CRM refused a reader without Manage data', () => {
    mockViews = { status: 'refused', data: [] }
    renderDialog()
    expect(
      screen.getByText(/your role does not include Manage data/),
    ).toBeTruthy()
  })

  it('checks the people a search picked', async () => {
    mockSearch = {
      status: 'ready',
      idle: false,
      data: [
        {
          id: 'c-warm',
          name: 'Casey Morgan',
          email: 'casey.morgan@example.com',
        },
      ],
    }
    renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    fireEvent.change(screen.getByLabelText('Search contacts'), {
      target: { value: 'Casey' },
    })
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Search results' })).getByText(
        'Casey Morgan',
      ),
    )
    expect(
      within(screen.getByLabelText('Picked')).getByText('Casey Morgan'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check people' }))
    await waitFor(() =>
      expect(api.previewEnrollment).toHaveBeenCalledWith('seq-1', {
        kind: 'contacts',
        contactIds: ['c-warm'],
      }),
    )
  })

  /**
   * The Leads tab (AGL-3234): the sequence's site's open leads, picked and
   * checked as leads — the source says which record they are.
   */
  it('checks the leads picked from the sequence’s site', async () => {
    mockLeadSearch = {
      status: 'ready',
      idle: false,
      data: [{ id: 'lead-key-1', name: 'Dana Marsh', email: 'dana@example.com' }],
    }
    renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: 'Leads' }))
    fireEvent.change(screen.getByLabelText('Search leads'), { target: { value: 'Dana' } })
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Lead results' })).getByText('Dana Marsh'),
    )
    expect(within(screen.getByLabelText('Picked leads')).getByText('Dana Marsh')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check people' }))
    await waitFor(() =>
      expect(api.previewEnrollment).toHaveBeenCalledWith('seq-1', {
        kind: 'leads',
        leadIds: ['lead-key-1'],
      }),
    )
  })

  it('says a failed check in the route’s words, and stays on the source', async () => {
    api.previewEnrollment.mockRejectedValue(
      new Error('Activate this sequence before enrolling people.'),
    )
    renderDialog()
    fireEvent.mouseDown(
      screen.getByRole('combobox', { name: 'Saved Contacts view' }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Warm leads' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check people' }))
    expect(
      await screen.findByText(
        'Activate this sequence before enrolling people.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Saved view' })).toBeTruthy()
  })
})

describe('enrolling: the gate preview and Confirm (AGL-2980)', () => {
  const toPreview = async () => {
    renderDialog()
    fireEvent.mouseDown(
      screen.getByRole('combobox', { name: 'Saved Contacts view' }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Warm leads' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check people' }))
    await screen.findByText('1 eligible · 1 need you · 1 blocked')
  }

  it('marks each person, and gives the blocked one’s reason in plain words', async () => {
    await toPreview()
    expect(within(row('Casey Morgan')).getByText('Eligible')).toBeTruthy()
    expect(within(row('Avery Quinn')).getByText('Needs you')).toBeTruthy()
    expect(within(row('Avery Quinn')).getByText('Cold')).toBeTruthy()
    expect(within(row('Jordan Lee')).getByText('Blocked')).toBeTruthy()
    expect(
      within(row('Jordan Lee')).getByText(
        "jordan.lee@example.net is on your organization's do-not-contact list.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enroll 1 person' })).toBeTruthy()
    expect(
      screen.getByText(
        /1 person still needs a personal line or a confirmation/,
      ),
    ).toBeTruthy()
  })

  it('counts a cold contact only once the line is written and all three attestations are ticked', async () => {
    await toPreview()
    const cold = row('Avery Quinn')
    fireEvent.change(within(cold).getByLabelText(/Personal line/), {
      target: { value: 'Saw the second location open on Main St.' },
    })
    fireEvent.click(
      within(cold).getByLabelText('This is a US business address'),
    )
    fireEvent.click(
      within(cold).getByLabelText(
        'They or their company published this address, or they gave it to us',
      ),
    )
    expect(screen.getByRole('button', { name: 'Enroll 1 person' })).toBeTruthy()
    fireEvent.click(
      within(cold).getByLabelText('This address was verified as deliverable'),
    )
    expect(screen.getByRole('button', { name: 'Enroll 2 people' })).toBeTruthy()
  })

  it('sends only the ready people with what the rep supplied, then shows what the server refused', async () => {
    api.enroll.mockResolvedValue({
      ok: true,
      enrolled: 1,
      results: [
        {
          personId: 'c-warm',
          target: 'contact',
          contactId: 'c-warm',
          leadId: null,
          email: 'casey.morgan@example.com',
          outcome: 'enrolled',
          enrollmentId: 'seq-1_c-warm',
        },
        {
          personId: 'c-cold',
          target: 'contact',
          contactId: 'c-cold',
          leadId: null,
          email: 'avery.quinn@example.org',
          outcome: 'blocked',
          blocks: [
            {
              code: 'host_suppressed',
              reason:
                'avery.quinn@example.org unsubscribed from this site’s email, or mail to it bounced.',
            },
          ],
        },
      ],
    })
    await toPreview()
    const cold = row('Avery Quinn')
    fireEvent.change(within(cold).getByLabelText(/Personal line/), {
      target: { value: '  Saw the new storefront.  ' },
    })
    for (const label of [
      'This is a US business address',
      'They or their company published this address, or they gave it to us',
      'This address was verified as deliverable',
    ]) {
      fireEvent.click(within(cold).getByLabelText(label))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Enroll 2 people' }))
    await screen.findByText(/Enrolled 1 person/)
    expect(api.enroll).toHaveBeenCalledWith('seq-1', [
      { contactId: 'c-warm', personalLine: '', attestations: [] },
      {
        contactId: 'c-cold',
        personalLine: 'Saw the new storefront.',
        attestations: [
          'us_business_address',
          'published_or_given',
          'verified_deliverable',
        ],
      },
    ])
    expect(
      screen.getByText(
        'avery.quinn@example.org unsubscribed from this site’s email, or mail to it bounced.',
      ),
    ).toBeTruthy()
  })

  it('leaves a person out when the rep unticks them', async () => {
    await toPreview()
    fireEvent.click(
      within(row('Casey Morgan')).getByLabelText('Enroll this person'),
    )
    expect(
      (
        screen.getByRole('button', {
          name: 'Enroll 0 people',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('shows the first email a person would get, with their line in it', async () => {
    api.previewEmail.mockResolvedValue({
      ok: true,
      stepIndex: 0,
      subject: 'Your second location, Avery',
      text: 'Hi Avery, Saw the new storefront.\n\nExample Co LLC · 100 Example St',
      unresolvedFields: [],
      error: null,
    })
    await toPreview()
    const cold = row('Avery Quinn')
    fireEvent.change(within(cold).getByLabelText(/Personal line/), {
      target: { value: 'Saw the new storefront.' },
    })
    fireEvent.click(
      within(cold).getByRole('button', { name: 'Preview the first email' }),
    )
    const email = await within(cold).findByLabelText(
      'First email to Avery Quinn',
    )
    expect(email.textContent).toContain('Subject: Your second location, Avery')
    expect(api.previewEmail).toHaveBeenCalledWith({
      sequenceId: 'seq-1',
      contactId: 'c-cold',
      personalLine: 'Saw the new storefront.',
    })
  })

  it('sends a person’s first email to the rep as a test, with their line, and enrolls nobody (AGL-3325)', async () => {
    api.sendStepTest.mockResolvedValue({
      ok: true,
      stepIndex: 0,
      sentTo: 'rep@example.com',
      subject: '[Test] Your second location, Avery',
      sentAtMs: 1,
      testsToday: 1,
    })
    await toPreview()
    const cold = row('Avery Quinn')
    fireEvent.change(within(cold).getByLabelText(/Personal line/), {
      target: { value: 'Saw the new storefront.' },
    })
    fireEvent.click(within(cold).getByRole('button', { name: 'Send me this as a test' }))
    expect((await within(cold).findByRole('alert')).textContent).toBe(
      'Sent to rep@example.com as “[Test] Your second location, Avery”. Avery Quinn was not enrolled.',
    )
    expect(api.sendStepTest).toHaveBeenCalledWith({
      sequenceId: 'seq-1',
      contactId: 'c-cold',
      personalLine: 'Saw the new storefront.',
    })
    expect(api.enroll).not.toHaveBeenCalled()
  })
})

describe('outreachPersonReady (AGL-2980)', () => {
  it('holds a long personal line back, and never a blocked person', () => {
    const cold = PREVIEW.people[1]
    const all = {
      include: true,
      personalLine: 'x'.repeat(301),
      attestations: cold.requires.attestations,
    }
    expect(outreachPersonReady(cold, all)).toBe(false)
    expect(
      outreachPersonReady(cold, { ...all, personalLine: 'One sentence.' }),
    ).toBe(true)
    expect(
      outreachPersonReady(PREVIEW.people[2], {
        include: true,
        personalLine: 'x',
        attestations: [],
      }),
    ).toBe(false)
  })
})
