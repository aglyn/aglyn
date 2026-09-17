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
 * "Summarize this contact" on a CRM record's page (AGL-2917), mounted through
 * the `recordInsights` zone's props: it stays absent while the jobs route says
 * the feature does not exist, it recalls the newest summary on this site and
 * reads it through the answer door, it asks with a brief that names no one,
 * and a next step or a stage goes to the page's own doors — the card writes
 * nothing and reaches no route but the jobs route and the answer door.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-from-host' : null),
}))

import type { ConsoleRecordInsightsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiCrmRecordCard, { aiCrmDueWords, aiCrmTaskOf } from './ai-crm-record-card.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const job = (patch: Record<string, unknown>) => ({
  id: 'job-1',
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'crm',
  status: 'done',
  brief: 'Summarize this contact',
  batch: null,
  steps: [],
  outputs: [
    {
      resource: 'crm',
      id: 'record:contact:c-1',
      hostId: 'host-1',
      label: 'CRM summary',
      proposal: { kind: 'record', record: { kind: 'contact', id: 'c-1' } },
    },
  ],
  creditsReserved: 0,
  creditsSpent: 0,
  createdBy: 'someone-else',
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:05.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
  ...patch,
})

const answer = (jobId: string, patch: Record<string, unknown> = {}) => ({
  answer: {
    jobId,
    hostId: 'host-1',
    createdBy: 'someone-else',
    proposal: {
      kind: 'record',
      record: { kind: 'contact', id: 'c-1' },
      summary: 'Dana opened the quote on 2026-09-09. The loading dock deal is at Proposal sent.',
      nextStep: { title: 'Call Dana about the budget', kind: 'call', priority: 'high', dueInDays: 2, reason: 'The owner approves budgets.' },
      stage: null,
      standing: null,
      asOf: '2026-09-16',
      ...patch,
    },
  },
})

let mockFetch: jest.Mock
let routes: Record<string, () => unknown>
const proposeTask = jest.fn()
const proposeStage = jest.fn()

const props = (patch: Partial<ConsoleRecordInsightsZoneProps> = {}): ConsoleRecordInsightsZoneProps => ({
  hostId: 'host-1',
  orgId: 'org-1',
  record: { kind: 'contact', id: 'c-1', name: 'Dana Whitfield' },
  proposeTask,
  ...patch,
})

