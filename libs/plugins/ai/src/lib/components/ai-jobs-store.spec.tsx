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
 * Where a person finds their AI jobs (AGL-3593): the one "open AI jobs"
 * action every surface takes, and the one list of unsettled jobs every
 * counting surface reads — a single read however many surfaces mount, a
 * re-read only while something is moving, and none at all where refused.
 */

import { act, render, waitFor } from '@testing-library/react'

const mockFetch = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

import {
  AI_JOBS_ACTIVE_POLL_MS,
  openAiJobs,
  publishAiJob,
  resetAiJobsStoreForTests,
  useAiJobsInFlight,
  useAiJobsOpenRequest,
} from './ai-jobs-store'

const USER = { uid: 'u1', getIdToken: async () => 'tok' }
const ACTIVE_URL = '/api/ai/jobs?orgId=org-1&status=active&limit=20'

const running = { id: 'job-1', orgId: 'org-1', status: 'running', steps: [], review: null }

function List({ enabled = true }: { enabled?: boolean }) {
  const jobs = useAiJobsInFlight(USER, 'org-1', enabled)
  return <div data-testid="ids">{jobs.map((job) => job.id).join(',')}</div>
}

function answer(jobs: unknown[], status = 200) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url !== ACTIVE_URL) throw new Error(`unarmed request to ${url}`)
    return { ok: status < 400, status, json: async () => ({ jobs }) }
  })
}

beforeEach(() => {
  resetAiJobsStoreForTests()
  mockFetch.mockReset()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('openAiJobs', () => {
  it('is a new request each time, naming the job or none', () => {
    const seen: Array<{ seq: number; jobId: string | null }> = []
    const Probe = () => {
      seen.push(useAiJobsOpenRequest())
      return null
    }
    render(<Probe />)
    act(() => openAiJobs({ jobId: 'job-1' }))
    act(() => openAiJobs({ jobId: 'job-1' }))
    act(() => openAiJobs())
    expect(seen.map((request) => [request.seq, request.jobId])).toEqual([
      [0, null],
      [1, 'job-1'],
      [2, 'job-1'],
      [3, null],
    ])
  })
})

describe('the shared list of unsettled jobs', () => {
  it('is one read however many surfaces mount', async () => {
    answer([running])
    const view = render(
      <>
        <List />
        <List />
      </>,
    )
    await waitFor(() => expect(view.getAllByTestId('ids')[0].textContent).toBe('job-1'))
    expect(view.getAllByTestId('ids')[1].textContent).toBe('job-1')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('reads nothing for a surface whose gates have not passed', () => {
    render(<List enabled={false} />)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reads again on a timer only while something is in flight', async () => {
    jest.useFakeTimers()
    answer([])
    render(<List />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      jest.advanceTimersByTime(AI_JOBS_ACTIVE_POLL_MS * 3)
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    // A job another surface started puts the list on its timer.
    answer([running])
    act(() => publishAiJob(running as never))
    await act(async () => {
      jest.advanceTimersByTime(AI_JOBS_ACTIVE_POLL_MS)
      await Promise.resolve()
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('takes a job a surface hands in, and drops it once it settles', async () => {
    answer([])
    const view = render(<List />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    act(() => publishAiJob(running as never))
    expect(view.getByTestId('ids').textContent).toBe('job-1')
    act(() => publishAiJob({ ...running, status: 'done' } as never))
    expect(view.getByTestId('ids').textContent).toBe('')
  })

  it('stops asking where the route says the feature is not the workspace’s', async () => {
    answer([], 404)
    const view = render(<List />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    act(() => publishAiJob(running as never))
    expect(view.getByTestId('ids').textContent).toBe('')
  })
})
