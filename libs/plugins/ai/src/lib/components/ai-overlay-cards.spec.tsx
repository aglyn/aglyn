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
 * The two overlay doors (AGL-3603), mounted through the zones the marketing
 * plugin's overlays list hosts.
 *
 * What it proves: neither door is drawn where the jobs route says the
 * workspace has no generation; "Write with AI" sends the copy as it stands
 * and fills the editor only when asked; "Create with AI" hands the copy to the
 * list's own create path and writes nothing itself.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('util').TextEncoder
}

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-1' : null),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

import {
  AiCreateOverlayButton,
  AiOverlayEditorCard,
  aiOverlayCurrentCopy,
  aiOverlayJobInputs,
  type AiOverlayEditorCardProps,
} from './ai-overlay-cards.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const TRIGGERS = [
  { id: 'delay', label: 'After a delay', unit: 'seconds' as const, min: 0, max: 120 },
  { id: 'scroll', label: 'On scroll', unit: 'percent' as const, min: 1, max: 100 },
  { id: 'exit', label: 'On exit intent', unit: null, min: 0, max: 0 },
]
const LIMITS = { name: 80, text: 160, headline: 90, body: 400, ctaLabel: 60 }

const PROPOSAL = {
  task: 'overlay',
  kind: 'popup',
  name: 'Consultation popup',
  text: '',
  headline: 'Book a free call',
  body: 'Talk through your project with us.',
  ctaLabel: 'Book now',
  trigger: 'scroll',
  triggerValue: 40,
  rationale: 'Leads with the free call.',
}

function job(proposal: Record<string, unknown> = PROPOSAL) {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'text',
    status: 'done',
    brief: 'Book a call',
    batch: null,
    steps: [],
    outputs: [{ resource: 'text', id: 'draft', hostId: 'host-1', label: 'Popup copy', text: '', proposal }],
    creditsReserved: 0,
    creditsSpent: 1,
    createdBy: 'u1',
    createdAt: '2026-10-06T12:00:00.000Z',
    updatedAt: '2026-10-06T12:00:05.000Z',
    error: null,
    plan: null,
    review: null,
  }
}

/** The jobs route's verdict, then the create door; nothing else is reached. */
function routes(answers: { verdict?: () => unknown; create?: () => unknown }) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/ai/jobs') {
      return Promise.resolve(answers.create?.() ?? json({ error: 'no create' }, 500))
    }
    if (url.startsWith('/api/ai/jobs?')) return Promise.resolve(answers.verdict?.() ?? json({ jobs: [] }))
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
  })
}

const created = () => {
  const call = mockFetch.mock.calls.find(([, init]) => init?.method === 'POST')
  return call ? JSON.parse(String(call[1].body)) : null
}

const proposeValues = jest.fn()

const editorProps = (patch: Partial<AiOverlayEditorCardProps> = {}): AiOverlayEditorCardProps => ({
  hostId: 'host-1',
  overlayId: 'ov-1',
  kind: 'popup',
  copy: {
    name: 'Spring',
    text: '',
    headline: 'Spring offer',
    body: 'Our spring offer is on.',
    ctaLabel: 'See it',
    ctaHref: '/spring',
    trigger: 'delay',
    triggerValue: 3,
  },
  proposeValues,
  limits: LIMITS,
  triggers: TRIGGERS,
  ...patch,
})

beforeEach(() => {
  jest.clearAllMocks()
  forgetAiJobsVerdicts()
})

describe('the job each door asks for', () => {
  it('is a text job asked for overlay copy, carrying the zone’s limits and triggers', () => {
    expect(aiOverlayJobInputs('popup', { limits: LIMITS, triggers: TRIGGERS }, 'Spring offer')).toEqual({
      task: 'overlay',
      overlayKind: 'popup',
      triggers: 'delay:0-120,scroll:1-100,exit',
      limit_name: '80',
      limit_text: '160',
      limit_headline: '90',
      limit_body: '400',
      limit_ctaLabel: '60',
      current: 'Spring offer',
    })
  })

  it('sends a popup’s copy as it stands, and never its link', () => {
    const current = aiOverlayCurrentCopy('popup', editorProps().copy)
    expect(current).toBe('Spring offer\n\nOur spring offer is on.\n\nButton: See it')
    expect(current).not.toContain('/spring')
  })
})

