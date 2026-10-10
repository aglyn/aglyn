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
 * A site's AI jobs page (AGL-3616): each row's menu cancels its job behind
 * the one confirm every Cancel shows, through the same cancel door.
 */

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))
jest.mock('./ai-job-site', () => ({
  __esModule: true,
  useAiJobSite: () => ({ status: 'ready', orgId: 'org-1', name: 'Dog Groomer' }),
}))
jest.mock('./ai-jobs-store', () => ({ __esModule: true, publishAiJob: jest.fn() }))
const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/shared-util-http/authorized-token'),
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_JOB_CANCEL_CONFIRM_COPY } from '../model/ai-job-cancel-copy'
import { AiJobsListPage } from './ai-jobs-list-page.component'

function job(patch: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief: 'A dog groomer',
    steps: [],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 9,
    refundedCredits: 0,
    createdBy: 'u1',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    error: null,
    running: true,
    plan: null,
    review: null,
    ...patch,
  } as unknown as AiJobSummary
}

const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

function renderPage(jobs: AiJobSummary[]) {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (_user: unknown, url: string) =>
    url.endsWith('/cancel')
      ? reply({ changed: true, job: job({ status: 'canceled', running: false, creditsReserved: 0 }) })
      : reply({ jobs }),
  )
  render(<AiJobsListPage hostId="host-1" segments={[]} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
}

const cancelPosts = () => mockFetch.mock.calls.filter(([, url]) => String(url).endsWith('/cancel'))

describe('canceling from a site’s AI jobs page (AGL-3616)', () => {
  it('a running row’s menu cancels it after the confirm, and the row reads Canceled', async () => {
    renderPage([job()])
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for this site job' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cancel job/ }))
    expect(await screen.findByText(AI_JOB_CANCEL_CONFIRM_COPY)).toBeTruthy()
    // Nothing is sent until the person confirms.
    expect(cancelPosts()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }))
    await waitFor(() => expect(cancelPosts()).toHaveLength(1))
    const [, url, init] = cancelPosts()[0] as [unknown, string, RequestInit]
    expect(url).toBe('/api/ai/jobs/job-1/cancel')
    expect(JSON.parse(String(init.body))).toEqual({ orgId: 'org-1' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const list = screen.getByRole('list')
    expect(within(list).getByText('Canceled')).toBeTruthy()
    // What ran stays charged, and the row says how much.
    expect(within(list).getByText('This job used 9 credits before it stopped.')).toBeTruthy()
  })

  it('Keep building closes the confirm and sends nothing', async () => {
    renderPage([job()])
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for this site job' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cancel job/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep building' }))
    await waitFor(() => expect(screen.queryByText(AI_JOB_CANCEL_CONFIRM_COPY)).toBeNull())
    expect(cancelPosts()).toEqual([])
  })

  it('a finished job’s Cancel job is turned off and says why', async () => {
    renderPage([job({ status: 'done', running: false })])
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for this site job' }))
    const item = await screen.findByRole('menuitem', { name: /Cancel job/ })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(within(item).getByText('This job already finished.')).toBeTruthy()
  })
})
