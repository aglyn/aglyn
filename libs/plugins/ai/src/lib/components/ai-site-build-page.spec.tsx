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
 * "Building your site" (AGL-3594): the page the guided start lands on. Each
 * state the job can be in reads as itself — planning, building, done, failed —
 * and a finished site leads with what to do next.
 */

const mockFollow = jest.fn()
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => ({ name: 'firestore' }),
}))
const mockGetDoc = jest.fn()
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
jest.mock('next/navigation', () => ({
  __esModule: true,
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/acme/hosts/groomer/ai-jobs/job-1',
}))
const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/shared-util-http/authorized-token'),
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import {
  AI_SITE_ITEM_HINT,
  AI_SITE_LOOK_HINT,
  AI_SITE_PAGE_HINT,
  AI_SITE_PLAN_HINT,
  aiJobPageCopy,
  aiSiteBuildCreditsLine,
  aiSiteBuildFraction,
  aiSiteBuildRows,
} from '../model/ai-site-build-progress'
import { AI_JOB_FIRST_STATE_TIMEOUT_MS, AiSiteBuildPage } from './ai-site-build-page.component'
import { AI_JOB_PAUSED_NEXT_COPY } from '../model/ai-job-notice'

beforeEach(() => {
  mockGetDoc.mockReset()
  mockGetDoc.mockResolvedValue({ data: () => ({ orgId: 'org-1', displayName: 'Dog Groomer' }) })
})

const PLAN = {
  reuse: [],
  create: [],
  screens: [
    { title: 'Home', slug: '/', layout: null, template: null, duplicateOf: null, nav: true, seoTitle: 'Home', seoDescription: 'Home', sections: [{ name: 'hero', uses: [], items: 0 }, { name: 'services', uses: [], items: 0 }] },
    { title: 'Book', slug: '/book', layout: null, template: null, duplicateOf: null, nav: true, seoTitle: 'Book', seoDescription: 'Book', sections: [{ name: 'booking times', uses: [], items: 0 }] },
  ],
  status: 'confirmed',
  labels: {},
  proposedAt: null,
  confirmedAt: null,
  confirmedBy: 'u1',
}

const screenOutput = (id: string) => ({ resource: 'screen', id, hostId: 'host-1', hostSubdomain: 'groomer', versionId: `${id}-v1`, label: id })

function job(patch: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief: 'A dog groomer',
    batch: null,
    steps: [
      { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 9, error: null },
      { name: 'generate', status: 'running', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
    ],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 9,
    refundedCredits: 0,
    createdBy: 'u1',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    error: null,
    running: true,
    plan: PLAN,
    review: null,
    ...patch,
  } as unknown as AiJobSummary
}

