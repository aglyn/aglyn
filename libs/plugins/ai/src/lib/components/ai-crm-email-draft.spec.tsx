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
 * "Draft the message" in the CRM composer (AGL-2917), mounted through the
 * `recordEmail` zone's props: it recalls no earlier draft, sends what the
 * member asked as the brief, and puts the draft in the composer through
 * `proposeDraft`. Nothing it reaches sends an email.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: () => null,
}))

import type { ConsoleRecordEmailZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiCrmEmailDraft from './ai-crm-email-draft.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const JOB = {
  id: 'job-8',
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'crm',
  status: 'done',
  brief: 'Follow up on the quote',
  batch: null,
  steps: [],
  outputs: [
    { resource: 'crm', id: 'email:lead:l-1', hostId: 'host-1', label: 'CRM email draft', proposal: { kind: 'email', record: { kind: 'lead', id: 'l-1' } } },
  ],
  creditsReserved: 0,
  creditsSpent: 0,
  createdBy: 'u1',
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:05.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
}

let mockFetch: jest.Mock
let routes: Record<string, () => unknown>
const proposeDraft = jest.fn()

const props = (patch: Partial<ConsoleRecordEmailZoneProps> = {}): ConsoleRecordEmailZoneProps => ({
  hostId: 'host-1',
  orgId: 'org-1',
  record: { kind: 'lead', id: 'l-1', name: 'Sam Rivera' },
  subject: '',
  body: '',
  proposeDraft,
  ...patch,
})

beforeEach(() => {
  proposeDraft.mockReset()
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

describe('a draft for the composer', () => {
  it('asks what the member typed, and puts the draft in the composer', async () => {
    routes['GET /api/ai/jobs'] = () => json({ jobs: [JOB] })
    routes['POST /api/ai/jobs'] = () => json({ job: JOB })
    routes['GET /api/ai/crm/job-8'] = () =>
      json({
        answer: {
          jobId: 'job-8',
          hostId: 'host-1',
          createdBy: 'u1',
          proposal: { kind: 'email', record: { kind: 'lead', id: 'l-1' }, subject: 'Your quote', body: 'Hi {{lead.firstName}},\n\nFollowing up.' },
        },
      })
    render(<AiCrmEmailDraft {...props()} />)
    const draft = await screen.findByRole('button', { name: 'Draft the message' })
    // An earlier draft is not recalled: the verdict is the only read.
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/api/ai/jobs?orgId=org-1&limit=1'])
    expect((draft as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('What should the email say?'), { target: { value: '  Follow up on the quote  ' } })
    fireEvent.click(draft)
    await waitFor(() => expect(proposeDraft).toHaveBeenCalled())
    expect(proposeDraft).toHaveBeenCalledWith({ subject: 'Your quote', body: 'Hi {{lead.firstName}},\n\nFollowing up.' }, 'job-8')
    const [, init] = mockFetch.mock.calls.find(([, request]) => request?.method === 'POST') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'crm',
      brief: 'Follow up on the quote',
      inputs: { task: 'email', record: 'lead', recordId: 'l-1' },
    })
  })

  it('says why a draft could not be started, and puts nothing in the composer', async () => {
    routes['GET /api/ai/jobs'] = () => json({ jobs: [] })
    routes['POST /api/ai/jobs'] = () => json({ error: 'Turn on the CRM for this site before using AI with it.' }, 403)
    render(<AiCrmEmailDraft {...props()} />)
    fireEvent.change(await screen.findByLabelText('What should the email say?'), { target: { value: 'Say thanks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the message' }))
    await screen.findByText('Turn on the CRM for this site before using AI with it.')
    expect(proposeDraft).not.toHaveBeenCalled()
  })

  it('draws nothing on a company, which has nobody to write to', () => {
    const { container } = render(<AiCrmEmailDraft {...props({ record: { kind: 'company', id: 'co-1', name: 'Harbor' } })} />)
    expect(container.textContent).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stays absent while the route says the feature does not exist', async () => {
    routes['GET /api/ai/jobs'] = () => json({ error: "This workspace's plan does not include that feature" }, 403)
    const { container } = render(<AiCrmEmailDraft {...props()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
