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

import { fireEvent, render, screen } from '@testing-library/react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_SITE_PASS_CREDITS, aiPlanCreditEstimate } from '../model/ai-site-job'
import { AiJobPlan } from './ai-job-plan.component'

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
