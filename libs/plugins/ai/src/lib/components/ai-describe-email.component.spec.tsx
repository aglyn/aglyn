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
 * "Create with AI" for email (AGL-3596): on a site's email templates
 * (`hostEmailTemplates`, the email plugin's zone) and on its Campaigns
 * (`hostCampaigns`, the marketing plugin's).
 *
 * Every render goes through the component the AI plugin REGISTERED on the
 * zone, so what is asserted is what that list draws:
 *
 * - each entry is gated as its siblings are, and absent while the jobs route
 *   says the feature is not this workspace's (403 or 404);
 * - the email brief starts an `email` job for this site, with the kind of
 *   email when one is picked; asking for the campaign too starts a
 *   `campaign` job instead, which writes the same design and drafts the
 *   campaign; the Campaigns entry starts a `campaign` job outright;
 * - `reply` — the kind only a platform-composed job sets — is not offered.
 */

import { listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleHostScreensZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

import { AI_PLUGIN_ID } from '../constants'
import { AI_EMAIL_TYPES } from '../jobs/ai-job-email-step'
import { registerAiConsole } from '../plugin'
import {
  AI_BRIEF_NO_CHOICE,
  AI_EMAIL_TYPE_LABELS,
  aiBriefJobInputs,
  aiBriefJobKind,
} from './ai-brief-dialog.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const zoneProps: ConsoleHostScreensZoneProps = { hostId: 'demo-bakery', orgId: 'org-1' }

const registeredOn = (zone: string) =>
  listConsoleWidgets(zone, [AI_PLUGIN_ID]).map(({ widget }) => widget)

function widgetFor(zone: string): ComponentType<ConsoleHostScreensZoneProps> {
  const [widget] = registeredOn(zone)
  if (!widget) throw new Error(`nothing registered on ${zone}`)
  return widget.Component
}

const BRIEF =
  'Announce the autumn menu to the regulars, and point people at the class page to book.'

const startedJob = (kind: string) => ({
  job: {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'demo-bakery',
    kind,
    status: 'needs_review',
    brief: BRIEF,
    batch: null,
    steps: [
      { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
      { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
    ],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    error: null,
    running: false,
    plan: null,
    review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
  },
})

let mockFetch: jest.Mock

beforeAll(() => {
  registerAiConsole()
})

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  // The whole flow is the jobs route: nothing is written or sent from here.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

async function openDialog(zone: string, title: string) {
  const Widget = widgetFor(zone)
  mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
  render(<Widget {...zoneProps} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(title)).toBeTruthy()
  return dialog
}

/** Presses the submit, answering with a job of `kind`, and returns the body sent. */
async function planIt(submit: string, kind: string, said: RegExp) {
  mockFetch.mockResolvedValueOnce(json(startedJob(kind)))
  fireEvent.click(screen.getByRole('button', { name: submit }))
  await screen.findByText(said)
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
  expect(url).toBe('/api/ai/jobs')
  expect(init.method).toBe('POST')
  return JSON.parse(init.body)
}

describe('the entries are registered on the lists an email job and a campaign job fill', () => {
  it.each([
    ['hostEmailTemplates', 'ai-describe-email', 'Describe an email'],
    ['hostCampaigns', 'ai-describe-campaign', 'Describe a campaign'],
  ])('registers on %s, alone, behind aiGenerative and ai.generate', (zone, widgetId, title) => {
    expect(registeredOn(zone)).toEqual([
      expect.objectContaining({
        slot: zone,
        widgetId,
        title,
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
      }),
    ])
  })

  it('registers the products door on productsCreate, alone, gated as its siblings are', () => {
    // The commerce plugin's zone beside Add product (AGL-3596); the door and
    // the card it opens are covered in `ai-products-hub-card.spec`.
    expect(registeredOn('productsCreate')).toEqual([
      expect.objectContaining({
        slot: 'productsCreate',
        widgetId: 'ai-products-create',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
      }),
    ])
  })

  it.each([403, 404])('stays absent when the jobs route answers %s', async (status) => {
    const Widget = widgetFor('hostEmailTemplates')
    mockFetch.mockResolvedValueOnce(json({ error: 'no' }, status))
    const { container } = render(<Widget {...zoneProps} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(String(mockFetch.mock.calls[0][0])).toBe('/api/ai/jobs?orgId=org-1&limit=1')
    // A tick for the verdict to land, and still nothing.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('button', { name: 'Create with AI' })).toBeNull()
  })
})

describe('the email brief', () => {
  it('starts an email job for the site, with no inputs when nothing is picked', async () => {
    await openDialog('hostEmailTemplates', 'Describe an email')
    fireEvent.change(screen.getByLabelText('What is the email for?'), { target: { value: BRIEF } })
    const body = await planIt('Plan the email', 'email', /The email is being planned/)
    expect(body).toEqual({
      orgId: 'org-1',
      hostId: 'demo-bakery',
      kind: 'email',
      brief: BRIEF,
      inputs: {},
    })
  })

  it('sends the picked kind of email, and starts a campaign job when the campaign is asked for', async () => {
    await openDialog('hostEmailTemplates', 'Describe an email')
    fireEvent.change(screen.getByLabelText('What is the email for?'), { target: { value: BRIEF } })
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    fireEvent.click(screen.getByLabelText('Also draft a campaign that sends it'))
    // The dialog now says the job it starts.
    expect(screen.getByRole('button', { name: 'Plan the campaign' })).toBeTruthy()
    const body = await planIt('Plan the campaign', 'campaign', /The campaign is being planned/)
    expect(body).toEqual({
      orgId: 'org-1',
      hostId: 'demo-bakery',
      kind: 'campaign',
      brief: BRIEF,
      inputs: { emailType: 'launch' },
    })
  })

  it('offers no reply, which only a platform-composed job sets', async () => {
    await openDialog('hostEmailTemplates', 'Describe an email')
    const kinds = within(screen.getByRole('group', { name: 'Kind of email (optional)' }))
    expect(kinds.getAllByRole('button').map((chip) => chip.textContent)).toEqual([
      'Welcome',
      'Newsletter',
      'Launch',
      'Cart reminder',
      'Event reminder',
    ])
  })
})

describe('the campaign brief', () => {
  it('starts a campaign job outright, and offers no campaign checkbox', async () => {
    await openDialog('hostCampaigns', 'Describe a campaign')
    expect(screen.queryByLabelText('Also draft a campaign that sends it')).toBeNull()
    fireEvent.change(screen.getByLabelText('What is the campaign’s email for?'), {
      target: { value: BRIEF },
    })
    const body = await planIt('Plan the campaign', 'campaign', /The campaign is being planned/)
    expect(body).toMatchObject({ kind: 'campaign', hostId: 'demo-bakery', inputs: {} })
  })
})

describe('what the dialog sends', () => {
  it('names only kinds the email step knows', () => {
    for (const type of Object.keys(AI_EMAIL_TYPE_LABELS)) expect(type in AI_EMAIL_TYPES).toBe(true)
    expect('reply' in AI_EMAIL_TYPE_LABELS).toBe(false)
  })

  it('starts a campaign job only from an email that asked for one', () => {
    expect(aiBriefJobKind('email', AI_BRIEF_NO_CHOICE)).toBe('email')
    expect(aiBriefJobKind('email', { ...AI_BRIEF_NO_CHOICE, withCampaign: true })).toBe('campaign')
    expect(aiBriefJobKind('page', { ...AI_BRIEF_NO_CHOICE, withCampaign: true })).toBe('page')
    expect(aiBriefJobInputs('campaign', { ...AI_BRIEF_NO_CHOICE, emailType: 'newsletter' })).toEqual({
      emailType: 'newsletter',
    })
    // The kind of email is an email's and a campaign's input alone.
    expect(aiBriefJobInputs('form', { ...AI_BRIEF_NO_CHOICE, emailType: 'newsletter' })).toEqual({})
  })
})