describe('whether either door is here at all', () => {
  it('stays absent while the jobs route refuses the workspace', async () => {
    routes({ verdict: () => json({ error: 'Not found' }, 404) })
    const editor = render(<AiOverlayEditorCard {...editorProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(editor.container.textContent).toBe('')

    forgetAiJobsVerdicts()
    const button = render(
      <AiCreateOverlayButton hostId="host-1" limits={LIMITS} triggers={TRIGGERS} createOverlayDraft={jest.fn()} />,
    )
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(1))
    expect(button.container.textContent).toBe('')
    expect(created()).toBeNull()
  })
})

describe('Write with AI, in the overlay editor', () => {
  it('fills the editor only when asked, and with the checked fields alone', async () => {
    routes({ create: () => json({ job: job() }) })
    render(<AiOverlayEditorCard {...editorProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write with AI' }))

    expect(await screen.findByText('Book a free call')).toBeTruthy()
    expect(screen.getByText('Opens: On scroll: 40%')).toBeTruthy()
    expect(created()).toMatchObject({ orgId: 'org-1', hostId: 'host-1', kind: 'text', inputs: { task: 'overlay', overlayKind: 'popup' } })
    expect(proposeValues).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Put in the fields' }))
    expect(proposeValues).toHaveBeenCalledWith(
      {
        name: 'Consultation popup',
        headline: 'Book a free call',
        body: 'Talk through your project with us.',
        ctaLabel: 'Book now',
        trigger: 'scroll',
        triggerValue: 40,
      },
      'job-1',
    )
  })

  it('says why when the door refuses', async () => {
    routes({ create: () => json({ error: 'Your role does not include Generate with AI' }, 403) })
    render(<AiOverlayEditorCard {...editorProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write with AI' }))
    expect(await screen.findByText('Your role does not include Generate with AI')).toBeTruthy()
    expect(proposeValues).not.toHaveBeenCalled()
  })
})

describe('Create with AI, beside New bar and New popup', () => {
  it('hands the copy to the list’s own create path, once, and closes', async () => {
    routes({ create: () => json({ job: job() }) })
    const createOverlayDraft = jest.fn().mockResolvedValue({ ok: true, id: 'ov-9' })
    render(
      <AiCreateOverlayButton
        hostId="host-1"
        limits={LIMITS}
        triggers={TRIGGERS}
        createOverlayDraft={createOverlayDraft}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))
    fireEvent.change(screen.getByLabelText('What is the popup for?'), {
      target: { value: 'Ask readers to book a free call' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create the overlay' }))

    await waitFor(() => expect(createOverlayDraft).toHaveBeenCalledTimes(1))
    expect(createOverlayDraft).toHaveBeenCalledWith('popup', expect.objectContaining({ body: 'Talk through your project with us.' }))
    expect(created()).toMatchObject({ brief: 'Ask readers to book a free call', inputs: { overlayKind: 'popup' } })
    await waitFor(() => expect(screen.queryByText('Create an overlay with AI')).toBeNull())
  })

  it('keeps the dialog open with the reason when the list could not save it', async () => {
    routes({ create: () => json({ job: job() }) })
    const createOverlayDraft = jest.fn().mockResolvedValue({ ok: false, error: 'There was no popup body to save.' })
    render(
      <AiCreateOverlayButton
        hostId="host-1"
        limits={LIMITS}
        triggers={TRIGGERS}
        createOverlayDraft={createOverlayDraft}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))
    fireEvent.change(screen.getByLabelText('What is the popup for?'), { target: { value: 'A popup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create the overlay' }))
    expect(await screen.findByText('There was no popup body to save.')).toBeTruthy()
    expect(createOverlayDraft).toHaveBeenCalledTimes(1)
  })
})
