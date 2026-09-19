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
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OutreachMailbox, OutreachSequence } from '../model/outreach.types'
import {
  OutreachSequenceEditor,
  type OutreachSequenceEditorProps,
} from './sequence-editor'
import { OutreachRouteError } from './use-outreach-api'
import type { OutreachTemplateOption } from './use-outreach-crm'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'
import type { OutreachSettingsLoad } from './use-outreach-settings'

/**
 * The sequence editor (AGL-2980): the draft it starts with, the steps it
 * adds, the merge fields it inserts, a CRM template in place of a body, the
 * live preview with the real footer, the mailbox it sends from, every issue
 * beside its field, and the save — refused by the engine's validator before
 * any request, or by the route, whose issues land in the same places.
 */

const mockApi = { saveSequence: jest.fn() }
const mockMailboxApi = {
  availability: jest.fn(async () => ({ configured: true, canManageAll: false })),
}
let mockTemplates: OutreachTemplateOption[]
const mockEnqueueSnackbar = jest.fn()

jest.mock('./use-outreach-api', () => ({
  ...jest.requireActual('./use-outreach-api'),
  useOutreachApi: () => mockApi,
}))
jest.mock('./use-outreach-mailbox-api', () => ({
  useOutreachMailboxApi: () => mockMailboxApi,
}))
jest.mock('./use-outreach-crm', () => ({
  useOutreachEmailTemplates: () => ({ status: 'ready', data: mockTemplates }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-rep' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
  }: {
    children: ReactNode
    header: ReactNode
  }) => <section aria-label={String(header)}>{children}</section>,
  MdiIcon: () => null,
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const settings: OutreachSettingsLoad = {
  status: 'ready',
  settings: {
    legalName: 'Example Co LLC',
    brandName: 'Example Co',
    postalAddress: '100 Example St',
    allowedCountries: ['US'],
    updatedAtMs: 1,
    updatedByUid: null,
  },
  message: null,
  reload: jest.fn(),
}

const mailbox = (overrides: Partial<OutreachMailbox>): OutreachMailbox =>
  ({
    id: 'mbx-1',
    email: 'avery@example.com',
    sendAs: 'avery@example.com',
    displayName: 'Avery Quinn',
    status: 'connected',
    connectedByUid: 'uid-rep',
    timezone: 'America/Chicago',
    ...overrides,
  }) as OutreachMailbox

const mailboxes: OutreachMailboxesResult = {
  status: 'ready',
  mailboxes: [
    mailbox({}),
    // A colleague's, which a member who is not an owner or admin is not offered.
    mailbox({
      id: 'mbx-colleague',
      email: 'jordan@example.com',
      sendAs: 'jordan@example.com',
      displayName: 'Jordan Lee',
      connectedByUid: 'uid-colleague',
    }),
  ],
}

const orgMount = {
  orgId: 'org-1',
  hosts: [{ id: 'host-1', name: 'Example Shop', subdomain: 'shop' }],
  hostsReady: true,
  hostsPath: '/acme/hosts',
}

const stored = (
  overrides: Partial<OutreachSequence> = {},
): OutreachSequence => ({
  id: 'seq-1',
  name: 'Second locations',
  hostId: 'host-1',
  mailboxId: 'mbx-1',
  status: 'draft',
  createdAtMs: 1,
  updatedAtMs: 1,
  settings: { window: null, allowedCountries: ['US'], allowCustomers: false },
  steps: [
    {
      id: 'step-a',
      kind: 'email',
      delayBusinessDays: 0,
      subject: 'Your second location',
      replyInThread: false,
      body: 'Hi {{contact.firstName}}, {{enrollment.personalLine}}',
      templateId: null,
    },
    {
      id: 'step-b',
      kind: 'email',
      delayBusinessDays: 3,
      subject: '',
      replyInThread: true,
      body: 'Following up.',
      templateId: null,
    },
  ],
  ...overrides,
})

const renderEditor = (props: Partial<OutreachSequenceEditorProps> = {}) => {
  const onSaved = jest.fn()
  render(
    <OutreachSequenceEditor
      orgId="org-1"
      orgMount={orgMount}
      sequence={null}
      settings={settings}
      mailboxes={mailboxes}
      mailboxesPath="/acme/outreach/mailboxes"
      onSaved={onSaved}
      {...props}
    />,
  )
  return { onSaved }
}

const preview = () => screen.getByLabelText('Email preview')

beforeEach(() => {
  jest.clearAllMocks()
  mockTemplates = [
    {
      id: 'tpl-1',
      name: 'Follow-up letter',
      subject: 'x',
      body: 'The template body, {{contact.firstName}}.',
    },
  ]
})

describe('the sequence editor: a new sequence (AGL-2980)', () => {
  it('starts with one email on the organization’s only site, and previews it to the sample person', () => {
    renderEditor()
    expect(screen.getAllByRole('region', { name: /^Step \d/ })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Step 1 · Email' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Site' }).textContent).toBe(
      'Example Shop',
    )
    // The member's one sending mailbox is chosen for them.
    expect(screen.getByRole('combobox', { name: 'Mailbox' }).textContent).toBe(
      'Avery Quinn <avery@example.com>',
    )
    // The first email has no subject yet, so the composer says so.
    expect(screen.getByText('This email has no subject.')).toBeTruthy()
  })

  it('adds an email and a task, and caps the emails at four', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'LinkedIn' }))
    const steps = screen.getAllByRole('region', { name: /^Step \d/ })
    expect(steps.map((step) => step.getAttribute('aria-label'))).toEqual([
      'Step 1 · Email',
      'Step 2 · Email',
      'Step 3 · LinkedIn',
    ])
    expect(
      (within(steps[2]).getByLabelText('Title') as HTMLInputElement).value,
    ).toBe('Connect on LinkedIn')
    // The second email replies in the thread by default, and says so.
    expect(within(steps[1]).getByText(/Sent as a reply/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }))
    expect(
      (screen.getByRole('button', { name: 'Add email' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('inserts a merge field where the caret was, and the preview fills it', () => {
    renderEditor()
    const step = screen.getByRole('region', { name: 'Step 1 · Email' })
    fireEvent.change(within(step).getByLabelText('Subject'), {
      target: { value: 'Hello' },
    })
    const body = within(step).getByLabelText('Body') as HTMLTextAreaElement
    fireEvent.change(body, { target: { value: 'Hi. ' } })
    fireEvent.focus(body)
    body.setSelectionRange(4, 4)
    fireEvent.click(within(step).getByRole('button', { name: 'Insert field' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Personal line' }))
    expect(body.value).toBe('Hi. {{enrollment.personalLine}}')
    expect(preview().textContent).toContain(
      'Hi. I saw Example Co just opened its second location.',
    )
    expect(preview().textContent).toContain('Example Co LLC · 100 Example St')
  })

  it('sends a CRM template’s body in place of its own, in the preview too', () => {
    renderEditor()
    const step = screen.getByRole('region', { name: 'Step 1 · Email' })
    fireEvent.change(within(step).getByLabelText('Subject'), {
      target: { value: 'Hello' },
    })
    fireEvent.change(within(step).getByLabelText('CRM email template'), {
      target: { value: 'Follow' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'Follow-up letter' }))
    expect(
      (
        within(step).getByLabelText(
          'Body (from the template)',
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true)
    expect(preview().textContent).toContain('The template body, Casey.')
  })

  it('refuses a save the validator refuses, before any request, naming each field', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Create sequence' }))
    expect(await screen.findByText('Name the sequence.')).toBeTruthy()
    expect(screen.getByText('The first email needs a subject.')).toBeTruthy()
    expect(
      screen.getByText('Write the email, or pick a template.'),
    ).toBeTruthy()
    expect(mockApi.saveSequence).not.toHaveBeenCalled()
  })

  it('saves the draft, and hands the stored sequence back', async () => {
    const saved = stored()
    mockApi.saveSequence.mockResolvedValue({
      ok: true,
      sequence: saved,
      created: true,
      warnings: [],
    })
    const { onSaved } = renderEditor({
      mailboxes: {
        status: 'ready',
        mailboxes: [
          mailbox({ id: 'mbx-other', sendAs: 'avery.quinn@example.org', email: 'avery.quinn@example.org' }),
          mailbox({}),
        ],
      },
    })
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Second locations' },
    })
    // Two of the member's own: nothing is chosen for them, and they choose.
    const picker = screen.getByRole('combobox', { name: 'Mailbox' })
    expect(picker.textContent).not.toContain('@')
    fireEvent.mouseDown(picker)
    fireEvent.click(
      screen.getByRole('option', { name: 'Avery Quinn <avery@example.com>' }),
    )
    const step = screen.getByRole('region', { name: 'Step 1 · Email' })
    fireEvent.change(within(step).getByLabelText('Subject'), {
      target: { value: 'Your second location' },
    })
    fireEvent.change(within(step).getByLabelText('Body'), {
      target: { value: 'Hi {{enrollment.personalLine}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create sequence' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    const [sequenceId, draft] = mockApi.saveSequence.mock.calls[0]
    expect(sequenceId).toBeNull()
    expect(draft).toMatchObject({
      name: 'Second locations',
      hostId: 'host-1',
      mailboxId: 'mbx-1',
      settings: {
        window: null,
        allowedCountries: ['US'],
        allowCustomers: false,
      },
    })
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Sequence created.', {
      variant: 'success',
    })
  })

  it('shows what only the route can judge where the field is', async () => {
    mockApi.saveSequence.mockRejectedValue(
      new OutreachRouteError(
        'People are enrolled in this sequence.',
        'invalid-sequence',
        400,
        [
          {
            path: 'steps',
            code: 'steps_locked',
            severity: 'error',
            message:
              "People are enrolled in this sequence, so its steps can't be removed, reordered or changed to another kind.",
          },
          {
            path: 'settings.allowedCountries',
            code: 'country_not_in_org',
            severity: 'error',
            message: "CA isn't among the countries your organization allows.",
          },
        ],
      ),
    )
    renderEditor({ sequence: stored() })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(await screen.findByText(/its steps can't be removed/)).toBeTruthy()
    expect(
      screen.getByText(
        "CA isn't among the countries your organization allows.",
      ),
    ).toBeTruthy()
  })
})

describe('the sequence editor: a stored sequence (AGL-2980)', () => {
  it('opens its steps, warns about what sends but was probably not meant, and replies in the thread', () => {
    renderEditor({
      sequence: stored({
        steps: [
          {
            ...(stored().steps[0] as object),
            body: 'Hi {{contact.firstName}}',
          } as OutreachSequence['steps'][number],
          stored().steps[1],
        ],
      }),
    })
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Second locations',
    )
    expect(
      screen.getByText(
        /The first email doesn't use \{\{enrollment.personalLine\}\}/,
      ),
    ).toBeTruthy()
    const second = screen.getByRole('region', { name: 'Step 2 · Email' })
    expect(
      within(second).getByText('Sent as a reply: “Re: Your second location”.'),
    ).toBeTruthy()
  })

  it('says, under the mailbox, what activating needs while it is paused', () => {
    renderEditor({
      sequence: stored(),
      mailboxes: { status: 'ready', mailboxes: [mailbox({ status: 'paused' })] },
    })
    const picker = screen.getByRole('combobox', { name: 'Mailbox' })
    expect(picker.textContent).toBe('Avery Quinn <avery@example.com> — Paused')
    expect(
      screen.getByText(
        "This sequence's mailbox is paused. Resume it in Mailboxes, then activate the sequence.",
      ),
    ).toBeTruthy()
  })

  it('is read-only once archived', () => {
    renderEditor({ sequence: stored({ status: 'archived' }) })
    expect(
      screen.getByText('This sequence is archived, so it can’t be edited.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(
      true,
    )
  })

  it('previews each email as the person would get it, a later one as a reply', () => {
    renderEditor({ sequence: stored() })
    expect(preview().textContent).toContain('Subject: Your second location')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Email' }))
    fireEvent.click(screen.getByRole('option', { name: 'Email 2 · step 2' }))
    expect(preview().textContent).toContain('Subject: Re: Your second location')
    expect(preview().textContent).toContain('Following up.')
  })
})
