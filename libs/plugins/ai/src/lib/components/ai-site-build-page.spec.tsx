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

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { aiJobPageCopy, aiSiteBuildCreditsLine, aiSiteBuildRows } from '../model/ai-site-build-progress'
import { AI_JOB_FIRST_STATE_TIMEOUT_MS, AiSiteBuildPage } from './ai-site-build-page.component'

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
    ])
    expect(aiSiteBuildRows(job({ plan: null, steps: [{ name: 'plan', status: 'running' }] as never })).map((row) => row.state)).toEqual(['active'])
    expect(aiSiteBuildRows(job({ status: 'failed', outputs: [screenOutput('home')] as never })).map((row) => row.state)).toEqual(['done', 'done', 'failed'])
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