async function open(state: AiJobSummary) {
  mockFollow.mockReset()
  mockFollow.mockImplementation(async (_user: unknown, _org: string, _id: string, _signal: AbortSignal, onJob: (job: AiJobSummary) => void) => {
    onJob(state)
  })
  render(<AiSiteBuildPage hostId="host-1" segments={['job-1']} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
}

describe('the progress a site job shows (AGL-3594)', () => {
  it('lists planning and then each page, with where the build is', () => {
    expect(aiSiteBuildRows(job({ outputs: [screenOutput('home')] as never })).map((row) => [row.label, row.state])).toEqual([
      ['Planning your pages', 'done'],
      ['Writing page 1 of 2: Home', 'done'],
      ['Writing page 2 of 2: Book', 'active'],
      ['Publishing your site', 'waiting'],
    ])
    expect(aiSiteBuildRows(job({ plan: null, steps: [{ name: 'plan', status: 'running' }] as never })).map((row) => row.state)).toEqual(['active'])
    expect(aiSiteBuildRows(job({ status: 'failed', outputs: [screenOutput('home')] as never })).map((row) => row.state)).toEqual(['done', 'done', 'failed', 'skipped'])
  })

  it('names the job’s one price, never a plan’s', () => {
    expect(aiSiteBuildCreditsLine(job())).toBe('Credits used so far: 9')
    expect(aiSiteBuildCreditsLine(job({ status: 'done', creditsSpent: 180 }))).toBe('This site used 180 credits.')
    expect(aiSiteBuildCreditsLine(job({ status: 'failed', creditsSpent: 35, refundedCredits: 35 }))).toBe(
      'This one’s on us — you weren’t charged. The 35 credits it used are back in your AI credits.',
    )
  })
})

describe('Building your site (AGL-3594)', () => {
  it('says it is building, with the site’s name, live progress and the plan to open', async () => {
    await open(job({ outputs: [screenOutput('home')] as never }))
    expect(await screen.findByRole('heading', { name: 'Building your site' })).toBeTruthy()
    expect(await screen.findByText('Writing page 2 of 2: Book')).toBeTruthy()
    expect(await screen.findByText('Dog Groomer')).toBeTruthy()
    expect(screen.getByText('Credits used so far: 9')).toBeTruthy()
    expect(screen.getByText('What we’re building')).toBeTruthy()
    expect(mockFollow.mock.calls[0][1]).toBe('org-1')
    expect(mockFollow.mock.calls[0][2]).toBe('job-1')
  })

  it('reads as planning before the plan exists', async () => {
    await open(job({ plan: null, steps: [{ name: 'plan', status: 'running' }] as never, creditsSpent: 0 }))
    expect(await screen.findByText('Planning your pages')).toBeTruthy()
    expect(screen.queryByText('What we’re building')).toBeNull()
  })

  it('leads a finished site with View your site and Edit your pages, and says the pages are drafts', async () => {
    await open(job({ status: 'done', running: false, outputs: [screenOutput('home'), screenOutput('book')] as never, creditsSpent: 180 }))
    expect(await screen.findByRole('heading', { name: 'Your site is ready' })).toBeTruthy()
    expect(screen.getByText('Your new pages are drafts. Publish them when you’re happy.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View your site' }).getAttribute('href')).toBe(
      '/acme/hosts/groomer/screens/home/versions/home-v1/view',
    )
    expect(screen.getByRole('link', { name: 'Edit your pages' })).toBeTruthy()
    expect(screen.getByText('This site used 180 credits.')).toBeTruthy()
  })

  it('says why a failed site was not built, what was given back, and offers the starter site', async () => {
    await open(job({
      status: 'failed',
      running: false,
      plan: null,
      steps: [{ name: 'plan', status: 'failed' }] as never,
      error: 'Something went wrong planning your site. Try again.',
      creditsSpent: 35,
      refundedCredits: 35,
    }))
    expect(await screen.findByRole('heading', { name: 'Your site was not built' })).toBeTruthy()
    expect(screen.getByText('Something went wrong planning your site. Try again.')).toBeTruthy()
    expect(screen.getByText('This one’s on us — you weren’t charged. The 35 credits it used are back in your AI credits.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use the starter site instead' })).toBeTruthy()
  })

  it('offers Try again on a refused plan, and disables it with the reason when the allowance cannot cover one', async () => {
    const reason = 'You have 10 AI credits left this month, and a plan needs up to 35. Your credits refresh next month, or upgrade for more.'
    await open(job({
      status: 'needs_review',
      running: false,
      plan: null,
      steps: [{ name: 'plan', status: 'pending' }] as never,
      review: { reason: 'doctrine', message: 'Something went wrong planning your site. Try again.', findings: [], retryRefusal: reason },
    }))
    expect(await screen.findByText(reason)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

const SITE_PUBLISH = {
  liveUrl: 'https://groomer.aglyn.app/',
  published: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'book', label: 'Book', path: '/book' },
  ],
  drafts: [],
}

describe('a guided start that put the site live (AGL-3596)', () => {
  const done = (sitePublish: unknown) =>
    job({
      status: 'done',
      running: false,
      outputs: [screenOutput('home'), screenOutput('book')] as never,
      creditsSpent: 180,
      sitePublish,
    } as never)

  it('says the site is live, opens the live site in a new tab, and keeps Edit your pages', async () => {
    await open(done(SITE_PUBLISH))
    expect(await screen.findByRole('heading', { name: 'Your site is live' })).toBeTruthy()
    expect(screen.queryByText(/drafts/)).toBeNull()
    // The shared notice every new site goes live with, address and all (AGL-3663).
    expect(screen.getByText('groomer.aglyn.app/')).toBeTruthy()
    const view = screen.getByRole('link', { name: 'View your site' })
    expect(view.getAttribute('href')).toBe('https://groomer.aglyn.app/')
    expect(view.getAttribute('target')).toBe('_blank')
    expect(view.getAttribute('rel')).toContain('noopener')
    expect(screen.getByRole('link', { name: 'Edit your pages' }).getAttribute('href')).toBe('/acme/hosts/groomer/screens')
  })

  it('names each page that stayed a draft, with its reason', async () => {
    await open(done({
      ...SITE_PUBLISH,
      published: [SITE_PUBLISH.published[0]],
      drafts: [{ id: 'book', label: 'Book', reason: 'Its address is already used by another page.' }],
    }))
    expect(await screen.findByRole('heading', { name: 'Your site is live' })).toBeTruthy()
    expect(screen.getByText('This page stayed a draft:')).toBeTruthy()
    expect(screen.getByText('Book: Its address is already used by another page.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Edit your pages' })).toBeTruthy()
  })

  it('says the pages are drafts when none could be published, and leads with the preview', async () => {
    await open(done({
      liveUrl: 'https://groomer.aglyn.app/',
      published: [],
      drafts: [{ id: 'home', label: 'Home', reason: 'The site has reached its page limit.' }],
    }))
    expect(await screen.findByRole('heading', { name: 'Your site is ready' })).toBeTruthy()
    expect(screen.getByText('Home: The site has reached its page limit.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View your site' }).getAttribute('href')).toBe(
      '/acme/hosts/groomer/screens/home/versions/home-v1/view',
    )
  })
})

