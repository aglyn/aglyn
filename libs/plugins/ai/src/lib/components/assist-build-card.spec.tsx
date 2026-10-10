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
 * The Assist build card when a Free build runs out of credits mid-build, and
 * when its Try again is past what is left (AGL-3722): paused with Resume and
 * Upgrade, never "failed"; the retry asks before it runs.
 */

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('./ai-job-events', () => ({ __esModule: true, followAiJobEvents: jest.fn(async () => undefined) }))

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { ASSIST_BUILD_ACTION_ID, type AssistBuildProposal } from '../model/assist-build'
import { AI_CREDITS_CONFIRM_CODE } from '../model/ai-credit-estimate'
import { AssistBuildCard } from './assist-build-card.component'

const PROPOSAL: AssistBuildProposal = {
  id: ASSIST_BUILD_ACTION_ID,
  hostId: 'host-1',
  brief: 'Two pages and a quote form.',
  publish: false,
  summary: 'Plan two pages and a quote form',
}

const PLAN = {
  reuse: [],
  create: [{ kind: 'form' as const, name: 'Quote', why: 'quotes', duplicateOf: null, fields: [] }],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: null,
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Home',
      seoDescription: 'Home',
      sections: [{ name: 'hero', uses: ['new:Quote'], items: 0 }],
      record: null,
    },
  ],
  status: 'confirmed' as const,
  labels: {},
  proposedAt: '2026-10-09T00:00:00.000Z',
  confirmedAt: '2026-10-09T00:00:00.000Z',
  confirmedBy: 'u1',
}

function job(patch: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'build',
    status: 'needs_input',
    brief: PROPOSAL.brief,
    batch: null,
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 40,
    createdBy: 'u1',
    createdAt: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
    error: 'Your free AI credits for this month are used across your workspaces — upgrade any workspace to keep going.',
    running: false,
    plan: PLAN,
    review: null,
    items: [
      { slot: 'c0', op: 'form', label: 'Quote', status: 'succeeded', attempt: 1, creditsSpent: 29, creditsRefunded: 0, outputs: ['f'] },
      { slot: 'p0', op: 'page', label: 'Home', status: 'pending', attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [] },
    ],
    ...patch,
  } as AiJobSummary
}

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

function card(current: AiJobSummary, onJob = jest.fn()) {
  return render(
    <AssistBuildCard
      proposal={PROPOSAL}
      job={current}
      notice={null}
      orgId="org-1"
      orgSlug="acme"
      user={{ uid: 'u1', getIdToken: async () => 't' } as never}
      onJob={onJob}
      onNotice={jest.fn()}
    />,
  )
}

beforeEach(() => mockFetch.mockReset())

it('a build out of credits mid-build is paused — what is built kept — with Upgrade and Resume, and Resume carries on the same job', async () => {
  const onJob = jest.fn()
  card(job(), onJob)
  const paused = screen.getByText(/^Paused\./)
  expect(paused.textContent).toContain('What is built so far is kept')
  expect(screen.queryByText(/Building each part in turn/)).toBeNull()
  expect(screen.getByText(/Quote — built/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Upgrade' }).getAttribute('href')).toContain('#plans')
  mockFetch.mockResolvedValueOnce(json({ job: job({ status: 'queued', error: null }) }))
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  await waitFor(() => expect(onJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' })))
  const [, url, init] = mockFetch.mock.calls[0]
  expect(url).toBe('/api/ai/jobs/job-1/resume')
  expect(JSON.parse(init.body)).toEqual({ orgId: 'org-1', hostId: 'host-1' })
})

it('a Free Try again past what is left asks first, and runs only on Build what fits', async () => {
  const finished = job({
    status: 'done',
    error: null,
    items: [
      { slot: 'c0', op: 'form', label: 'Quote', status: 'succeeded', attempt: 1, creditsSpent: 29, creditsRefunded: 0, outputs: ['f'] },
      {
        slot: 'p0',
        op: 'page',
        label: 'Home',
        status: 'failed',
        attempt: 1,
        creditsSpent: 4,
        creditsRefunded: 4,
        outputs: [],
        failure: { ours: true, reason: 'step-failure', message: 'It could not be built this time.' },
      },
    ],
  })
  card(finished)
  const retry = screen.getByRole('button', { name: /^Try again what failed · About 6 credits \(up to 100\)$/ })
  const prompt = { likely: 6, p90: 8, ceiling: 100, left: 5, resetsOn: '2026-11-01', smaller: null }
  mockFetch.mockResolvedValueOnce(
    json({ error: 'This build is about 6 credits (up to 100).', code: AI_CREDITS_CONFIRM_CODE, credits: prompt, job: finished }, 409),
  )
  fireEvent.click(retry)
  const go = await screen.findByRole('button', { name: 'Build what fits' })
  expect(screen.getByRole('alert', { name: 'More than your credits left' }).textContent).toContain('You have 5 left')
  mockFetch.mockResolvedValueOnce(json({ job: job({ status: 'queued', error: null }) }))
  fireEvent.click(go)
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
  expect(JSON.parse(mockFetch.mock.calls[1][2].body)).toEqual({
    orgId: 'org-1',
    hostId: 'host-1',
    retry: 'failed-items',
    creditsConfirmed: true,
  })
})
