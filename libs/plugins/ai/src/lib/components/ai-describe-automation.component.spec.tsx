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
 * "Describe it" on the Automation page's Actions (AGL-2919), mounted through
 * the `hostAutomations` zone's props: absent while the jobs route says the
 * feature is not this workspace's, the description it sends is a `workflow`
 * draft job for this site, and what it shows is the job's own account — the
 * draft switched off with what to fill in, or why nothing was drafted — with
 * the draft opened in the Actions editor through the zone.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('util').TextEncoder
}

// ONE held object for the whole file: a fresh double each render would turn
// the probe's effect into a loop.
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

import type { ConsoleHostAutomationsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiDescribeAutomationButton, { AI_AUTOMATION_BRIEF_COPY } from './ai-describe-automation.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

const copy = AI_AUTOMATION_BRIEF_COPY

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

/** An SSE body that delivers the given frames, then ends; `open` never ends. */
function sse(events: unknown[], open = false) {
  const chunks = events.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (chunks.length) return { done: false, value: chunks.shift() }
          if (open) return new Promise(() => undefined)
          return { done: true, value: undefined }
        },
      }),
    },
  }
}

function job(patch: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'workflow',
    status: 'queued',
    brief: 'When the newsletter form is submitted, welcome them',
    batch: null,
    steps: [],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-09-16T20:00:00.000Z',
    updatedAt: '2026-09-16T20:00:00.000Z',
    error: null,
    running: false,
    plan: null,
    review: null,
    ...patch,
  }
}

const DRAFTED = job({
  status: 'done',
  outputs: [
    {
      resource: 'workflow',
      id: 'job-1',
      versionId: null,
      hostId: 'host-1',
      hostSubdomain: 'shop',
      label: 'Welcome newsletter sign-ups',
      note: 'It is off until you switch it on. Fill in its placeholder first — Step 3: the text (“your phone number”).',
    },
  ],
})

let openAction: jest.Mock

const zoneProps = (patch: Partial<ConsoleHostAutomationsZoneProps> = {}): ConsoleHostAutomationsZoneProps => ({
  hostId: 'host-1',
  orgId: 'org-1',
  openAction,
  ...patch,
})

/** The route answers the probe, the create door, and the job's events. */
function routes(answers: { create?: unknown; events?: unknown }) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/ai/jobs?')) return json({ jobs: [] })
    if (url === '/api/ai/jobs' && init?.method === 'POST') return answers.create ?? json({ job: job() })
    if (url.startsWith('/api/ai/jobs/job-1/events?orgId=org-1')) return answers.events ?? sse([])
    throw new Error(`unexpected ${url}`)
  })
}

async function draftFrom(text: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Describe it' }))
  fireEvent.change(screen.getByLabelText(copy.briefLabel), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: copy.submit }))
}

beforeEach(() => {
  mockFetch.mockReset()
  forgetAiJobsVerdicts()
  openAction = jest.fn(() => true)
})

afterEach(() => {
  // The whole flow is the jobs route: nothing here writes an automation.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

describe('whether the button is here at all', () => {
  it.each([
    ['the route is not released to this workspace', 404],
    ['the plan or the member may not generate', 403],
  ])('stays absent when %s', async (_why, status) => {
    mockFetch.mockResolvedValue(json({ error: 'No' }, status))
    const { container } = render(<AiDescribeAutomationButton {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('asks the route once however many controls ask, and nothing while the page has no org', async () => {
    routes({})
    render(
      <>
        <AiDescribeAutomationButton {...zoneProps()} />
        <AiDescribeAutomationButton {...zoneProps()} />
        <AiDescribeAutomationButton {...zoneProps({ orgId: undefined })} />
      </>,
    )
    expect(await screen.findAllByRole('button', { name: 'Describe it' })).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('drafting', () => {
  it('sends a draft job for this site, and opens the draft it wrote in the Actions editor', async () => {
    routes({ events: sse([{ type: 'state', job: job({ status: 'running' }) }, { type: 'state', job: DRAFTED }]) })
    render(<AiDescribeAutomationButton {...zoneProps()} />)
    await draftFrom('  When the newsletter form is submitted, welcome them  ')

    expect(await screen.findByText('Drafted: Welcome newsletter sign-ups')).toBeTruthy()
    const create = mockFetch.mock.calls.find(([url, init]) => url === '/api/ai/jobs' && init?.method === 'POST')
    expect(JSON.parse(create?.[1].body)).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'workflow',
      brief: 'When the newsletter form is submitted, welcome them',
      inputs: { mode: 'draft' },
    })
    // The job's own account of what to fill in, and that it is off.
    expect(screen.getByText(/It is off until you switch it on\. Fill in its placeholder first/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: copy.review }))
    expect(openAction).toHaveBeenCalledWith('job-1')
    await waitFor(() => expect(screen.queryByText(copy.title)).toBeNull())
  })

  it('says the draft is drafting while the job runs, and that it will be in the list', async () => {
    routes({ events: sse([{ type: 'state', job: job({ status: 'running' }) }], true) })
    render(<AiDescribeAutomationButton {...zoneProps()} />)
    await draftFrom('Tag everyone who books a call')
    expect(await screen.findByText(copy.started)).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.review })).toBeNull()
  })

  it('keeps the dialog open with word that the draft is coming when the list has not read it yet', async () => {
    openAction.mockReturnValue(false)
    routes({ events: sse([{ type: 'state', job: DRAFTED }]) })
    render(<AiDescribeAutomationButton {...zoneProps()} />)
    await draftFrom('Welcome new sign-ups')
    fireEvent.click(await screen.findByRole('button', { name: copy.review }))
    expect(await screen.findByText(copy.notListed)).toBeTruthy()
    expect(screen.getByText(copy.title)).toBeTruthy()
  })

  it('says why nothing was drafted, in the job’s own words', async () => {
    routes({
      events: sse([
        {
          type: 'state',
          job: job({
            status: 'failed',
            error: 'This automation needs the CRM, which this workspace’s plan does not include, so nothing was drafted.',
          }),
        },
      ]),
    })
    render(<AiDescribeAutomationButton {...zoneProps()} />)
    await draftFrom('Make every sign-up a lead')
    expect(await screen.findByText(/needs the CRM/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.review })).toBeNull()
  })

  it('says what a job stopped for a person is waiting on', async () => {
    routes({
      create: json({
        job: job({
          status: 'needs_review',
          review: { reason: 'limit', message: 'interactions and actions are capped at 500 per site', findings: [] },
        }),
      }),
    })
    render(<AiDescribeAutomationButton {...zoneProps()} />)
    await draftFrom('Welcome new sign-ups')
    expect(await screen.findByText('interactions and actions are capped at 500 per site')).toBeTruthy()
    // A settled job is not followed.
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/events'))).toBe(false)
  })

  it('says why the route refused, and keeps the description to try again', async () => {
    routes({ create: json({ error: 'Your AI credits are used up' }, 402) })
    render(<AiDescribeAutomationButton {...zoneProps()} />)
    await draftFrom('Welcome new sign-ups')
    expect(await screen.findByText('Your AI credits are used up')).toBeTruthy()
    expect((screen.getByLabelText(copy.briefLabel) as HTMLTextAreaElement).value).toBe('Welcome new sign-ups')
  })

  it('will not send an empty description', async () => {
    routes({})
    render(<AiDescribeAutomationButton {...zoneProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Describe it' }))
    fireEvent.change(screen.getByLabelText(copy.briefLabel), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: copy.submit }).hasAttribute('disabled')).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
