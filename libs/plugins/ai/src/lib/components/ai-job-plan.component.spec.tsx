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
 * The credit estimate on a plan waiting for confirmation (AGL-2911): the
 * guard rail is read BEFORE the plan is confirmed, and only then — a plan
 * already confirmed is being spent, not decided.
 */

const mockFetch = jest.fn()
const mockTrack = jest.fn()
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { aiSiteStarterFallbackOffered } from '../model/ai-job-failure-copy'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_SITE_PASS_CREDITS, aiPlanCreditEstimate } from '../model/ai-site-job'
import { AiJobPlan, aiJobReviewDetails, aiPlanEmbedLine } from './ai-job-plan.component'

const PLAN = {
  reuse: [],
  create: [
    {
      kind: 'layout' as const,
      name: 'Frame',
      why: 'every page',
      duplicateOf: null,
      fields: [],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: 'home',
      layout: 'new:Frame',
      template: null,
      record: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Home',
      seoDescription: 'The home page',
      sections: [
        { name: 'hero', uses: [], items: 0 },
        { name: 'services', uses: [], items: 3 },
      ],
    },
  ],
  status: 'proposed' as const,
  labels: {},
  proposedAt: '2026-09-16T00:00:00.000Z',
  confirmedAt: null,
  confirmedBy: null,
}

function job(patch: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'needs_review',
    brief: 'A site for a dog groomer',
    batch: null,
    steps: [],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    error: null,
    running: false,
    plan: PLAN,
    review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
    ...patch,
  }
}

