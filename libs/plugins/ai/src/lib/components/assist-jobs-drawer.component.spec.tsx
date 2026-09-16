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

// The AI add-on as its plugin declares it (AGL-2939): the entitlement gate
// folds `aiAddon` only once the declaration is registered.
import '../declarations'
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
      visible={mockFlagVisible}
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

/**
 * A page is described FOR a site (AGL-2907), so the entry point is here only
 * while the console page the panel is docked to names one — and opening the
 * brief dialog still asks the route for nothing until a brief is sent.
 */
describe('describing a page', () => {
  it('offers it only on a site’s own routes', () => {
    expect(screen.queryByRole('button', { name: 'Describe a page' })).toBeNull()
    renderDrawer({ hostId: 'host-1' })
    expect(screen.getByRole('button', { name: 'Describe a page' })).toBeTruthy()
  })

  it('opens the brief dialog, which sends nothing of its own until a brief is written', () => {
    renderDrawer({ hostId: 'host-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Describe a page' }))
    expect(screen.getByLabelText('What is the page for?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Plan the page' }).hasAttribute('disabled')).toBe(true)
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
                {
                  resource: 'screen',
                  id: 'scr-1',
                  versionId: 'v-1',
                  hostId: 'host-1',
                  hostSubdomain: 'shop',
                  label: 'Landing page',
                },
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
      '/acme/hosts/shop/screens/scr-1/versions/v-1/besigner',
    )
    // A job that arrived finished is not this session's outcome to count.
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('links a generated form to its page, and shows what the job says to decide next (AGL-2913)', async () => {
    const note = 'Forms cannot collect photo upload yet, so this form leaves it out.'
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ai/jobs?orgId=org-1')) {
        return jsonResponse({
          jobs: [
            job({
              id: 'job-form',
              kind: 'form',
              status: 'done',
              running: false,
              steps: [{ name: 'generate', status: 'done', startedAt: null, endedAt: null, creditsSpent: 4, error: null }],
              outputs: [
                {
                  resource: 'form',
                  id: 'job-form',
                  versionId: null,
                  hostId: 'host-1',
                  hostSubdomain: 'shop',
                  label: 'Roof quote request',
                  note,
                },
              ],
            }),
          ],
        })
      }
      throw new Error(`unarmed request to ${url}`)
    })
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    const link = (await screen.findByText('Open draft — Roof quote request')) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/acme/hosts/shop/forms/job-form')
    expect(screen.getByText(note)).toBeTruthy()
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
    hostSubdomain: 'shop',
    label: 'x',
    ...patch,
  })

  it('opens a versioned resource in the besigner on the version the job wrote', () => {
    expect(aiJobOutputHref(output({ versionId: 'v-1' }) as never, 'acme')).toBe(
      '/acme/hosts/shop/screens/scr-1/versions/v-1/besigner',
    )
    expect(aiJobOutputHref(output({ resource: 'reusableComponent' }) as never, 'acme')).toBe(
      '/acme/hosts/shop/components/scr-1',
    )
    expect(aiJobOutputHref(output({ resource: 'emailScreen', versionId: 'v-2' }) as never, 'acme')).toBe(
      '/acme/hosts/shop/emails/scr-1/versions/v-2/besigner',
    )
  })

  it('has no page for text, no page without a host or a slug, and a list for products and workflows', () => {
    expect(aiJobOutputHref(output({ resource: 'text' }) as never, 'acme')).toBeNull()
    expect(aiJobOutputHref(output({ hostId: null, hostSubdomain: null }) as never, 'acme')).toBeNull()
    expect(aiJobOutputHref(output({}) as never, '')).toBeNull()
    expect(aiJobOutputHref(output({ resource: 'product' }) as never, 'acme')).toBe(
      '/acme/hosts/shop/products',
    )
    expect(aiJobOutputHref(output({ resource: 'workflow' }) as never, 'acme')).toBe(
      '/acme/hosts/shop/automation?tab=workflows',
    )
  })

  it('names the site by its subdomain, never by the document id the console cannot resolve', () => {
    // `[host]` resolves by subdomain: a link built from the document id
    // opened no site at all.
    expect(aiJobOutputHref(output({ hostSubdomain: undefined }) as never, 'acme')).toBeNull()
    expect(aiJobOutputHref(output({ versionId: 'v-1' }) as never, 'acme')).not.toContain('host-1')
  })

  it('opens a theme proposal on the site’s Theme section (AGL-2938)', () => {
    expect(aiJobOutputHref(output({ resource: 'theme', id: 'proposal' }) as never, 'acme')).toBe(
      '/acme/hosts/shop/setup/theme',
    )
  })

  it('opens a generated form on its own page, which mints its first version (AGL-2913)', () => {
    expect(aiJobOutputHref(output({ resource: 'form', id: 'form-1' }) as never, 'acme')).toBe(
      '/acme/hosts/shop/forms/form-1',
    )
    expect(
      aiJobOutputHref(output({ resource: 'form', id: 'form-1', versionId: 'v-3' }) as never, 'acme'),
    ).toBe('/acme/hosts/shop/forms/form-1')
  })
})

