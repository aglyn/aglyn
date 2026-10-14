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
 * The AI jobs indicator in the console's top bar (AGL-3593): on the
 * `consoleTopBar` zone, gated as the generative widgets are; hidden with
 * nothing in flight; a plan waiting for the person wins over a job running;
 * and pressing it opens AI jobs on that job. The shared list it reads is one
 * request, whichever surfaces read it.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets, type ConsoleTopBarZoneProps } from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  HelpTip: () => null,
  MdiIcon: () => <span />,
}))

import '../declarations'
import { AI_PLUGIN_ID } from '../constants'
import type { LazyWidget } from '../lazy-widget'
import { registerAiConsole } from '../plugin'
import { AiJobsTopBarIndicator } from './ai-jobs-indicator.component'
import { publishAiJob, resetAiJobsStoreForTests, useAiJobsOpenRequest } from './ai-jobs-store'

const ENTITLED = { plan: 'pro', billingStatus: 'active', seatAddons: { aiAddon: true } }

function job(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief: 'A roofer',
    batch: null,
    steps: [
      { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
      { name: 'generate', status: 'running', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
    ],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    error: null,
    running: true,
    plan: null,
    review: null,
    ...patch,
  }
}

const planReady = job('job-plan', {
  status: 'needs_review',
  running: false,
  steps: [
    { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
    { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
  ],
  review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
})
const building = job('job-build')

const released = { visible: true, staffPreview: false }

function props(patch: Partial<ConsoleTopBarZoneProps> = {}): ConsoleTopBarZoneProps {
  return {
    orgId: 'org-1',
    org: ENTITLED,
    orgReady: true,
    scopedOrgId: 'org-1',
    orgSlug: 'acme',
    hostId: null,
    productName: 'Aglyn',
    releaseVerdict: () => released,
    isStaff: false,
    permissionsOnHost: { loaded: true, granted: { 'ai.use': true, 'ai.generate': true } },
    ...patch,
  }
}

function armActive(jobs: unknown[]) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url === '/api/ai/jobs?orgId=org-1&status=active&limit=20') {
      return { ok: true, status: 200, json: async () => ({ jobs }) }
    }
    throw new Error(`unarmed request to ${url}`)
  })
}

beforeEach(() => {
  resetAiJobsStoreForTests()
  mockFetch.mockReset()
})

describe('the zone', () => {
  it('is registered on the top bar, gated as the generative widgets are', async () => {
    registerAiConsole()
    const [entry] = listConsoleWidgets(CONSOLE_WIDGET_SLOTS.consoleTopBar, [AI_PLUGIN_ID])
    // Registered lazily (AGL-3649): the stand-in loads this component when drawn.
    expect(await (entry?.widget.Component as LazyWidget).load()).toBe(AiJobsTopBarIndicator)
    expect(entry?.widget.featureFlag).toBe('aiGenerative')
    expect(entry?.widget.permission).toBe('ai.generate')
  })
})

describe('what it shows', () => {
  it('shows nothing with nothing in flight', async () => {
    armActive([])
    const { container } = render(<AiJobsTopBarIndicator {...props()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(container.innerHTML).toBe('')
  })

  it('says a plan is ready before it says anything is running', async () => {
    armActive([building, planReady])
    render(<AiJobsTopBarIndicator {...props()} />)
    const chip = await screen.findByText('AI · plan ready')
    expect(chip.closest('[data-ai-jobs-state]')?.getAttribute('data-ai-jobs-state')).toBe('needs-you')
  })

  it('says planning while the only job is still planning', async () => {
    armActive([
      job('job-planning', {
        steps: [
          { name: 'plan', status: 'running', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
          { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
        ],
      }),
    ])
    render(<AiJobsTopBarIndicator {...props()} />)
    expect(await screen.findByText('AI · planning')).toBeTruthy()
  })

  it('moves the moment another surface hands it a job, and leaves when it settles', async () => {
    armActive([])
    render(<AiJobsTopBarIndicator {...props()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    act(() => publishAiJob(planReady as never))
    expect(await screen.findByText('AI · plan ready')).toBeTruthy()
    act(() => publishAiJob({ ...planReady, status: 'done' } as never))
    await waitFor(() => expect(screen.queryByText('AI · plan ready')).toBeNull())
  })

  it('opens AI jobs on the job that needs the person', async () => {
    armActive([building, planReady])
    let request = { seq: 0, jobId: null as string | null }
    const Panel = () => {
      request = useAiJobsOpenRequest()
      return null
    }
    render(
      <>
        <Panel />
        <AiJobsTopBarIndicator {...props()} />
      </>,
    )
    fireEvent.click(await screen.findByText('AI · plan ready'))
    await waitFor(() => expect(request.jobId).toBe('job-plan'))
  })
})

describe('its gates', () => {
  it('reads nothing and shows nothing where the reader may not generate, or a flag is off', async () => {
    armActive([planReady])
    const off = { visible: false, staffPreview: false }
    const cases: Array<Partial<ConsoleTopBarZoneProps>> = [
      { permissionsOnHost: { loaded: true, granted: { 'ai.use': true, 'ai.generate': false } } },
      { permissionsOnHost: { loaded: false, granted: {} } },
      { releaseVerdict: (key: string) => (key === 'release_ai_generative' ? off : released) },
      { releaseVerdict: (key: string) => (key === 'release_assist' ? off : released) },
      { org: { plan: 'pro', billingStatus: 'active' } },
      { scopedOrgId: undefined },
    ]
    for (const patch of cases) {
      const { container, unmount } = render(<AiJobsTopBarIndicator {...props(patch)} />)
      expect(container.innerHTML).toBe('')
      unmount()
    }
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
