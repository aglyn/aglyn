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
 * "Explain it" in a saved automation's editor, and "Why did this fail?" on a
 * failed run (AGL-2919), mounted through the `automationEditor` and
 * `automationRun` zones' props: each is absent while the jobs route says the
 * feature is not this workspace's, asks that route once however many runs
 * the history shows, sends a `workflow` job naming the automation (and the
 * run), and shows the explanation the job wrote — changing nothing.
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

import type { ConsoleAutomationTarget } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import {
  AI_AUTOMATION_EXPLAIN_COPY,
  AiExplainAutomation,
  AiExplainRunFailure,
} from './ai-explain-automation.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

const EXPLAIN = AI_AUTOMATION_EXPLAIN_COPY.explain
const DIAGNOSE = AI_AUTOMATION_EXPLAIN_COPY.diagnose
const TARGET: ConsoleAutomationTarget = { type: 'action', id: 'act-1', name: 'Welcome a new lead' }

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

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
    id: 'job-7',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'workflow',
    status: 'queued',
    brief: 'Explain it',
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

const explained = (id: string, text: string) =>
  job({
    status: 'done',
    outputs: [{ resource: 'text', id, hostId: 'host-1', hostSubdomain: 'shop', label: 'How it works', text }],
  })

function routes(answers: { create?: () => unknown; events?: () => unknown }) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/ai/jobs?')) return json({ jobs: [] })
    if (url === '/api/ai/jobs' && init?.method === 'POST') return answers.create?.() ?? json({ job: job() })
    if (url.startsWith('/api/ai/jobs/job-7/events?orgId=org-1')) return answers.events?.() ?? sse([])
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
  // Only the jobs route: neither control saves, switches or runs an automation.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

describe('Explain it', () => {
  it('stays absent when the feature is not this workspace’s', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container } = render(<AiExplainAutomation hostId="host-1" orgId="org-1" target={TARGET} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('explains the saved automation it is open on, and says it reads what is saved', async () => {
    const text = 'When a contact is created, this welcomes them.\n\nWhat it does:\n1. It starts when a contact is created.'
    routes({ events: () => sse([{ type: 'state', job: job({ status: 'running' }) }, { type: 'state', job: explained('explanation', text) }]) })
    render(<AiExplainAutomation hostId="host-1" orgId="org-1" target={TARGET} />)
    fireEvent.click(await screen.findByRole('button', { name: EXPLAIN.action }))

    expect(await screen.findByText(/When a contact is created, this welcomes them\./)).toBeTruthy()
    expect(created()).toEqual([
      {
        orgId: 'org-1',
        hostId: 'host-1',
        kind: 'workflow',
        brief: 'Explain what “Welcome a new lead” does, and anything in it worth checking.',
        inputs: { mode: 'explain', targetType: 'action', targetId: 'act-1' },
      },
    ])
    expect(screen.getByText(EXPLAIN.saved)).toBeTruthy()
    expect(screen.getByRole('button', { name: EXPLAIN.again })).toBeTruthy()
  })

  it('shows its progress while the job runs, and why there is no explanation when it fails', async () => {
    routes({ events: () => sse([{ type: 'state', job: job({ status: 'running' }) }], true) })
    const { unmount } = render(<AiExplainAutomation hostId="host-1" orgId="org-1" target={TARGET} />)
    fireEvent.click(await screen.findByRole('button', { name: EXPLAIN.action }))
    expect(await screen.findByText(EXPLAIN.running)).toBeTruthy()
    expect(screen.getByRole('button', { name: EXPLAIN.action }).hasAttribute('disabled')).toBe(true)
    unmount()

    routes({ events: () => sse([{ type: 'state', job: job({ status: 'failed', error: 'That automation no longer exists.' }) }]) })
    render(<AiExplainAutomation hostId="host-1" orgId="org-1" target={{ ...TARGET, type: 'workflow', id: 'wf-2' }} />)
    fireEvent.click(await screen.findByRole('button', { name: EXPLAIN.action }))
    expect(await screen.findByText('That automation no longer exists.')).toBeTruthy()
    expect(created()[1].inputs).toEqual({ mode: 'explain', targetType: 'workflow', targetId: 'wf-2' })
  })
})

describe('Why did this fail?', () => {
  it('asks the route once for every failed run in the history', async () => {
    routes({})
    render(
      <>
        {['run-1', 'run-2', 'run-3'].map((runId) => (
          <AiExplainRunFailure key={runId} hostId="host-1" orgId="org-1" target={TARGET} runId={runId} />
        ))}
      </>,
    )
    expect(await screen.findAllByRole('button', { name: DIAGNOSE.action })).toHaveLength(3)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('explains the run it is drawn on, and shows the same answer again without asking again', async () => {
    routes({
      events: () =>
        sse([{ type: 'state', job: explained('diagnosis', 'The list the step names was deleted.\n\nHow to fix it:\n- Pick another list.') }]),
    })
    render(<AiExplainRunFailure hostId="host-1" orgId="org-1" target={TARGET} runId="run-9" />)
    fireEvent.click(await screen.findByRole('button', { name: DIAGNOSE.action }))

    expect(await screen.findByText(/The list the step names was deleted\./)).toBeTruthy()
    expect(screen.getByText(DIAGNOSE.title)).toBeTruthy()
    expect(created()).toEqual([
      {
        orgId: 'org-1',
        hostId: 'host-1',
        kind: 'workflow',
        brief: 'Why did a run of “Welcome a new lead” fail, and how can it be fixed?',
        inputs: { mode: 'diagnose', targetType: 'action', targetId: 'act-1', runId: 'run-9' },
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText(DIAGNOSE.title)).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: DIAGNOSE.action }))
    expect(await screen.findByText(/The list the step names was deleted\./)).toBeTruthy()
    expect(created()).toHaveLength(1)
  })

  it('says why the route refused, and asks again only when asked to', async () => {
    let refuse = true
    routes({
      create: () => (refuse ? json({ error: 'That run did not fail, so there is nothing to explain.' }, 400) : undefined),
      events: () => sse([{ type: 'state', job: explained('diagnosis', 'A webhook answered 500.') }]),
    })
    render(<AiExplainRunFailure hostId="host-1" orgId="org-1" target={TARGET} runId="run-9" />)
    fireEvent.click(await screen.findByRole('button', { name: DIAGNOSE.action }))
    expect(await screen.findByText('That run did not fail, so there is nothing to explain.')).toBeTruthy()

    refuse = false
    fireEvent.click(screen.getByRole('button', { name: DIAGNOSE.again }))
    expect(await screen.findByText('A webhook answered 500.')).toBeTruthy()
    expect(created()).toHaveLength(2)
  })
})
