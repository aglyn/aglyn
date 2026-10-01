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

const mockApi = { saveSequence: jest.fn(), sendStepTest: jest.fn() }
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
  // The test dialog's person picker (AGL-3325): nobody found, nothing asked.
  useOutreachContactSearch: () => ({ status: 'ready', data: [], idle: true }),
  useOutreachLeadSearch: () => ({ status: 'ready', data: [], idle: true }),
}))
/** The org's campaigns the picker offers (AGL-3254), and whose they were. */
let mockCampaigns: Array<{ value: string; label: string }>
const mockCampaignReads: Array<{ orgId: unknown; enabled: unknown }> = []
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-rep', email: 'avery@example.com' } }),
  useOrgContainerOptions: (_kind: string, orgId: unknown, options?: { enabled?: boolean }) => {
    mockCampaignReads.push({ orgId, enabled: options?.enabled })
    return { options: mockCampaigns, truncated: false, ready: true }
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
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
  orgSlug: 'acme',
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
  settings: { window: null, allowedCountries: ['US'], allowCustomers: false, trackClicks: false, countOpens: false, listUnsubscribe: false },
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
  mockCampaignReads.length = 0
  mockCampaigns = [
    { value: 'founder-icp1', label: 'Founder · ICP 1' },
    { value: 'founder-icp2', label: 'Founder · ICP 2' },
  ]
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
    // The ORG's campaigns — a sequence is an org record, and so is a
    // campaign — picked the way a form's page picks them (AGL-3254).
    expect(mockCampaignReads.at(-1)).toEqual({ orgId: 'org-1', enabled: true })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Campaigns' }))
    fireEvent.click(screen.getByRole('option', { name: 'Founder · ICP 2' }))
    // A multiple select stays open after a pick; Escape closes it so the
    // page's buttons are reachable again.
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    // Opens are counted only when asked for (AGL-3395): off on a new one.
    const countOpens = screen.getByLabelText('Count opens') as HTMLInputElement
    expect(countOpens.checked).toBe(false)
    fireEvent.click(countOpens)
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
        countOpens: true,
      },
      campaignIds: ['founder-icp2'],
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

  it('sends a test of a step from the stored sequence, to the member or an address they type (AGL-3325)', async () => {
    mockApi.sendStepTest.mockResolvedValue({
      ok: true,
      stepIndex: 1,
      sentTo: 'outside@example.org',
      subject: '[Test] Re: Your second location',
      sentAtMs: 1,
      testsToday: 1,
      unresolvedFields: [],
    })
    renderEditor({ sequence: stored() })
    fireEvent.click(screen.getByRole('button', { name: 'Send a test of step 2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send a test of step 2' })
    // The sample person and their line are in place; the test goes to the member unless they say where.
    expect(within(dialog).getByText(/Leave empty to send it to yourself \(avery@example.com\)/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Send to'), {
      target: { value: 'outside@example.org' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send the test' }))
    await waitFor(() =>
      expect(mockApi.sendStepTest).toHaveBeenCalledWith({
        sequenceId: 'seq-1',
        stepIndex: 1,
        personalLine: 'I saw Example Co just opened its second location.',
        to: 'outside@example.org',
      }),
    )
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Sent to outside@example.org as “[Test] Re: Your second location”',
    )
  })

  it('offers a test only once the sequence exists to send it from (AGL-3325)', () => {
    renderEditor()
    const button = screen.getByRole('button', { name: 'Send a test of step 1' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(mockApi.sendStepTest).not.toHaveBeenCalled()
  })
})

/**
 * "Maximum update depth exceeded" while typing a step's body (AGL-3423).
 *
 * The console reported minified React error #185 thrown from the body
 * field's own `onChange`. React 19 counts every commit that leaves a
 * default-priority update pending as a nested one, and keystrokes the
 * browser delivers back to back commit one after another with nothing in
 * between to clear that count. The editor held such an update pending after
 * every commit: the countries Autocomplete re-rendered with each keystroke,
 * handed its input a new chip array, and MUI's `InputBase` copied it into
 * its `FormControl` from a passive effect.
 *
 * Run against the PRODUCTION builds of React and MUI, in a module registry
 * of their own: in development MUI's `FormControl` hands its inputs a new
 * context on every render, which reruns that effect for every field on the
 * page and would measure the development build rather than what ships. The
 * keystrokes are dispatched in one task and outside `act`, which is how a
 * browser delivers queued input, and which `act` would batch into a single
 * commit.
 */
describe('the sequence editor: typing (AGL-3423)', () => {
  it('takes a burst of keystrokes in a step’s body without exceeding React’s update depth', async () => {
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    // Widened: the Next typings declare `NODE_ENV` read-only.
    const env = process.env as Record<string, string | undefined>
    const environment = env['NODE_ENV']
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT
    const errors: string[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(String(event.error?.message ?? event.message))
      event.preventDefault()
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    env['NODE_ENV'] = 'production'
    scope.IS_REACT_ACT_ENVIRONMENT = false
    window.addEventListener('error', onError)
    let unmount: () => void = () => undefined
    try {
      let react!: typeof import('react')
      let client!: typeof import('react-dom/client')
      let Editor!: typeof OutreachSequenceEditor
      jest.isolateModules(() => {
        react = jest.requireActual('react')
        client = jest.requireActual('react-dom/client')
        Editor = (
          jest.requireActual('./sequence-editor') as typeof import('./sequence-editor')
        ).OutreachSequenceEditor
      })
      const root = client.createRoot(host)
      unmount = () => root.unmount()
      root.render(
        react.createElement(Editor, {
          orgId: 'org-1',
          orgMount,
          sequence: null,
          settings,
          mailboxes,
          mailboxesPath: '/acme/outreach/mailboxes',
          onSaved: () => undefined,
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      // A new sequence's countries are chips: the field that held the update.
      expect(within(host).getByText('United States')).toBeTruthy()
      const body = within(host).getByLabelText('Body') as HTMLTextAreaElement
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set
      for (let typed = 1; typed <= 80; typed += 1) {
        setValue?.call(body, 'x'.repeat(typed))
        body.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(errors).toEqual([])
      expect(body.value).toHaveLength(80)
    } finally {
      unmount()
      window.removeEventListener('error', onError)
      host.remove()
      env['NODE_ENV'] = environment
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment
    }
    // The cost is the isolated registry: production React, MUI and the
    // editor loaded a second time, which on a two-worker CI shard ran past
    // the 30-second default twice in a row. The keystrokes are milliseconds.
  }, 120_000)
})
