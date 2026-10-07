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
 * "Create with AI" on the Campaigns section (AGL-3603), the `campaign` job's
 * console door.
 *
 * What it proves: the job it starts is the one the runner can finish — a
 * campaign where the plan sends campaign email, the design alone where it does
 * not — asked by the runner's own check; the site a campaign is placed on is
 * the one named, or the one picked on the organization's hub; and a plan that
 * changed under the dialog is answered with the design-only path.
 */

import { fireEvent, render, screen } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('util').TextEncoder
}

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFetch = jest.fn()
let mockOrg: Record<string, unknown> | undefined = { plan: 'business', billingStatus: 'active' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-1' : null),
  useOrgPlan: () => ({ org: mockOrg, ready: true }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

// The live follow is its own component's to test; here it says what it was handed.
jest.mock('./ai-job-follow.component', () => ({
  AiJobFollow: (props: { job: { kind: string }; intro: string }) => (
    <div>{`following ${props.job.kind}: ${props.intro}`}</div>
  ),
}))

import { AI_CAMPAIGN_PLAN_REFUSAL } from '../jobs/ai-job-campaign-step'
import {
  AI_CAMPAIGN_CREATE_COPY,
  AiCreateCampaignButton,
  aiCampaignJobInputs,
  aiCampaignJobKind,
} from './ai-campaign-create.component'
import { AI_UPSELL_COPY } from './ai-upsell-dialog.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const queued = (kind: string) => ({
  id: 'job-1',
  orgId: 'org-1',
  hostId: 'host-1',
  kind,
  status: 'queued',
  brief: 'Autumn menu',
  batch: null,
  steps: [],
  outputs: [],
  creditsReserved: 1,
  creditsSpent: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T12:00:00.000Z',
  updatedAt: '2026-10-06T12:00:00.000Z',
  error: null,
  plan: null,
  review: null,
})

function routes(create: (body: Record<string, unknown>) => unknown, verdict = () => json({ jobs: [] })) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/ai/jobs') {
      return Promise.resolve(create(JSON.parse(String(init.body))))
    }
    if (url.startsWith('/api/ai/jobs?')) return Promise.resolve(verdict())
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
  })
}

const posted = () =>
  mockFetch.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init.body)))

async function ask(brief = 'Announce the autumn menu') {
  fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))
  fireEvent.change(screen.getByLabelText('What is the campaign for?'), { target: { value: brief } })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOrg = { plan: 'business', billingStatus: 'active' }
})

describe('which job it starts', () => {
  it('asks the runner’s own check: a campaign where the plan sends campaign email, the design alone where not', () => {
    expect(aiCampaignJobKind({ plan: 'business', billingStatus: 'active' })).toBe('campaign')
    expect(aiCampaignJobKind({ plan: 'free' })).toBe('email')
    expect(aiCampaignJobKind(null)).toBe('email')
  })

  it('recognizes the campaign door’s refusal for a plan with no campaign email', () => {
    // The dialog matches on the refusal's opening words; this holds the two together.
    expect(AI_CAMPAIGN_PLAN_REFUSAL.startsWith('Campaign email is not included')).toBe(true)
  })

  it('names the campaign only when the member did', () => {
    expect(aiCampaignJobInputs('  Autumn   menu ')).toEqual({ name: 'Autumn menu' })
    expect(aiCampaignJobInputs('   ')).toEqual({})
  })
})

describe('the door', () => {
  it('draws at once and asks nothing of a server until it is used (AGL-3601)', () => {
    routes(() => json({}))
    render(<AiCreateCampaignButton hostId="host-1" orgId="org-1" sites={[]} />)
    expect(screen.getByRole('button', { name: 'Create with AI' })).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('opens the AI add-on on a plan without it, and asks nothing', () => {
    routes(() => json({}))
    render(
      <AiCreateCampaignButton
        hostId="host-1"
        orgId="org-1"
        sites={[]}
        entitled={false}
        upgrade={{ billingHref: '/acme/billing#addons', canManageBilling: true }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }))
    expect(screen.getByText(AI_UPSELL_COPY.campaign.title)).toBeTruthy()
    expect(screen.queryByLabelText('What is the campaign for?')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('starts a campaign job for the site, and follows it', async () => {
    routes(() => json({ job: queued('campaign') }))
    render(<AiCreateCampaignButton hostId="host-1" orgId="org-1" sites={[]} />)
    await ask()
    fireEvent.click(screen.getByRole('button', { name: AI_CAMPAIGN_CREATE_COPY.campaign.submit }))

    expect(await screen.findByText(/^following campaign:/)).toBeTruthy()
    expect(posted()).toEqual([
      { orgId: 'org-1', hostId: 'host-1', kind: 'campaign', brief: 'Announce the autumn menu', inputs: {} },
    ])
  })

  it('writes the design alone on a plan that sends no campaign email, and says why', async () => {
    mockOrg = { plan: 'free' }
    routes(() => json({ job: queued('email') }))
    render(<AiCreateCampaignButton hostId="host-1" orgId="org-1" sites={[]} />)
    await ask()
    expect(screen.getByText(/does not send campaign email/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: AI_CAMPAIGN_CREATE_COPY.email.submit }))

    await screen.findByText(/^following email:/)
    expect(posted()[0]).toMatchObject({ kind: 'email', hostId: 'host-1' })
  })

  it('offers the design alone when the door refuses the campaign for the plan', async () => {
    routes((body) =>
      body['kind'] === 'campaign' ? json({ error: AI_CAMPAIGN_PLAN_REFUSAL }, 403) : json({ job: queued('email') }),
    )
    render(<AiCreateCampaignButton hostId="host-1" orgId="org-1" sites={[]} />)
    await ask()
    fireEvent.click(screen.getByRole('button', { name: AI_CAMPAIGN_CREATE_COPY.campaign.submit }))

    expect(await screen.findByText(AI_CAMPAIGN_PLAN_REFUSAL)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: AI_CAMPAIGN_CREATE_COPY.email.submit }))
    await screen.findByText(/^following email:/)
    expect(posted().map((body) => body['kind'])).toEqual(['campaign', 'email'])
  })

  it('places a campaign on the site picked on the organization’s hub', async () => {
    routes(() => json({ job: queued('campaign') }))
    render(
      <AiCreateCampaignButton
        hostId={null}
        orgId="org-1"
        sites={[
          { id: 'host-1', name: 'Bakery' },
          { id: 'host-2', name: 'Cafe' },
        ]}
      />,
    )
    await ask()
    fireEvent.mouseDown(screen.getByLabelText('Site'))
    fireEvent.click(await screen.findByRole('option', { name: 'Cafe' }))
    fireEvent.click(screen.getByRole('button', { name: AI_CAMPAIGN_CREATE_COPY.campaign.submit }))

    await screen.findByText(/^following campaign:/)
    expect(posted()[0]).toMatchObject({ orgId: 'org-1', hostId: 'host-2', kind: 'campaign' })
  })

  it('draws nothing on an organization hub with no site to place a campaign on', async () => {
    routes(() => json({}))
    const { container } = render(<AiCreateCampaignButton hostId={null} orgId="org-1" sites={[]} />)
    expect(container.textContent).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