it('shows what the plan is estimated to cost beside the button that confirms it', () => {
  render(<AiJobPlan job={job()} onResume={jest.fn()} />)
  const expected = aiPlanCreditEstimate(PLAN)
  expect(
    screen.getByText(
      new RegExp(`about ${expected.toLocaleString('en-US')} credits`),
    ),
  ).toBeTruthy()
  expect(screen.getByText(/what its steps spend/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Confirm plan' })).toBeTruthy()
})

it('says a screen starts from a copy, as a creation does (AGL-3024)', () => {
  // A `create` row has always disclosed "from a copy of"; a screen row said
  // "Builds the screen", full stop. Measured live 2026-09-21: the member
  // confirmed a plan reading "Builds the screen Practice Areas", and the step
  // took its copy branch and duplicated an existing page instead. A plan is
  // the contract the member confirms and pays against, so the word for what
  // it will do has to be the true one.
  const copying = {
    ...PLAN,
    screens: [{ ...PLAN.screens[0], duplicateOf: 'scr-home' }],
  }
  render(<AiJobPlan job={job({ plan: copying })} onResume={jest.fn()} />)
  const row = screen.getByText(/the page Home/)
  expect(row.textContent).toContain('from a copy of')
})

it('says nothing about cost once the plan is being built', () => {
  render(
    <AiJobPlan
      job={job({
        status: 'running',
        review: null,
        plan: { ...PLAN, status: 'confirmed', confirmedBy: 'u1' },
      })}
      onResume={jest.fn()}
    />,
  )
  expect(screen.queryByText(/Estimated cost/)).toBeNull()
  expect(screen.getByText(/Confirmed plan/)).toBeTruthy()
})

it('says nothing about cost on a step that broke a rule, which spends nothing new', () => {
  render(
    <AiJobPlan
      job={job({
        plan: { ...PLAN, status: 'confirmed', confirmedBy: 'u1' },
        review: {
          reason: 'doctrine',
          message: 'A rule was broken.',
          findings: [],
        },
      })}
      onResume={jest.fn()}
    />,
  )
  expect(screen.queryByText(/Estimated cost/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})

it('confirms through the caller’s own door', () => {
  const onResume = jest.fn()
  render(<AiJobPlan job={job()} onResume={onResume} />)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm plan' }))
  expect(onResume).toHaveBeenCalledTimes(1)
})

it('counts, for a page job, every creation it builds before its page, beside what each is (AGL-3031)', () => {
  const pagePlan = {
    ...PLAN,
    create: [
      ...PLAN.create,
      { kind: 'component' as const, name: 'Price tier', why: 'three tiers', duplicateOf: null, fields: [] },
      { kind: 'form' as const, name: 'Quote request', why: 'no form yet', duplicateOf: null, fields: [] },
    ],
  }
  render(<AiJobPlan job={job({ kind: 'page', plan: pagePlan })} onResume={jest.fn()} />)
  // Two sections and the page's last pass, and one pass a creation.
  const expected = (2 + 1 + 3) * AI_SITE_PASS_CREDITS
  expect(screen.getByText(new RegExp(`about ${expected.toLocaleString('en-US')} credits`))).toBeTruthy()
  expect(screen.getByText(/Creates the component Price tier/)).toBeTruthy()
  expect(screen.getByText(/Creates the form Quote request/)).toBeTruthy()
})

describe('where a refused answer broke its rules (AGL-3078)', () => {
  const REFUSED = job({
    kind: 'page',
    plan: { ...PLAN, status: 'confirmed', confirmedBy: 'u1' },
    review: {
      reason: 'doctrine',
      message: 'This could not be built within the building rules.',
      findings: [
        { rule: 12, code: 'grid-not-container', message: 'A Grid lays out columns only as a container.', nodeIds: ['areas-grid'] },
        { rule: 2, code: 'plan-screen-without-layout', message: 'A screen names no layout.', paths: ['screens[0].layout'] },
        { rule: null, code: 'answer-cut-off', message: 'This section was too large to build in one pass.' },
      ],
      outline: [
        { id: 'areas-grid', depth: 0, componentId: 'muiGrid', props: ['ariaLabel', 'container'], sx: ['gap'], grid: { container: 'True' }, children: ['muiGrid'] },
        { id: 'cell-1', depth: 1, componentId: 'muiGrid', props: ['size'], grid: { size: '4' }, children: ['muiCard'] },
      ],
    },
  })

  it('reads each finding’s nodes or plan entries, then the outline by depth', () => {
    expect(aiJobReviewDetails(REFUSED.review)).toEqual([
      'Rule 12 grid-not-container: nodes areas-grid',
      'Rule 2 plan-screen-without-layout: at screens[0].layout',
      'areas-grid muiGrid · container="True" · props ariaLabel, container · sx gap · holds muiGrid',
      '  cell-1 muiGrid · size="4" · props size · holds muiCard',
    ])
    expect(aiJobReviewDetails({ reason: 'plan', message: 'The plan is ready.', findings: [] })).toEqual([])
    expect(aiJobReviewDetails(null)).toEqual([])
  })

  it('shows staff what was refused, collapsed until asked for', () => {
    render(<AiJobPlan job={REFUSED} onResume={jest.fn()} staff />)
    expect(screen.getByText('A Grid lays out columns only as a container.')).toBeTruthy()
    expect(screen.queryByLabelText('What was refused')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show what was refused' }))
    expect(screen.getByLabelText('What was refused').textContent).toBe(aiJobReviewDetails(REFUSED.review).join('\n'))
    expect(screen.getByRole('button', { name: 'Hide what was refused' })).toBeTruthy()
  })

  it('shows a member the findings and nothing of what was refused', () => {
    render(<AiJobPlan job={REFUSED} onResume={jest.fn()} />)
    expect(screen.getByText('A Grid lays out columns only as a container.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show what was refused' })).toBeNull()
    expect(screen.queryByText(/areas-grid/)).toBeNull()
  })
})

describe('a plan refused in words written for the member (AGL-3594)', () => {
  const PLAIN = job({
    kind: 'site',
    plan: null,
    review: {
      reason: 'doctrine',
      message: 'Something went wrong planning your site, and it did not use any of your AI credits. Try again.',
      detail: 'This could not be built within the building rules. Rule 10 (Navigation and SEO travel with a page): A page reuses an address…',
      findings: [{ rule: 10, code: 'plan-slug-taken', message: 'A page reuses an address the site or the plan already uses (/).', paths: ['screens[0].slug'] }],
    },
  })

  it('shows a member no rule and no finding, and Try again', () => {
    render(<AiJobPlan job={PLAIN} onResume={jest.fn()} />)
    expect(screen.queryByText(/Rule 10/)).toBeNull()
    expect(screen.queryByText(/reuses an address/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows staff the checks’ own sentence and the findings', () => {
    render(<AiJobPlan job={PLAIN} onResume={jest.fn()} staff />)
    expect(screen.getByText(/Rule 10/)).toBeTruthy()
    expect(screen.getByText('A page reuses an address the site or the plan already uses (/).')).toBeTruthy()
  })

  it('disables Try again with its reason when the Free allowance cannot cover a plan', () => {
    const reason = 'You have 10 AI credits left this month, and a plan needs up to 35. Your credits refresh next month, or upgrade for more.'
    render(<AiJobPlan job={job({ ...PLAIN, review: { ...PLAIN.review!, retryRefusal: reason } })} onResume={jest.fn()} />)
    expect(screen.getByText(reason)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('a planned third-party player, read with its cost before it is confirmed (AGL-3433)', () => {
  const named = (ref: string) => (ref.startsWith('new:') ? ref.slice(4) : ref)

  it('names the host, where it plays, the brief’s words and what it loads', () => {
    expect(
      aiPlanEmbedLine(
        { host: 'youtube', where: '/about', asked: 'our intro video', url: 'https://youtu.be/dQw4w9WgXcQ' },
        named,
      ),
    ).toBe(
      'Embeds a YouTube player on /about playing https://youtu.be/dQw4w9WgXcQ, as you asked (“our intro video”). It loads YouTube’s own code when a visitor reaches it, whether or not they press play.',
    )
    expect(
      aiPlanEmbedLine({ host: 'vimeo', where: 'new:Crew video', asked: 'the Vimeo walkthrough', url: null }, named),
    ).toBe(
      'Embeds a Vimeo player on the component Crew video, its link left for you to paste, as you asked (“the Vimeo walkthrough”). It loads Vimeo’s own code when a visitor reaches it, whether or not they press play.',
    )
  })

  it('lists it with the plan a member confirms', () => {
    const plan = {
      ...PLAN,
      screens: [{ ...PLAN.screens[0], slug: '/about' }],
      embeds: [{ host: 'youtube' as const, where: '/about', asked: 'our intro video', url: null }],
    }
    render(<AiJobPlan job={job({ plan })} onResume={() => undefined} />)
    expect(screen.getByText(/Embeds a YouTube player on \/about/).textContent).toContain('whether or not they press play')
  })
})

describe('a guided start that did not work out offers the starter instead (AGL-3594)', () => {
  const REFUSED = job({
    plan: null,
    review: { reason: 'doctrine', message: 'Something went wrong planning your site. Try again.', findings: [] },
  })

  it('is offered for a site job that failed, was canceled or stopped on a refused step, while it built nothing', () => {
    expect(aiSiteStarterFallbackOffered(REFUSED)).toBe(true)
    expect(aiSiteStarterFallbackOffered({ ...REFUSED, status: 'failed', review: null })).toBe(true)
    expect(aiSiteStarterFallbackOffered({ ...REFUSED, status: 'canceled', review: null })).toBe(true)
    // A plan to confirm, a job that built something, a running job or another kind: no.
    expect(aiSiteStarterFallbackOffered(job())).toBe(false)
    expect(aiSiteStarterFallbackOffered({ ...REFUSED, outputs: [{ resource: 'screen', id: 's', hostId: 'host-1', label: 'Home' }] as never })).toBe(false)
    expect(aiSiteStarterFallbackOffered({ ...REFUSED, status: 'running' })).toBe(false)
    expect(aiSiteStarterFallbackOffered({ ...REFUSED, kind: 'page' })).toBe(false)
  })

  it('asks the console for the starter and says so, reporting the first publish once', async () => {
    mockFetch.mockReset()
    mockTrack.mockReset()
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ provisioned: true, screenId: 'scrHome' }) })
    render(<AiJobPlan job={REFUSED} onResume={jest.fn()} user={mockUser as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use the starter site instead' }))
    await screen.findByText(/now has the starter home page/)
    expect(mockFetch.mock.calls[0][1]).toBe('/api/hosts/starter')
    expect(JSON.parse(mockFetch.mock.calls[0][2].body)).toEqual({ hostId: 'host-1' })
    await waitFor(() => expect(mockTrack).toHaveBeenCalledWith('site_published', { first_publish: true }))
    expect(mockTrack).toHaveBeenCalledTimes(1)
  })

  it('is not offered beside a plan waiting to be confirmed', () => {
    render(<AiJobPlan job={job()} onResume={jest.fn()} user={mockUser as never} />)
    expect(screen.queryByRole('button', { name: 'Use the starter site instead' })).toBeNull()
  })

  it('is drawn only where the surface hands it the signed-in user', () => {
    render(<AiJobPlan job={REFUSED} onResume={jest.fn()} />)
    expect(screen.queryByRole('button', { name: 'Use the starter site instead' })).toBeNull()
  })
})