beforeEach(() => {
  proposeTask.mockReset()
  proposeStage.mockReset()
  routes = {}
  mockFetch = jest.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).split('?')[0]}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected ${key}`)
    return route()
  })
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/(jobs|crm\/)/)
})

describe('whether the card is here', () => {
  it('stays absent while the route says the feature does not exist', async () => {
    routes['GET /api/ai/jobs'] = () => json({ error: 'Not found' }, 404)
    const { container } = render(<AiCrmRecordCard {...props()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('draws nothing for a record it cannot summarize, and asks nothing', () => {
    const { container } = render(<AiCrmRecordCard {...props({ record: { kind: 'invoice', id: 'i-1', name: 'x' } })} />)
    expect(container.textContent).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('a record’s summary', () => {
  it('recalls the newest summary on this site any member asked for, through the answer door', async () => {
    routes['GET /api/ai/jobs'] = () =>
      json({
        jobs: [
          job({ id: 'job-other-site', hostId: 'host-2' }),
          job({ id: 'job-seo', kind: 'seo' }),
          job({ id: 'job-1' }),
        ],
      })
    routes['GET /api/ai/crm/job-1'] = () => json(answer('job-1'))
    render(<AiCrmRecordCard {...props()} />)
    await screen.findByText('Dana opened the quote on 2026-09-09. The loading dock deal is at Proposal sent.')
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/ai/jobs?orgId=org-1&limit=20',
      '/api/ai/crm/job-1?orgId=org-1',
    ])
    expect(screen.getByText('Written from the timeline on 2026-09-16.')).toBeTruthy()
    expect(screen.getByText('Call Dana about the budget (Call, high priority, due in 2 days)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(proposeTask).toHaveBeenCalledWith(
      { title: 'Call Dana about the budget', notes: 'The owner approves budgets.', kind: 'call', priority: 'high', dueInDays: 2 },
      'job-1',
    )
    expect(screen.getByRole('button', { name: 'Summarize again' })).toBeTruthy()
  })

  it('asks with a brief that names no one, and shows what comes back', async () => {
    routes['GET /api/ai/jobs'] = () => json({ jobs: [] })
    routes['POST /api/ai/jobs'] = () => json({ job: job({ id: 'job-7', createdBy: 'u1' }) })
    routes['GET /api/ai/crm/job-7'] = () => json(answer('job-7', { nextStep: null }))
    render(<AiCrmRecordCard {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize this contact' }))
    await screen.findByText(/Dana opened the quote/)
    const [, init] = mockFetch.mock.calls.find(([, request]) => request?.method === 'POST') ?? []
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'crm',
      brief: 'Summarize this contact',
      inputs: { task: 'record', record: 'contact', recordId: 'c-1' },
    })
    expect(JSON.stringify(body)).not.toContain('Dana')
    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull()
  })

  it('offers a deal’s stage only when the page can move it there, and hands the move to the page', async () => {
    routes['GET /api/ai/jobs'] = () =>
      json({
        jobs: [
          job({
            id: 'job-3',
            hostId: null,
            outputs: [{ resource: 'crm', id: 'record:deal:d-1', hostId: null, label: 'CRM summary', proposal: { kind: 'record', record: { kind: 'deal', id: 'd-1' } } }],
          }),
        ],
      })
    routes['GET /api/ai/crm/job-3'] = () =>
      json(
        answer('job-3', {
          record: { kind: 'deal', id: 'd-1' },
          nextStep: null,
          stage: { stageId: 'negotiation', stageName: 'Negotiation', reason: 'He asked for a discount on 2026-09-12.' },
        }),
      )
    const stages = [
      { id: 'proposal-sent', name: 'Proposal sent' },
      { id: 'negotiation', name: 'Negotiating' },
    ]
    const deal = { hostId: null, record: { kind: 'deal', id: 'd-1', name: 'Gutters' }, stages, stageId: 'proposal-sent', proposeStage }
    const view = render(<AiCrmRecordCard {...props(deal)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Negotiating' }))
    expect(proposeStage).toHaveBeenCalledWith('negotiation', 'job-3')

    // Already there, or a stage the page does not offer: nothing to move.
    view.unmount()
    render(<AiCrmRecordCard {...props({ ...deal, stageId: 'negotiation' })} />)
    await screen.findByText(/Dana opened the quote/)
    expect(screen.queryByRole('button', { name: /Move to/ })).toBeNull()
  })

  it('shows a lead’s standing, and no next step where the page takes no task', async () => {
    routes['GET /api/ai/jobs'] = () =>
      json({
        jobs: [
          job({
            id: 'job-4',
            outputs: [{ resource: 'crm', id: 'record:lead:l-1', hostId: 'host-1', label: 'CRM summary', proposal: { kind: 'record', record: { kind: 'lead', id: 'l-1' } } }],
          }),
        ],
      })
    routes['GET /api/ai/crm/job-4'] = () =>
      json(answer('job-4', { record: { kind: 'lead', id: 'l-1' }, standing: 'New, from two form captures this week.' }))
    render(<AiCrmRecordCard {...props({ record: { kind: 'lead', id: 'l-1', name: 'Sam' }, proposeTask: undefined })} />)
    await screen.findByText('New, from two form captures this week.')
    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull()
  })

  it('shows nothing the answer door does not serve, and says so after asking', async () => {
    routes['GET /api/ai/jobs'] = () => json({ jobs: [job({ id: 'job-1' })] })
    routes['GET /api/ai/crm/job-1'] = () => json({ error: 'Not found' }, 404)
    render(<AiCrmRecordCard {...props()} />)
    const ask = await screen.findByRole('button', { name: 'Summarize this contact' })
    expect(screen.queryByText(/Dana/)).toBeNull()

    routes['POST /api/ai/jobs'] = () => json({ job: job({ id: 'job-1' }) })
    fireEvent.click(ask)
    await screen.findByText('This suggestion is no longer available. Ask again.')
  })

  it('says why a job failed', async () => {
    routes['GET /api/ai/jobs'] = () => json({ jobs: [] })
    routes['POST /api/ai/jobs'] = () =>
      json({ job: job({ id: 'job-5', status: 'failed', error: 'Reading CRM records requires the Manage data permission' }) })
    render(<AiCrmRecordCard {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize this contact' }))
    await screen.findByText('Reading CRM records requires the Manage data permission')
    expect(mockFetch.mock.calls.some(([url]) => String(url).startsWith('/api/ai/crm/'))).toBe(false)
  })
})

describe('the pieces', () => {
  it('words a due day and turns a next step into the task form’s fields', () => {
    expect([aiCrmDueWords(0), aiCrmDueWords(1), aiCrmDueWords(9)]).toEqual(['due today', 'due tomorrow', 'due in 9 days'])
    expect(aiCrmTaskOf({ title: 'Send it', kind: 'email', priority: 'low', dueInDays: 3, reason: 'Asked for it.' })).toEqual({
      title: 'Send it',
      notes: 'Asked for it.',
      kind: 'email',
      priority: 'low',
      dueInDays: 3,
    })
  })
})