describe('a job waiting for a person (AGL-2935)', () => {
  const PLAN = {
    reuse: [{ kind: 'layout', id: 'lay-site', purpose: 'the site chrome' }],
    create: [
      { kind: 'component', name: 'Service card', why: 'Nothing lists a service.', duplicateOf: null, fields: [] },
    ],
    screens: [
      {
        title: 'Roof repair',
        slug: '/services/roof-repair',
        layout: 'lay-site',
        template: null,
        duplicateOf: null,
        nav: true,
        seoTitle: 'Roof repair',
        seoDescription: 'Same-week repair.',
        sections: [{ name: 'hero', uses: [], items: 0 }],
      },
    ],
    status: 'proposed',
    labels: { 'lay-site': 'Site layout' },
    proposedAt: '2026-09-14T10:00:00.000Z',
    confirmedAt: null,
    confirmedBy: null,
  }
  const waiting = (patch: Record<string, unknown>) =>
    job({
      kind: 'site',
      status: 'needs_review',
      running: false,
      steps: [
        { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 6, error: null },
        { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
      ],
      ...patch,
    })

  function armResume(
    list: unknown,
    answer: unknown,
    posts: Array<[string, unknown]>,
    status = 200,
  ) {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/ai/jobs?orgId=org-1')) return jsonResponse({ jobs: [list] })
      if (url.includes('/events')) return sseResponse([])
      if (url === '/api/ai/jobs/job-1/resume') {
        posts.push([url, JSON.parse(String(init?.body))])
        return jsonResponse(answer, status)
      }
      throw new Error(`unarmed request to ${url}`)
    })
  }

  it('shows the proposed plan in the site’s own names, and confirms it through the resume route', async () => {
    const posts: Array<[string, unknown]> = []
    armResume(
      waiting({ plan: PLAN, review: { reason: 'plan', message: 'The plan is ready.', findings: [] } }),
      {
        job: waiting({
          status: 'queued',
          plan: { ...PLAN, status: 'confirmed', confirmedAt: '2026-09-14T10:01:00.000Z', confirmedBy: 'viewer' },
          review: null,
        }),
      },
      posts,
    )
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    expect(await screen.findByText('Needs review')).toBeTruthy()
    expect(screen.getByText('Reuses the layout Site layout — the site chrome')).toBeTruthy()
    expect(screen.getByText('Creates the component Service card — Nothing lists a service.')).toBeTruthy()
    expect(
      screen.getByText('Builds the screen Roof repair at /services/roof-repair in Site layout: hero'),
    ).toBeTruthy()
    fireEvent.click(screen.getByText('Confirm plan'))
    expect(await screen.findByText('Confirmed plan')).toBeTruthy()
    expect(posts).toEqual([['/api/ai/jobs/job-1/resume', { orgId: 'org-1', hostId: 'host-1' }]])
    expect(screen.queryByText('Confirm plan')).toBeNull()
  })

  it('names the rules a refused answer broke, and tries the step again', async () => {
    const posts: Array<[string, unknown]> = []
    const message = 'This could not be built within the building rules.'
    armResume(
      waiting({
        error: message,
        review: {
          reason: 'doctrine',
          message,
          findings: [{ rule: 2, code: 'plan-screen-without-layout', message: 'A screen names no layout.' }],
        },
      }),
      { job: waiting({ status: 'queued', review: null, error: null }) },
      posts,
    )
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    expect(await screen.findByText('A screen names no layout.')).toBeTruthy()
    expect(screen.getByText(message)).toBeTruthy()
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByText('Queued')).toBeTruthy()
    expect(posts).toHaveLength(1)
    expect(screen.queryByText('Try again')).toBeNull()
  })

  it('shows the route’s refusal when a resume is refused, and leaves the job waiting', async () => {
    const posts: Array<[string, unknown]> = []
    armResume(
      waiting({ plan: PLAN, review: { reason: 'plan', message: 'The plan is ready.', findings: [] } }),
      { error: 'Your role does not include ai.generate' },
      posts,
      403,
    )
    renderDrawer()
    fireEvent.click(screen.getByLabelText('Show AI jobs'))
    fireEvent.click(await screen.findByText('Confirm plan'))
    expect(await screen.findByText('Your role does not include ai.generate')).toBeTruthy()
    expect(screen.getByText('Needs review')).toBeTruthy()
    expect(posts).toHaveLength(1)
  })
})
