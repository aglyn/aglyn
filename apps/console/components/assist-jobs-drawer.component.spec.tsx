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
 * The AI jobs drawer (AGL-2904): hidden unless the flag and the plan both
 * say so, loads on expand rather than on mount, watches a moving job
 * through the events stream, builds the "open draft" link from the output,
 * cancels through the route, and counts a job's outcome exactly once.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('util').TextEncoder
}

let mockFlagVisible = true
const mockTrackEvent = jest.fn()
const mockFetch = jest.fn()

jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  default: () => ({ isStaff: false }),
  useReleaseFlag: () => ({ visible: mockFlagVisible, staffPreview: false }),
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as string}</a>
  ),
  MdiIcon: () => <span />,
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) =>
    mockFetch(url, init),
}))

import { AssistJobsDrawer, aiJobOutputHref } from './assist-jobs-drawer.component'

const ENTITLED = { plan: 'pro', billingStatus: 'active', seatAddons: { aiAddon: true } }
const PLAIN_PRO = { plan: 'pro', billingStatus: 'active' }
const USER = { uid: 'viewer', getIdToken: async () => 'tok' }

function job(patch: Record<string, unknown>) {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'text',
    status: 'running',
    brief: 'A two-line tagline for a coffee roaster.',
    steps: [{ name: 'draft', status: 'running', startedAt: null, endedAt: null, creditsSpent: 0, error: null }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'viewer',
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    error: null,
    running: true,
    ...patch,
  }
}

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
})

/** An SSE body that delivers the given frames, then ends. */
function sseResponse(events: unknown[]) {
  const chunks = events.map((event) =>
    new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
  )
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length
            ? { done: false, value: chunks.shift() }
            : { done: true, value: undefined },
      }),
    },
  }
}

function renderDrawer(overrides: Partial<Parameters<typeof AssistJobsDrawer>[0]> = {}) {
  return render(
    <AssistJobsDrawer
      orgId="org-1"
      org={ENTITLED as never}
      orgReady
      orgSlug="acme"
      user={USER as never}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  mockFlagVisible = true
  mockTrackEvent.mockReset()
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => {
    throw new Error(`unarmed request to ${url}`)
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the gate', () => {
  it('renders nothing while the flag is off, on a plan without aiGenerative, or with no org', () => {
    mockFlagVisible = false
    expect(renderDrawer().container.innerHTML).toBe('')
    mockFlagVisible = true
    expect(renderDrawer({ org: PLAIN_PRO as never }).container.innerHTML).toBe('')
    expect(renderDrawer({ orgId: undefined }).container.innerHTML).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('renders collapsed and fetches NOTHING until expanded', () => {
    renderDrawer()
    expect(screen.getByLabelText('Show AI jobs')).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('the list', () => {
  it('loads the org’s jobs on expand, with steps, the copy of a text output and an open-draft link', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ai/jobs?orgId=org-1')) {
        return jsonResponse({
          jobs: [
            job({
              id: 'job-done',
              status: 'done',
              running: false,
              creditsSpent: 6,
              steps: [{ name: 'draft', status: 'done', startedAt: null, endedAt: null, creditsSpent: 6, error: null }],
              outputs: [
                { resource: 'text', id: 'draft', hostId: 'host-1', label: 'Draft copy', text: 'Fresh coffee.' },
                { resource: 'screen', id: 'scr-1', versionId: 'v-1', hostId: 'host-1', label: 'Landing page' },
              ],
            }),
          ],
        })
      }
      throw new Error(`unarmed request to ${url}`)
    })
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    expect(await screen.findByText('Fresh coffee.')).toBeTruthy()
    expect(screen.getByText('1/1 steps · 6 credits')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    const link = screen.getByText('Open draft — Landing page') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      '/acme/hosts/host-1/screens/scr-1/versions/v-1/besigner',
    )
    // A job that arrived finished is not this session's outcome to count.
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('shows the route’s refusal rather than an empty list', async () => {
    mockFetch.mockImplementation(async () =>
      jsonResponse({ error: "This workspace's plan does not include that feature" }, 403),
    )
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    expect(await screen.findByText(/does not include that feature/)).toBeTruthy()
  })
})

describe('watching a job', () => {
  it('opens the events stream for the moving job, applies its state, and counts done once', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ai/jobs?orgId=org-1')) {
        return jsonResponse({ jobs: [job({})] })
      }
      if (url.startsWith('/api/ai/jobs/job-1/events?orgId=org-1')) {
        return sseResponse([
          { type: 'state', job: job({}) },
          {
            type: 'state',
            job: job({
              status: 'done',
              running: false,
              creditsSpent: 6,
              updatedAt: '2026-09-14T10:00:05.000Z',
              outputs: [{ resource: 'text', id: 'draft', hostId: 'host-1', label: 'Draft copy', text: 'Late copy.' }],
            }),
          },
        ])
      }
      throw new Error(`unarmed request to ${url}`)
    })
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    expect(await screen.findByText('Late copy.')).toBeTruthy()
    await waitFor(() =>
      expect(mockTrackEvent).toHaveBeenCalledWith('ai_job_completed', { kind: 'text', credits: 6 }),
    )
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    // The list, then ONE stream — never a second for the same job.
    const eventUrls = mockFetch.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/events'))
    expect(eventUrls).toHaveLength(1)
  })

  it('reports a failed job as such, once', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ai/jobs?orgId=org-1')) {
        return jsonResponse({ jobs: [job({ status: 'queued', running: false })] })
      }
      if (url.includes('/events')) {
        return sseResponse([
          { type: 'state', job: job({ status: 'failed', running: false, error: 'The AI request failed — try again.' }) },
        ])
      }
      throw new Error(`unarmed request to ${url}`)
    })
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    expect(await screen.findByText('The AI request failed — try again.')).toBeTruthy()
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledWith('ai_job_failed', { kind: 'text' }))
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })
})

