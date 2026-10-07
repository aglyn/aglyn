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
 * "Create with AI" on the workspace's Org automations (AGL-3603), mounted
 * through the `orgAutomations` zone's props: drawn from the shell's gates
 * alone, asking nothing until it is used (AGL-3601); the description is a `workflow` draft
 * job with no site, carrying the vocabulary the zone handed over; and the
 * proposal opens through the zone's `propose`, which writes nothing.
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
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

import type { ConsoleOrgAutomationsZoneProps } from './ai-automation-zones'
import AiDescribeOrgAutomationButton, { AI_ORG_AUTOMATION_COPY } from './ai-describe-org-automation.component'
import { AI_UPSELL_COPY } from './ai-upsell-dialog.component'

const copy = AI_ORG_AUTOMATION_COPY

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

function sse(events: unknown[]) {
  const chunks = events.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
      }),
    },
  }
}

const AUTOMATION = {
  name: 'Welcome every booking',
  trigger: { event: 'booking' },
  steps: [{ type: 'addContactTag', tag: 'booked' }],
}

function job(patch: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: null,
    kind: 'workflow',
    status: 'queued',
    brief: 'Tag every booking',
    batch: null,
    steps: [],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-10-07T15:00:00.000Z',
    updatedAt: '2026-10-07T15:00:00.000Z',
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
      resource: 'orgAutomation',
      id: 'proposal',
      hostId: null,
      hostSubdomain: null,
      label: AUTOMATION.name,
      note: 'Nothing is saved yet.',
      proposal: { automation: AUTOMATION },
    },
  ],
})

let propose: jest.Mock

const zoneProps = (): ConsoleOrgAutomationsZoneProps => ({
  orgId: 'org-1',
  triggers: ['booking', 'lead'],
  steps: ['addContactTag', 'sendEmail'],
  propose,
})

function routes(answers: { probe?: unknown; events?: unknown } = {}) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/ai/jobs?')) return answers.probe ?? json({ jobs: [] })
    if (url === '/api/ai/jobs' && init?.method === 'POST') return json({ job: job() })
    if (url.startsWith('/api/ai/jobs/job-1/events?orgId=org-1')) return answers.events ?? sse([{ type: 'state', job: DRAFTED }])
    throw new Error(`unexpected ${url}`)
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  propose = jest.fn(() => true)
})

describe('Create with AI on Org automations', () => {
  it('draws at once and asks nothing of a server until it is used (AGL-3601)', () => {
    routes()
    render(<AiDescribeOrgAutomationButton {...zoneProps()} />)
    expect(screen.getByRole('button', { name: copy.create })).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('opens the AI add-on on a plan without it, and asks nothing', () => {
    routes()
    render(<AiDescribeOrgAutomationButton {...zoneProps()} entitled={false} upgrade={{ billingHref: '/acme/billing#addons', canManageBilling: true }} />)
    fireEvent.click(screen.getByRole('button', { name: copy.create }))
    expect(screen.getByText(AI_UPSELL_COPY.workflow.title)).toBeTruthy()
    expect(screen.queryByLabelText(copy.label)).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('asks for a workspace draft with no site and the zone’s vocabulary, and opens the proposal unsaved', async () => {
    routes()
    render(<AiDescribeOrgAutomationButton {...zoneProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: copy.create }))
    fireEvent.change(screen.getByLabelText(copy.label), { target: { value: 'Tag every booking' } })
    fireEvent.click(screen.getByRole('button', { name: copy.submit }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/ai/jobs', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(
      (mockFetch.mock.calls.find(([url, init]) => url === '/api/ai/jobs' && init?.method === 'POST')?.[1] as RequestInit)
        .body as string,
    )
    expect(body).toEqual({
      orgId: 'org-1',
      hostId: null,
      kind: 'workflow',
      brief: 'Tag every booking',
      inputs: { mode: 'draft', scope: 'org', triggers: 'booking,lead', steps: 'addContactTag,sendEmail' },
    })

    fireEvent.click(await screen.findByRole('button', { name: copy.open }))
    expect(propose).toHaveBeenCalledWith(AUTOMATION)
    await waitFor(() => expect(screen.queryByRole('button', { name: copy.open })).toBeNull())
  })

  it('says so when the editor could not take it, and stays open', async () => {
    propose = jest.fn(() => false)
    routes()
    render(<AiDescribeOrgAutomationButton {...zoneProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: copy.create }))
    fireEvent.change(screen.getByLabelText(copy.label), { target: { value: 'Tag every booking' } })
    fireEvent.click(screen.getByRole('button', { name: copy.submit }))
    fireEvent.click(await screen.findByRole('button', { name: copy.open }))
    expect(await screen.findByText(copy.notOpened)).toBeTruthy()
  })
})
