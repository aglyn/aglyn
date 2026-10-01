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

import { within } from '@testing-library/dom'
import type { ReactNode } from 'react'
import {
  type FiberRenderCounter,
  installFiberRenderCounter,
} from '@aglyn/shared-ui-jsx/testing/fiber-render-counter'
import type { OutreachSequence } from '../model/outreach.types'
import type { OutreachSequenceEditorProps } from './sequence-editor'

/**
 * What one keystroke costs in the sequence editor (AGL-3423).
 *
 * The whole sequence is one draft, and one letter typed anywhere used to
 * redraw every field of every step, the settings and the preview: 17 inputs,
 * both template pickers and some 1,150 components in a three-step sequence.
 * When each keystroke costs that much, typed input queues and is processed
 * back to back, and the countries chips redrawn by every one of them left
 * React's nested-update count climbing until it threw #185 (see the typing
 * case in `sequence-editor.spec.tsx`). A keystroke now redraws the field it
 * lands in, and the preview and the step quoting it when they show what was
 * typed. No Autocomplete is redrawn at all: neither the countries chips nor
 * a step's template picker shows anything a letter typed elsewhere changes.
 * Counted off React's own commits, so the budget is what actually rendered,
 * not what a reading of the code expects to.
 *
 * The input budget is two: the field typed into draws once for its new value,
 * and once more when the letter is its first, because MUI keeps "filled" in
 * the field's `FormControl` and the change redraws the input under it.
 */

// A fresh module registry per test loads React and MUI anew.
jest.setTimeout(60_000)

const mockApi = { saveSequence: jest.fn(), sendStepTest: jest.fn() }
const mockMailboxApi = {
  availability: jest.fn(async () => ({ configured: true, canManageAll: false })),
}
const mockTemplates = [
  { id: 'tpl-1', name: 'Follow-up letter', subject: 'x', body: 'The template body.' },
]
const mockCampaigns = [{ value: 'founder-icp1', label: 'Founder · ICP 1' }]

jest.mock('./use-outreach-api', () => ({
  ...jest.requireActual('./use-outreach-api'),
  useOutreachApi: () => mockApi,
}))
jest.mock('./use-outreach-mailbox-api', () => ({
  useOutreachMailboxApi: () => mockMailboxApi,
}))
jest.mock('./use-outreach-crm', () => ({
  useOutreachEmailTemplates: () => ({ status: 'ready', data: mockTemplates }),
  useOutreachContactSearch: () => ({ status: 'ready', data: [], idle: true }),
  useOutreachLeadSearch: () => ({ status: 'ready', data: [], idle: true }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-rep', email: 'avery@example.com' } }),
  useOrgCampaigns: () => ({ options: mockCampaigns, truncated: false, ready: true }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
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

const settings: OutreachSequenceEditorProps['settings'] = {
  status: 'ready',
  settings: {
    legalName: 'Example Co LLC',
    brandName: 'Example Co',
    postalAddress: '100 Example St',
    allowedCountries: ['US', 'CA'],
    updatedAtMs: 1,
    updatedByUid: null,
  },
  message: null,
  reload: () => undefined,
}

const mailboxes: OutreachSequenceEditorProps['mailboxes'] = {
  status: 'ready',
  mailboxes: [
    {
      id: 'mbx-1',
      email: 'avery@example.com',
      sendAs: 'avery@example.com',
      displayName: 'Avery Quinn',
      status: 'connected',
      connectedByUid: 'uid-rep',
      timezone: 'America/Chicago',
    } as OutreachSequenceEditorProps['mailboxes']['mailboxes'][number],
  ],
}

/** Two emails, the second a reply in the first's thread, then a task. */
const stored: OutreachSequence = {
  id: 'seq-1',
  name: 'Second locations',
  hostId: 'host-1',
  mailboxId: 'mbx-1',
  status: 'draft',
  createdAtMs: 1,
  updatedAtMs: 1,
  campaignIds: ['founder-icp1'],
  settings: {
    window: { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 },
    allowedCountries: ['US', 'CA'],
    allowCustomers: false,
    trackClicks: false,
    countOpens: false,
    listUnsubscribe: false,
  },
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
    {
      id: 'step-c',
      kind: 'task',
      delayBusinessDays: 2,
      taskKind: 'linkedin',
      title: 'Connect on LinkedIn',
    },
  ],
} as OutreachSequence

describe.each([
  ['a stored three-step sequence', stored],
  ['a new sequence', null],
])('one keystroke in the sequence editor, on %s (AGL-3423)', (_name, sequence) => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let unmount: () => Promise<void>
  let editor: HTMLElement

  beforeEach(async () => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    const { OutreachSequenceEditor } = jest.requireActual<
      typeof import('./sequence-editor')
    >('./sequence-editor')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    editor = document.createElement('div')
    document.body.appendChild(editor)
    const root = client.createRoot(editor)
    await react.act(async () => {
      root.render(
        react.createElement(OutreachSequenceEditor, {
          orgId: 'org-1',
          orgMount: {
            orgId: 'org-1',
            hosts: [{ id: 'host-1', name: 'Example Shop', subdomain: 'shop' }],
            hostsReady: true,
            orgSlug: 'acme',
            hostsPath: '/acme/hosts',
          } as OutreachSequenceEditorProps['orgMount'],
          sequence,
          settings,
          mailboxes,
          mailboxesPath: '/acme/outreach/mailboxes',
          onSaved: () => undefined,
        }),
      )
    })
    // The countries are chips: the field a redraw per keystroke drove into #185.
    expect(within(editor).getByText('United States')).toBeTruthy()
    unmount = async () => {
      await react.act(async () => root.unmount())
      editor.remove()
    }
  })

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  const type = async (field: HTMLInputElement | HTMLTextAreaElement) => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setValue = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    const before = field.value
    counter.reset()
    await react.act(async () => {
      setValue?.call(field, `${before}a`)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(field.value).toBe(`${before}a`)
  }

  const step = (number: number) =>
    within(editor).getByRole('region', { name: new RegExp(`^Step ${number} `) })

  it('redraws only the Name typed into: no step, no preview, no picker', async () => {
    await type(within(editor).getByLabelText('Name') as HTMLInputElement)
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    expect(counter.rendered('OutreachStepCard')).toBe(0)
    expect(counter.rendered('OutreachSequencePreview')).toBe(0)
  })

  it('redraws only the Body typed into, and the preview of it, no picker', async () => {
    await type(within(step(1)).getByLabelText('Body') as HTMLTextAreaElement)
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    // Its own step; the others show nothing of it.
    expect(counter.rendered('OutreachStepCard')).toBe(1)
    expect(counter.rendered('OutreachSequencePreview')).toBe(1)
  })

  it('redraws only the Subject typed into, and what quotes it, no picker', async () => {
    await type(within(step(1)).getByLabelText('Subject') as HTMLInputElement)
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    // Its own step, and a reply in its thread, which quotes the subject.
    expect(counter.rendered('OutreachStepCard')).toBeLessThanOrEqual(2)
  })

  if (sequence) {
    it('redraws only the task Title typed into, no picker', async () => {
      await type(within(step(3)).getByLabelText('Title') as HTMLInputElement)
      expect(counter.rendered('Autocomplete')).toBe(0)
      expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
      expect(counter.rendered('OutreachStepCard')).toBe(1)
    })
  }
})