describe('every wait ends (AGL-3596)', () => {
  const ends = async (end: 'not-found' | 'error') => {
    mockFollow.mockReset()
    mockFollow.mockResolvedValue(end)
    render(<AiSiteBuildPage hostId="host-1" segments={['job-1']} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
  }

  it('says a job the route does not know could not be found, with the way to the site’s jobs', async () => {
    await ends('not-found')
    expect(await screen.findByRole('heading', { name: 'This job could not be found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See this site’s AI jobs' }).getAttribute('href')).toBe('/acme/hosts/groomer/ai-jobs')
  })

  it('says a failed read could not be loaded, and Try again follows the job again', async () => {
    await ends('error')
    expect(await screen.findByRole('heading', { name: 'This job could not be loaded' })).toBeTruthy()
    mockFollow.mockImplementation(async (_u: unknown, _o: string, _i: string, _s: AbortSignal, onJob: (j: AiJobSummary) => void) => {
      onJob(job())
      return 'ok'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Building your site' })).toBeTruthy()
    expect(await screen.findByText('Writing page 1 of 2: Home')).toBeTruthy()
  })

  it('says the site could not be read, rather than waiting for a workspace that never comes', async () => {
    mockGetDoc.mockRejectedValue(new Error('offline'))
    mockFollow.mockReset()
    render(<AiSiteBuildPage hostId="host-1" segments={['job-1']} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
    expect(await screen.findByRole('heading', { name: 'This site could not be read' })).toBeTruthy()
    expect(mockFollow).not.toHaveBeenCalled()
  })

  it('treats a site with no workspace as unreadable', async () => {
    mockGetDoc.mockResolvedValue({ data: () => undefined })
    mockFollow.mockReset()
    render(<AiSiteBuildPage hostId="host-1" segments={['job-1']} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
    expect(await screen.findByRole('heading', { name: 'This site could not be read' })).toBeTruthy()
  })

  it('stops waiting when no state arrives in time', async () => {
    jest.useFakeTimers()
    try {
      mockFollow.mockReset()
      mockFollow.mockImplementation(() => new Promise(() => undefined))
      render(<AiSiteBuildPage hostId="host-1" segments={['job-1']} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByLabelText('Loading the job')).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(AI_JOB_FIRST_STATE_TIMEOUT_MS)
      })
      expect(screen.getByRole('heading', { name: 'This job could not be loaded' })).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('a job that is not a site names what it makes (AGL-3596)', () => {
  it('reads as building a page, and a finished page as ready', async () => {
    expect(aiJobPageCopy(job({ kind: 'page' }), 'Aglyn').heading).toBe('Building your page')
    expect(aiJobPageCopy(job({ kind: 'page', status: 'done' }), 'Aglyn').heading).toBe('Your page is ready')
    expect(aiJobPageCopy(job({ kind: 'products', status: 'done' }), 'Aglyn').heading).toBe('Your products are ready')
    expect(aiJobPageCopy(job({ kind: 'crm', status: 'failed' }), 'Aglyn').heading).toBe('Your AI job stopped')
    await open(job({ kind: 'form', plan: null, steps: [{ name: 'generate', status: 'running' }] as never }))
    expect(await screen.findByRole('heading', { name: 'Building your form' })).toBeTruthy()
  })

  it('keeps the drafts wording on a finished site job that published nothing', () => {
    expect(aiJobPageCopy(job({ status: 'done' }), 'Aglyn')).toEqual({
      heading: 'Your site is ready',
      lede: 'Your new pages are drafts. Publish them when you’re happy.',
    })
  })
})

describe('a guided start that failed on our side (AGL-3596)', () => {
  /** The 2026-10-06 production job: plan done, the layout refused, 102 credits all given back. */
  const FAILED = () =>
    job({
      status: 'failed',
      running: false,
      plan: {
        ...PLAN,
        create: [
          { kind: 'layout', name: 'Dog Grooming Layout', why: 'The frame.', duplicateOf: null, fields: ['header', 'nav', 'footer'] },
          { kind: 'form', name: 'Grooming Inquiry Form', why: 'Inquiries.', duplicateOf: null, fields: [] },
        ],
      } as never,
      steps: [
        { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 13, error: null },
        { name: 'generate', status: 'failed', startedAt: null, endedAt: null, creditsSpent: 89, error: null },
      ],
      outputs: [{ resource: 'seo', id: 'site:listing', hostId: 'host-1', label: 'Listing', proposal: {} }] as never,
      error: 'Something went wrong building your site, and it was not built.',
      creditsSpent: 102,
      refundedCredits: 102,
      siteInputs: { businessType: 'dog grooming salon', audience: 'dog owners in Hillside', starter: 'business', pages: 2, submissions: 'inbox', welcomeEmail: false },
    } as never)
  const REFUNDED = 'This one’s on us — you weren’t charged. The 102 credits it used are back in your AI credits.'

  it('names the step that failed — the layout, never the first page', () => {
    expect(aiSiteBuildRows(FAILED()).map((row) => [row.label, row.state])).toEqual([
      ['Planning your pages', 'done'],
      ['Building the header and footer: Dog Grooming Layout', 'failed'],
      ['Building the form: Grooming Inquiry Form', 'waiting'],
      ['Writing page 1 of 2: Home', 'waiting'],
      ['Writing page 2 of 2: Book', 'waiting'],
      ['Publishing your site', 'skipped'],
    ])
  })

  it('says what failed, that it cost nothing, and offers Try again on its own answers and the starter site', async () => {
    mockFetch.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ jobs: [], freeTaste: true }) })
    await open(FAILED())
    expect(await screen.findByRole('heading', { name: 'Your site was not built' })).toBeTruthy()
    expect(screen.getByText('Something went wrong building your site, and it was not built.')).toBeTruthy()
    expect(screen.queryByText(/The plan is ready/)).toBeNull()
    expect(screen.getByText(REFUNDED)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use the starter site instead' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // The guided start reopens on its questions, filled in with what the person answered.
    expect(await screen.findByDisplayValue('dog grooming salon')).toBeTruthy()
    expect(screen.getByDisplayValue('dog owners in Hillside')).toBeTruthy()
  })

  it('keeps following a job that parks for an instant, so its credits and state are the job’s last', async () => {
    mockFollow.mockReset()
    mockFollow.mockImplementation(async (_u: unknown, _o: string, _i: string, signal: AbortSignal, onJob: (next: AiJobSummary) => void) => {
      onJob(job({ status: 'needs_review', running: false, creditsSpent: 13, review: { reason: 'plan', message: 'The plan is ready.', findings: [] } } as never))
      await new Promise((resolve) => setTimeout(resolve, 10))
      // A page that stopped following on the park has aborted by now.
      if (!signal.aborted) onJob(FAILED())
    })
    render(<AiSiteBuildPage hostId="host-1" segments={['job-1']} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
    expect(await screen.findByText(REFUNDED)).toBeTruthy()
  })
})

/*
 * The detail a site job shows while it works (founder, 2026-10-07: "just a
 * loading bar is not enough"): every stage from the start, how far along it
 * is, what the active stage is doing and for how long, each page's sections,
 * and what each finished stage used.
 */
describe('the detail a site job shows while it works', () => {
  const planning = () =>
    job({
      plan: null,
      creditsSpent: 0,
      siteInputs: { businessType: 'a dog groomer', pages: 2 },
      steps: [
        { name: 'plan', status: 'running', startedAt: '2026-10-07T12:00:00.000Z', endedAt: null, creditsSpent: 0, error: null },
        { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
      ],
    } as never)

  it('names every stage before the plan exists, and what planning is doing', () => {
    const rows = aiSiteBuildRows(planning())
    expect(rows.map((row) => [row.label, row.state])).toEqual([
      ['Planning your pages', 'active'],
      // The look is designed first (AGL-3660).
      ['Designing your look', 'waiting'],
      ['Building the header and footer', 'waiting'],
      ['Writing your 2 pages', 'waiting'],
      ['Publishing your site', 'waiting'],
    ])
    expect(rows[0].hint).toBe(AI_SITE_PLAN_HINT)
    expect(rows[0].startedAt).toBe('2026-10-07T12:00:00.000Z')
  })

  it('fills the bar by finished stages, the active one counting half', () => {
    expect(aiSiteBuildFraction(aiSiteBuildRows(planning()))).toBeCloseTo(0.5 / 5)
    expect(aiSiteBuildFraction([{ id: 'plan', label: 'Planning your pages', state: 'active' }])).toBeNull()
  })

  it("lists each page's planned sections, and what planning used once it is done", () => {
    const rows = aiSiteBuildRows(job())
    expect(rows[0].credits).toBe(9)
    const pages = rows.filter((row) => row.id.startsWith('page-'))
    expect(pages.every((row) => (row.sections?.length ?? 0) > 0)).toBe(true)
  })

  it('draws a filling bar, the hint and the sections on the page', async () => {
    await open(planning())
    const bar = await screen.findByRole('progressbar', { name: /Building: 0 of 5 steps done/ })
    expect(bar.getAttribute('aria-valuenow')).toBe(String(Math.round((0.5 / 5) * 100)))
    expect(screen.getByText(AI_SITE_PLAN_HINT)).toBeTruthy()
  })
})

/*
 * The 2026-10-07 production guided start (AGL-3596): a layout, a form and two
 * pages. Once the build wrote its item ledger, the item being written still
 * read `pending`, so every row said Waiting and the page looked stalled; and
 * between its plan and its build the job parked on the plan for the instant
 * the machine took to confirm it, which the page drew as a failed site.
 */
describe('a guided start, snapshot by snapshot (AGL-3596)', () => {
  const PROD_PLAN = {
    ...PLAN,
    create: [
      { kind: 'layout', name: 'Main Layout', why: 'The frame.', duplicateOf: null, fields: [] },
      { kind: 'form', name: 'Contact Request Form', why: 'Requests.', duplicateOf: null, fields: [] },
    ],
    screens: [PLAN.screens[0], { ...PLAN.screens[1], title: 'Contact', slug: '/contact' }],
  }
  const item = (slot: string, op: string, label: string, status: string, extra: Record<string, unknown> = {}) => ({
    slot, op, label, status, attempt: 1, creditsSpent: status === 'succeeded' ? 40 : 0, creditsRefunded: 0, outputs: [], ...extra,
  })
  const inputs = { businessType: 'A dog groomer in Austin', audience: 'Local dog owners', starter: 'business', pages: 2, submissions: 'inbox', welcomeEmail: false }
  const steps = (plan: string, generate: string) => [
    { name: 'plan', status: plan, startedAt: plan === 'pending' ? null : '2026-10-07T17:11:06.000Z', endedAt: null, creditsSpent: plan === 'done' ? 12 : 0, error: null },
    { name: 'generate', status: generate, startedAt: generate === 'pending' && plan !== 'done' ? null : '2026-10-07T17:12:08.000Z', endedAt: null, creditsSpent: 0, error: null },
  ]
  const at = () => new Date().toISOString()
  const ledger = (home: string, contact = 'pending') => [
    item('l', 'layout', 'Main Layout', 'succeeded', { settledAt: '2026-10-07T17:12:30.000Z' }),
    item('f', 'form', 'Contact Request Form', 'succeeded', { settledAt: '2026-10-07T17:12:45.000Z' }),
    item('p0', 'page', 'Home', home),
    item('p1', 'page', 'Contact', contact),
  ]
  const base = { kind: 'site', siteInputs: inputs, autoConfirm: true, outputs: [], creditsSpent: 0 }
  const SNAPSHOTS: Array<[string, AiJobSummary]> = [
    ['queued', job({ ...base, status: 'queued', running: false, plan: null, steps: steps('pending', 'pending') } as never)],
    ['planning', job({ ...base, status: 'running', plan: null, steps: steps('running', 'pending') } as never)],
    [
      'parked on its plan for the instant the machine confirms it',
      job({ ...base, status: 'needs_review', running: false, plan: { ...PROD_PLAN, status: 'proposed' }, review: { reason: 'plan', message: 'The plan is ready.', findings: [] }, creditsSpent: 12, updatedAt: at(), steps: steps('done', 'pending') } as never),
    ],
    ['confirmed and queued', job({ ...base, status: 'queued', running: false, plan: PROD_PLAN, creditsSpent: 12, steps: steps('done', 'pending') } as never)],
    ['building, no ledger yet', job({ ...base, status: 'running', plan: PROD_PLAN, creditsSpent: 12, steps: steps('done', 'running') } as never)],
    ['between passes, the ledger written', job({ ...base, status: 'queued', running: false, plan: PROD_PLAN, creditsSpent: 97, steps: steps('done', 'pending'), items: ledger('pending') } as never)],
    ['writing Home', job({ ...base, status: 'running', plan: PROD_PLAN, creditsSpent: 97, steps: steps('done', 'running'), items: ledger('pending') } as never)],
    [
      'Home failed, writing Contact',
      job({ ...base, status: 'running', plan: PROD_PLAN, creditsSpent: 196, refundedCredits: 99, steps: steps('done', 'running'), items: ledger('failed').map((one) => (one.slot === 'p0' ? { ...one, creditsSpent: 99, creditsRefunded: 99, settledAt: '2026-10-07T17:13:05.000Z', failure: { ours: true, reason: 'step-failure', message: 'It could not be built this time.' } } : one)) } as never),
    ],
  ]

  it('never reads a moving job as failed, stopped or unloadable', async () => {
    let push: (next: AiJobSummary) => void = () => undefined
    mockFollow.mockReset()
    mockFollow.mockImplementation((_u: unknown, _o: string, _i: string, signal: AbortSignal, onJob: (next: AiJobSummary) => void) => {
      push = onJob
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve('ok')))
    })
    render(<AiSiteBuildPage hostId="host-1" segments={['job-1']} basePath="/acme/hosts/groomer/ai-jobs" entitled />)
    await waitFor(() => expect(mockFollow).toHaveBeenCalled())
    for (const [name, snapshot] of SNAPSHOTS) {
      act(() => push(snapshot))
      const where = `at "${name}"`
      expect([where, screen.getByRole('heading', { level: 1 }).textContent]).toEqual([where, 'Building your site'])
      // Only a part that really failed is marked so, and it says the build goes on.
      expect([where, screen.queryAllByRole('img', { name: 'Couldn’t be built' }).length]).toEqual([where, name.startsWith('Home failed') ? 1 : 0])
      if (name.startsWith('Home failed')) expect(screen.getByText(/The rest of your site keeps building\./)).toBeTruthy()
      expect([where, screen.queryByText(/could not be loaded|was not built|The plan is ready/)]).toEqual([where, null])
      expect([where, screen.queryByRole('button', { name: /Confirm|Try again/ })]).toEqual([where, null])
      // Something is always shown as in progress while the job moves.
      expect([where, screen.getAllByLabelText('In progress').length]).toEqual([where, 1])
    }
  })

  it('shows the page being written as building, with its hint, sections and time, once the ledger exists', () => {
    const rows = aiSiteBuildRows(SNAPSHOTS[6][1])
    expect(rows.map((row) => [row.label, row.state])).toEqual([
      ['Planning your pages', 'done'],
      ['Building the header and footer: Main Layout', 'done'],
      ['Building the form: Contact Request Form', 'done'],
      ['Writing page 1 of 2: Home', 'active'],
      ['Writing page 2 of 2: Contact', 'waiting'],
      ['Publishing your site', 'waiting'],
    ])
    expect(rows[3]).toMatchObject({ hint: AI_SITE_PAGE_HINT, startedAt: '2026-10-07T17:12:45.000Z', sections: ['hero', 'services'] })
    // The plan keeps its credits once the items take over (prod 2026-10-07, job yazWNJr9k-).
    expect(rows[0].credits).toBe(12)
    // The next item counts from the failed one's settle.
    const next = aiSiteBuildRows(SNAPSHOTS[7][1])
    expect(next.map((row) => row.state)).toEqual(['done', 'done', 'done', 'failed', 'active', 'waiting'])
    expect(next[4].startedAt).toBe('2026-10-07T17:13:05.000Z')
    // A part that is not a page says it is being built.
    const layout = aiSiteBuildRows(job({ ...SNAPSHOTS[6][1], items: ledger('pending').map((one) => (one.slot === 'f' ? { ...one, status: 'pending', settledAt: undefined } : one)) } as never))
    expect(layout[2]).toMatchObject({ state: 'active', hint: AI_SITE_ITEM_HINT, startedAt: '2026-10-07T17:12:30.000Z' })
  })

  it('draws the active page’s hint and its sections as being written', async () => {
    await open(SNAPSHOTS[6][1])
    expect(await screen.findByText(AI_SITE_PAGE_HINT)).toBeTruthy()
    expect(screen.getByText('Writing: hero, services')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: 'Waiting' })).toHaveLength(2)
  })

  it('shows the look as the active row while it is designed, before the ledger exists, and done once it does (AGL-3660)', () => {
    // The scaffold writes its ledger only with the look's own outcome, so
    // while the look is designed the job has a plan and no items.
    const designing = aiSiteBuildRows(SNAPSHOTS[4][1])
    expect(designing.map((row) => [row.label, row.state])).toEqual([
      ['Planning your pages', 'done'],
      ['Designing your look', 'active'],
      ['Building the header and footer: Main Layout', 'waiting'],
      ['Building the form: Contact Request Form', 'waiting'],
      ['Writing page 1 of 2: Home', 'waiting'],
      ['Writing page 2 of 2: Contact', 'waiting'],
      ['Publishing your site', 'waiting'],
    ])
    expect(designing[1]).toMatchObject({ id: 'look', hint: AI_SITE_LOOK_HINT, startedAt: '2026-10-07T17:12:08.000Z' })
    // Confirmed and queued for its first pass: the look is next, and still the one shown as in progress.
    expect(aiSiteBuildRows(SNAPSHOTS[3][1])[1]).toMatchObject({ label: 'Designing your look', state: 'active' })
    // Once its pass writes the ledger, the look is done and the layout is on.
    const after = aiSiteBuildRows(
      job({
        ...(SNAPSHOTS[6][1] as object),
        items: [item('t', 'theme', 'Your look', 'succeeded', { settledAt: '2026-10-07T17:12:20.000Z' }), ...ledger('pending').map((one) => (one.slot === 'l' || one.slot === 'f' ? { ...one, status: 'pending', settledAt: undefined } : one))],
      } as never),
    )
    expect(after.slice(0, 3).map((row) => [row.label, row.state])).toEqual([
      ['Planning your pages', 'done'],
      ['Designing your look', 'done'],
      ['Building the header and footer: Main Layout', 'active'],
    ])
    // A job paused by the meter before its look reads paused there, not waiting.
    const paused = aiSiteBuildRows(job({ ...(SNAPSHOTS[4][1] as object), status: 'needs_input', running: false } as never))
    expect(paused[1]).toMatchObject({ label: 'Designing your look', state: 'paused' })
  })

  it('draws the look’s row as in progress, with its hint', async () => {
    await open(SNAPSHOTS[4][1])
    expect(await screen.findByText(AI_SITE_LOOK_HINT)).toBeTruthy()
    const row = screen.getByText('Designing your look').closest('li') as HTMLElement
    expect(row.querySelector('[aria-label="In progress"]')).toBeTruthy()
  })

  it('reads a plan parked past the confirmation’s grace as what it is', () => {
    const stale = job({ ...(SNAPSHOTS[2][1] as object), updatedAt: '2026-10-07T00:00:00.000Z' } as never)
    expect(aiJobPageCopy(stale, 'Aglyn').heading).toBe('Your site was not built')
    expect(aiJobPageCopy(SNAPSHOTS[2][1], 'Aglyn').heading).toBe('Building your site')
    // A job that does not confirm its own plan is parked on it.
    expect(aiJobPageCopy(job({ ...(SNAPSHOTS[2][1] as object), autoConfirm: undefined } as never), 'Aglyn').heading).toBe('Your site was not built')
  })
})

/*
 * The founder, 2026-10-07: the page never showed the contact form being
 * built (AGL-3596). The guided start always plans one, so its row is there
 * from the start, between the header and footer and the pages, and it is the
 * active row while the form is built.
 */
describe('the contact form’s stage (AGL-3596)', () => {
  const PLAN_WITH_FORM = {
    ...PLAN,
    create: [
      { kind: 'layout', name: 'Main Layout', why: 'The frame.', duplicateOf: null, fields: [] },
      { kind: 'form', name: 'Contact Request Form', why: 'Requests.', duplicateOf: null, fields: [] },
    ],
  }
  const steps = [
    { name: 'plan', status: 'done', startedAt: '2026-10-07T17:11:06.000Z', endedAt: null, creditsSpent: 12, error: null },
    { name: 'generate', status: 'running', startedAt: '2026-10-07T17:12:08.000Z', endedAt: null, creditsSpent: 0, error: null },
  ]
  const ledger = (slot: string, op: string, label: string, status: string, extra: Record<string, unknown> = {}) => ({
    slot, op, label, status, attempt: 1, creditsSpent: status === 'succeeded' ? 48 : 0, creditsRefunded: 0, outputs: [], ...extra,
  })
  /** The header and footer built; the form is next. */
  const FORM_NEXT = () =>
    job({
      kind: 'site',
      status: 'running',
      plan: PLAN_WITH_FORM,
      steps,
      siteInputs: { businessType: 'A dog groomer in Austin', pages: 2, submissions: 'inbox' },
      items: [
        ledger('l', 'layout', 'Main Layout', 'succeeded', { settledAt: '2026-10-07T17:12:30.000Z' }),
        ledger('f', 'form', 'Contact Request Form', 'pending'),
        ledger('p0', 'page', 'Home', 'pending'),
        ledger('p1', 'page', 'Book', 'pending'),
      ],
    } as never)

  it('lists the form before the plan exists, in build order', () => {
    const rows = aiSiteBuildRows(
      job({
        kind: 'site',
        plan: null,
        steps: [
          { name: 'plan', status: 'running', startedAt: '2026-10-07T17:11:06.000Z', endedAt: null, creditsSpent: 0, error: null },
          { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
        ],
        siteInputs: { businessType: 'A dog groomer in Austin', pages: 2, submissions: 'lead' },
      } as never),
    )
    expect(rows.map((row) => row.label)).toEqual([
      'Planning your pages',
      'Designing your look',
      'Building the header and footer',
      'Building your contact form',
      'Writing your 2 pages',
      'Publishing your site',
    ])
  })

  it('makes the form the active row once the header and footer are built, counted from then', () => {
    const rows = aiSiteBuildRows(FORM_NEXT())
    expect(rows.map((row) => [row.label, row.state])).toEqual([
      ['Planning your pages', 'done'],
      ['Building the header and footer: Main Layout', 'done'],
      ['Building the form: Contact Request Form', 'active'],
      ['Writing page 1 of 2: Home', 'waiting'],
      ['Writing page 2 of 2: Book', 'waiting'],
      ['Publishing your site', 'waiting'],
    ])
    expect(rows[2]).toMatchObject({ hint: AI_SITE_ITEM_HINT, startedAt: '2026-10-07T17:12:30.000Z' })
  })

  it('draws the form’s row as in progress, with its hint', async () => {
    await open(FORM_NEXT())
    expect(await screen.findByText(AI_SITE_ITEM_HINT)).toBeTruthy()
    const row = screen.getByText('Building the form: Contact Request Form').closest('li') as HTMLElement
    expect(row.querySelector('[aria-label="In progress"]')).toBeTruthy()
  })
})

/*
 * The prod case (AGL-3660): a Free start ran out of credits between its form
 * and its first page. The machine PAUSES the job (`needs_input`); the page
 * must say so — not "was not built" — with what is built, the way to more
 * credits, and Resume on the same job.
 */
describe('a site the meter paused (AGL-3660)', () => {
  const OUT = 'Your free AI credits for this month are used across your workspaces — upgrade any workspace to keep going.'
  const ledger = (slot: string, op: string, label: string, status: string) => ({
    slot, op, label, status, attempt: 1, creditsSpent: status === 'succeeded' ? 24 : 0, creditsRefunded: 0, outputs: [],
  })
  const PAUSED = () =>
    job({
      status: 'needs_input',
      running: false,
      error: OUT,
      creditsSpent: 76,
      steps: [
        { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 21, error: null },
        { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 55, error: null },
      ],
      items: [
        ledger('t', 'theme', 'Look', 'succeeded'),
        ledger('l', 'layout', 'Main Layout', 'succeeded'),
        ledger('f', 'form', 'Contact Request Form', 'succeeded'),
        // A page the ledger still marks running when the meter refused its pass.
        ledger('p0', 'page', 'Home', 'running'),
        ledger('p1', 'page', 'Book', 'pending'),
      ],
    } as never)

  beforeEach(() => mockFetch.mockReset())

  it('reads as paused, not as a site that was not built, with what is built and that nothing is lost', () => {
    const copy = aiJobPageCopy(PAUSED(), 'Aglyn')
    expect(copy.heading).toBe('Your site is paused')
    expect(copy.lede).toBe(
      `${OUT} Built so far: your look, the header and footer and the form “Contact Request Form”. ${AI_JOB_PAUSED_NEXT_COPY}`,
    )
  })

  it('shows no spinner: the row it stopped at is paused, and the rest wait', () => {
    const rows = aiSiteBuildRows(PAUSED())
    expect(rows.map((row) => row.state)).toEqual(['done', 'done', 'done', 'done', 'paused', 'waiting', 'skipped'])
    expect(rows.find((row) => row.state === 'paused')).toMatchObject({ label: 'Writing page 1 of 2: Home', hint: null, startedAt: null })
    expect(rows.some((row) => row.state === 'active')).toBe(false)
  })

  it('offers Get more AI credits in Billing and Resume, which carries on the same job', async () => {
    await open(PAUSED())
    expect(await screen.findByRole('heading', { name: 'Your site is paused' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your site was not built' })).toBeNull()
    expect(screen.queryByLabelText('In progress')).toBeNull()
    expect(screen.getByRole('img', { name: 'Paused' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Get more AI credits' }).getAttribute('href')).toBe('/acme/billing#plans')
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job: { ...PAUSED(), status: 'running', error: null } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/ai/jobs/job-1/resume')
    expect(JSON.parse(init.body)).toEqual({ orgId: 'org-1', hostId: 'host-1' })
    expect(await screen.findByRole('heading', { name: 'Building your site' })).toBeTruthy()
  })

  it('says the door’s words when credits are still out, and stays paused', async () => {
    await open(PAUSED())
    await screen.findByRole('heading', { name: 'Your site is paused' })
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: OUT }) })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findAllByText(OUT)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your site is paused' })).toBeTruthy()
  })
})

describe('canceling from the job’s page (AGL-3616)', () => {
  beforeEach(() => mockFetch.mockReset())

  it('a running job offers Cancel, says what it does first, and shows the job stopping', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ changed: true, job: job({ cancelRequested: true }) }),
    })
    await open(job())
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(
      await screen.findByText(
        'Stop building. Pages already built stay as drafts; you won’t be charged for steps that haven’t run.',
      ),
    ).toBeTruthy()
    // Nothing is sent until the person confirms.
    expect(mockFetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [, url, init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(url).toBe('/api/ai/jobs/job-1/cancel')
    expect(JSON.parse(String(init.body))).toEqual({ orgId: 'org-1' })
    // The dialog closes on the door's answer, and the page shows the job stopping.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      await screen.findByText('Stopping. The step in progress finishes or stops first, and nothing after it runs.'),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a refused cancel says why in the dialog and leaves the job as it was', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Your role does not include "Use AI to generate" — ask an organization admin' }),
    })
    await open(job())
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel job' }))
    expect(await screen.findByText(/Your role does not include/)).toBeTruthy()
    // The dialog stays open over the page, which still reads as building.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Building your site', hidden: true })).toBeTruthy()
  })

  it('a canceled guided start says what it cost, and offers Start again and the starter site', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ jobs: [], freeTaste: true }) })
    await open(
      job({
        status: 'canceled',
        running: false,
        creditsSpent: 9,
        creditsReserved: 0,
        siteInputs: { businessType: 'dog grooming salon', pages: 2 },
      } as never),
    )
    expect(await screen.findByRole('heading', { name: 'You canceled your site' })).toBeTruthy()
    expect(screen.getByText(/Anything it already built stays as an unpublished draft/)).toBeTruthy()
    expect(screen.getByText('This job used 9 credits before it stopped.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use the starter site instead' })).toBeTruthy()
    // Not a failure: no "something went wrong".
    expect(screen.queryByText(/Something went wrong/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Cancel is disabled, with its reason, once the job is done or failed', async () => {
    await open(job({ status: 'done', running: false, outputs: [screenOutput('home')] as never }))
    const done = (await screen.findByRole('button', { name: 'Cancel' })) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    expect(screen.getByLabelText('This job already finished.')).toBeTruthy()
  })
})
