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
 * A site's AI jobs (AGL-3596): the bare `/ai-jobs` address lists the site's
 * jobs, newest first, each linking to its own page; `/ai-jobs/{jobId}` is
 * that page. Every load ends on the list, the empty state, or a sentence.
 */

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockGetDoc = jest.fn()
const mockFollow = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => ({ name: 'firestore' }),
}))
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}))
jest.mock('./ai-job-events', () => ({
  __esModule: true,
  followAiJobEvents: (...args: unknown[]) => mockFollow(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({ __esModule: true, trackEvent: jest.fn() }))

import { listConsoleExtensions } from '@aglyn/aglyn'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AI_PLUGIN_ID } from '../constants'
import { AI_SITE_BUILD_HREF } from '../model/ai-job-notice'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { registerAiConsole } from '../plugin'
import { AiJobsPage } from './ai-jobs-page.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

function job(patch: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'done',
    brief: 'A dog groomer that takes bookings',
    batch: null,
    steps: [{ name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 9, error: null }],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 180,
    refundedCredits: 0,
    createdBy: 'u1',
    createdAt: '2026-10-06T15:00:00.000Z',
    updatedAt: '2026-10-06T15:00:00.000Z',
    error: null,
    running: false,
    plan: null,
    review: null,
    ...patch,
  } as unknown as AiJobSummary
}

let mockFetch: jest.Mock

const BASE = '/acme/hosts/groomer/ai-jobs'
const openList = () => render(<AiJobsPage hostId="host-1" basePath={BASE} entitled />)

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
  mockGetDoc.mockReset()
  mockGetDoc.mockResolvedValue({ data: () => ({ orgId: 'org-1', displayName: 'Dog Groomer' }) })
  mockFollow.mockReset()
})

describe('the route the plugin registers (AGL-3596)', () => {
  it('is one unlisted address under the site, titled AI jobs, whose records are Building your site', () => {
    registerAiConsole()
    const extension = listConsoleExtensions([AI_PLUGIN_ID]).find((entry) => entry.pluginId === AI_PLUGIN_ID)
    const item = extension?.navItems?.find((navItem) => navItem.href === AI_SITE_BUILD_HREF)
    expect(item).toEqual(
      expect.objectContaining({
        label: 'AI jobs',
        recordTitle: 'Building your site',
        unlisted: true,
        ownsSubtree: true,
        Component: AiJobsPage,
      }),
    )
  })

  it('opens one job’s page when the address names a job', async () => {
    mockFollow.mockImplementation(async (_u: unknown, _o: string, _i: string, _s: AbortSignal, onJob: (j: AiJobSummary) => void) => {
      onJob(job({ status: 'running', running: true }))
      return 'ok'
    })
    render(<AiJobsPage hostId="host-1" segments={['job-1']} basePath={BASE} entitled />)
    expect(await screen.findByRole('heading', { name: 'Building your site' })).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('a site’s AI jobs', () => {
  it('asks the route for this site’s jobs alone, and lists each newest first with what it is, where it stands and what it cost', async () => {
    mockFetch.mockResolvedValueOnce(
      json({
        jobs: [
          job({ id: 'job-2', kind: 'page', status: 'failed', brief: 'A pricing page', creditsSpent: 35, refundedCredits: 35, createdAt: '2026-10-06T16:00:00.000Z' }),
          job({ id: 'job-1' }),
        ],
      }),
    )
    openList()
    const list = await screen.findByRole('list', { name: 'AI jobs' })
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/ai/jobs?orgId=org-1&hostId=host-1&limit=50')
    const rows = within(list).getAllByRole('link')
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([`${BASE}/job-2`, `${BASE}/job-1`])
    expect(within(rows[0]).getByText('Page')).toBeTruthy()
    expect(within(rows[0]).getByText('Failed')).toBeTruthy()
    expect(within(rows[0]).getByText('A pricing page')).toBeTruthy()
    // Refunded in full: no charge on the row, and the row says so (AGL-3596).
    expect(within(rows[0]).queryByText(/^\d+ credits/)).toBeNull()
    expect(
      within(rows[0]).getByText('This one’s on us — you weren’t charged. The 35 credits it used are back in your AI credits.'),
    ).toBeTruthy()
    expect(within(rows[1]).getByText('Site')).toBeTruthy()
    expect(within(rows[1]).getByText('Done')).toBeTruthy()
    expect(within(rows[1]).getByText(/180 credits/)).toBeTruthy()
    expect(rows[1].querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-06T15:00:00.000Z')
    expect(screen.getByText('Dog Groomer')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'AI jobs' })).toBeTruthy()
  })

  it('says what AI jobs are and where to start one when the site has none', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    openList()
    expect(await screen.findByRole('heading', { name: 'No AI jobs on this site yet' })).toBeTruthy()
    expect(screen.getByText(/choose Create with AI on this site’s Pages, Templates, Layouts, Forms or Components page/)).toBeTruthy()
    expect(screen.queryByLabelText('Loading AI jobs')).toBeNull()
  })

  it('says the route’s refusal, and Try again asks again', async () => {
    mockFetch.mockResolvedValueOnce(json({ error: 'Something went wrong.' }, 500))
    openList()
    expect(await screen.findByText('Something went wrong.')).toBeTruthy()
    mockFetch.mockResolvedValueOnce(json({ jobs: [job()] }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'AI jobs' })).toBeTruthy()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('says an unreachable route could not be loaded', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    openList()
    expect(await screen.findByText('This site’s AI jobs could not be loaded. Try again in a moment.')).toBeTruthy()
  })

  it('says the site could not be read, and asks the route nothing', async () => {
    mockGetDoc.mockRejectedValue(new Error('offline'))
    openList()
    expect(await screen.findByText('This site could not be read. Check your connection and reload the page.')).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