describe('cancel', () => {
  it('posts to the cancel route with the org named, and shows the answer', async () => {
    const posts: Array<[string, unknown]> = []
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/ai/jobs?orgId=org-1')) {
        return jsonResponse({ jobs: [job({ status: 'queued', running: false })] })
      }
      if (url.includes('/events')) return sseResponse([])
      if (url === '/api/ai/jobs/job-1/cancel') {
        posts.push([url, JSON.parse(String(init?.body))])
        return jsonResponse({ changed: true, job: job({ status: 'canceled', running: false }) })
      }
      throw new Error(`unarmed request to ${url}`)
    })
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    fireEvent.click(await screen.findByText('Cancel'))
    expect(await screen.findByText('Canceled')).toBeTruthy()
    expect(posts).toEqual([['/api/ai/jobs/job-1/cancel', { orgId: 'org-1' }]])
    expect(screen.queryByText('Cancel')).toBeNull()
    // A cancel is not an outcome the funnel counts.
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})

describe('aiJobOutputHref', () => {
  const output = (patch: Record<string, unknown>) => ({
    resource: 'screen',
    id: 'scr-1',
    hostId: 'host-1',
    label: 'x',
    ...patch,
  })

  it('opens a versioned resource in the besigner on the version the job wrote', () => {
    expect(aiJobOutputHref(output({ versionId: 'v-1' }) as never, 'acme')).toBe(
      '/acme/hosts/host-1/screens/scr-1/versions/v-1/besigner',
    )
    expect(aiJobOutputHref(output({ resource: 'reusableComponent' }) as never, 'acme')).toBe(
      '/acme/hosts/host-1/components/scr-1',
    )
    expect(aiJobOutputHref(output({ resource: 'emailScreen', versionId: 'v-2' }) as never, 'acme')).toBe(
      '/acme/hosts/host-1/emails/scr-1/versions/v-2/besigner',
    )
  })

  it('has no page for text, no page without a host or a slug, and a list for products and workflows', () => {
    expect(aiJobOutputHref(output({ resource: 'text' }) as never, 'acme')).toBeNull()
    expect(aiJobOutputHref(output({ hostId: null }) as never, 'acme')).toBeNull()
    expect(aiJobOutputHref(output({}) as never, '')).toBeNull()
    expect(aiJobOutputHref(output({ resource: 'product' }) as never, 'acme')).toBe(
      '/acme/hosts/host-1/products',
    )
    expect(aiJobOutputHref(output({ resource: 'workflow' }) as never, 'acme')).toBe(
      '/acme/hosts/host-1/automation?tab=workflows',
    )
  })
})
