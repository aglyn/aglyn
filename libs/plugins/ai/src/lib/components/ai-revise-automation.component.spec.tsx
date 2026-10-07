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
 * "Change with AI" and "Fix with AI" in a saved action's editor (AGL-3603),
 * mounted through the `automationEditor` zone's props: absent on a workflow
 * and while the jobs route says the feature is not this workspace's; each
 * sends a `workflow` job in `revise` mode naming the action, and offers the
 * changed copy the job wrote through `openAction` — writing nothing itself.
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

import type { ConsoleAutomationTarget } from './ai-automation-zones'
import { AI_AUTOMATION_REVISE_COPY, AiReviseAutomation } from './ai-revise-automation.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

const COPY = AI_AUTOMATION_REVISE_COPY
const TARGET: ConsoleAutomationTarget = { type: 'action', id: 'act-1', name: 'Welcome a new lead' }

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

function sse(events: unknown[]) {
  const chunks = events.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined },
      }),
    },
  }
}

function job(patch: Record<string, unknown> = {}) {
  return {
    id: 'job-7',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'workflow',
    status: 'queued',
    brief: 'Change it',
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

const drafted = job({
  status: 'done',
  outputs: [
    {
      resource: 'workflow',
      id: 'act-copy',
      versionId: null,
      hostId: 'host-1',
      hostSubdomain: 'shop',
      label: 'Welcome a new lead (revised)',
      note: 'A changed copy of “Welcome a new lead”, which is left as it is. Added: Tag the contact.',
    },
  ],
})

function routes(events: () => unknown = () => sse([])) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/ai/jobs?')) return json({ jobs: [] })
    if (url === '/api/ai/jobs' && init?.method === 'POST') return json({ job: job() })
    if (url.startsWith('/api/ai/jobs/job-7/events?orgId=org-1')) return events()
    throw new Error(`unexpected ${url}`)
  })
}

const created = () =>
  mockFetch.mock.calls
    .filter(([url, init]) => url === '/api/ai/jobs' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(init.body))

beforeEach(() => {
  mockFetch.mockReset()
  forgetAiJobsVerdicts()
})

afterEach(() => {
  // Only the jobs route: the control never saves, switches or runs an automation.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

describe('Change with AI', () => {
  it('stays absent when the feature is not this workspace’s, and on a workflow', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container, unmount } = render(<AiReviseAutomation hostId="host-1" orgId="org-1" target={TARGET} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    unmount()
    forgetAiJobsVerdicts()
    routes()
    const workflow = render(
      <AiReviseAutomation hostId="host-1" orgId="org-1" target={{ ...TARGET, type: 'workflow' }} />,
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(workflow.container.textContent).toBe('')
  })

  it('sends the change as a revise job of the action, and opens the copy it drafted', async () => {
    routes(() => sse([{ type: 'state', job: drafted }]))
    const openAction = jest.fn(() => true)
    render(<AiReviseAutomation hostId="host-1" orgId="org-1" target={TARGET} openAction={openAction} />)
    fireEvent.change(await screen.findByLabelText(COPY.label), { target: { value: 'Also tag them news' } })
    fireEvent.click(screen.getByRole('button', { name: COPY.change }))

    expect(await screen.findByText(/Added: Tag the contact\./)).toBeTruthy()
    expect(created()).toEqual([
      {
        orgId: 'org-1',
        hostId: 'host-1',
        kind: 'workflow',
        brief: 'Also tag them news',
        inputs: { mode: 'revise', targetType: 'action', targetId: 'act-1' },
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: COPY.review }))
    expect(openAction).toHaveBeenCalledWith('act-copy')
  })

  it('fixes with a brief of its own, and says where the copy went when the list has not read it', async () => {
    routes(() => sse([{ type: 'state', job: drafted }]))
    render(<AiReviseAutomation hostId="host-1" orgId="org-1" target={TARGET} openAction={() => false} />)
    fireEvent.click(await screen.findByRole('button', { name: COPY.fix }))
    expect(await screen.findByText(/Added: Tag the contact\./)).toBeTruthy()
    expect(created()[0].brief).toBe(COPY.fixBrief('Welcome a new lead'))
    fireEvent.click(screen.getByRole('button', { name: COPY.review }))
    expect(screen.getByText(COPY.notListed)).toBeTruthy()
  })
})
