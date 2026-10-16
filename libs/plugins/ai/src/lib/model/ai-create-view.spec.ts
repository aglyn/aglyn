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
 * Create with AI as the apps draw it (AGL-3854): the door a list reads and the
 * follow view of the job it starts, in the same words the console's dialog,
 * upsell and follow card say.
 */

import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { AI_BRIEF_COPY, AI_BRIEF_MAX_CHARS } from './ai-brief-copy'
import { aiJobCreditRange } from './ai-build-job'
import { AI_PAGE_TYPES } from './ai-page-job'
import {
  AI_CREATE_KINDS,
  AI_JOB_FOLLOW_PHASE_LINES,
  aiCreateCreditsView,
  aiCreateDoorView,
  aiJobFollowOpen,
  aiJobFollowView,
  aiJobOutputAppLinks,
  isAiCreateKind,
  type AiCreateDoorInput,
} from './ai-create-view'
import { AI_SITE_BUILD_IN_FLIGHT_COPY } from './ai-job-activity'
import type { AiJobSummary } from './ai-jobs.types'
import { AI_UPSELL_COPY, aiUpsellOffer } from './ai-upsell-copy'

const door = (patch: Partial<AiCreateDoorInput> = {}): AiCreateDoorInput => ({
  kind: 'page',
  shown: true,
  entitled: true,
  purchasable: false,
  canManageBilling: false,
  credits: { kind: 'none' },
  addonName: 'Aglyn AI',
  ...patch,
})

describe('the door a list reads', () => {
  it('offers the five lists the apps draw it on', () => {
    expect([...AI_CREATE_KINDS]).toEqual(['page', 'template', 'layout', 'form', 'component'])
    expect(isAiCreateKind('layout')).toBe(true)
    expect(isAiCreateKind('email')).toBe(false)
    expect(isAiCreateKind(undefined)).toBe(false)
  })

  it('draws nothing where a gate the shell climbs refuses', () => {
    const view = aiCreateDoorView(door({ shown: false }))
    expect(view.door).toBe('hidden')
    expect(view.copy).toBeNull()
    expect(view.upsell).toBeNull()
  })

  it('draws nothing on a plan without the feature that could not buy it', () => {
    expect(aiCreateDoorView(door({ entitled: false, purchasable: false })).door).toBe('hidden')
  })

  it('is its own upsell where only the add-on is missing, with the action for those who can buy it', () => {
    const owner = aiCreateDoorView(door({ kind: 'layout', entitled: false, purchasable: true, canManageBilling: true }))
    expect(owner.door).toBe('upsell')
    expect(owner.label).toBe('Create with AI')
    expect(owner.upsell).toEqual({
      title: AI_UPSELL_COPY.layout.title,
      does: AI_UPSELL_COPY.layout.does,
      offer: aiUpsellOffer(true),
      canManageBilling: true,
      action: 'Add Aglyn AI',
      dismiss: 'Not now',
    })
    const member = aiCreateDoorView(door({ entitled: false, purchasable: true, canManageBilling: false }))
    expect(member.upsell?.action).toBeNull()
    expect(member.upsell?.dismiss).toBe('Close')
    expect(member.upsell?.offer).toContain('Ask a workspace owner or admin')
  })

  it('says every word the console’s brief dialog says, with the kind’s own chips', () => {
    const page = aiCreateDoorView(door())
    expect(page.door).toBe('create')
    expect(page.copy).toEqual(AI_BRIEF_COPY.page)
    expect(page.briefMaxChars).toBe(AI_BRIEF_MAX_CHARS)
    expect(page.choices).toEqual([
      expect.objectContaining({ key: 'pageType', label: 'Page type (optional)', required: false }),
    ])
    expect(page.choices[0].options).toEqual(AI_PAGE_TYPES.map((type) => ({ id: type.id, label: type.label })))
    expect(page.choices[0].options[0]).toEqual({ id: 'landing', label: 'Landing' })
    expect(page.collections).toBeNull()

    const template = aiCreateDoorView(
      door({ kind: 'template', collections: { status: 'success', options: [{ id: 'c1', name: 'Team' }] } }),
    )
    expect(template.choices).toEqual([
      {
        key: 'subject',
        label: 'One page for each (required)',
        required: true,
        options: [
          { id: 'entry', label: 'Collection entry' },
          { id: 'product', label: 'Product' },
          { id: 'author', label: 'Author' },
        ],
      },
    ])
    expect(template.collections).toEqual({
      when: 'entry',
      label: 'Collection',
      options: [{ id: 'c1', name: 'Team' }],
      helper: 'Each page shows one entry of this collection.',
    })
    expect(
      aiCreateDoorView(door({ kind: 'template', collections: { status: 'success', options: [] } })).collections?.helper,
    ).toBe('This site has no content collections yet. Add one in Content first.')

    for (const kind of ['layout', 'form', 'component'] as const) {
      const view = aiCreateDoorView(door({ kind }))
      expect(view.copy).toEqual(AI_BRIEF_COPY[kind])
      expect(view.choices).toEqual([])
    }
  })

  it('warns, and still starts, while another page is being built on the site', () => {
    expect(aiCreateDoorView(door({ buildInFlight: true })).building).toBe(AI_SITE_BUILD_IN_FLIGHT_COPY)
    expect(aiCreateDoorView(door({ kind: 'layout', buildInFlight: true })).building).toBeNull()
  })
})

describe('the credits line above the brief', () => {
  it('says what a Free workspace has left, and when it runs out', () => {
    expect(aiCreateCreditsView({ kind: 'free', left: { left: 120, total: 300, resetsOn: '2026-11-01' } })).toEqual({
      text: 'You have 120 of your 300 free AI credits left this month, until November 1.',
      exhausted: false,
    })
    expect(aiCreateCreditsView({ kind: 'free', left: { left: 0, total: 300, resetsOn: '2026-11-01' } })).toEqual({
      text: 'You have used your free AI credits for this month. They come back on November 1.',
      exhausted: true,
    })
  })

  it('says a paid band’s remainder, and whether past it stops or bills', () => {
    expect(aiCreateCreditsView({ kind: 'band', used: 1_000, limit: 7_500, remaining: 6_500, stopsAtBand: true })).toEqual({
      text: '6,500 of 7,500 AI credits left this month.',
      exhausted: false,
    })
    expect(aiCreateCreditsView({ kind: 'band', used: 7_500, limit: 7_500, remaining: 0, stopsAtBand: true })).toEqual({
      text: 'This workspace used its AI credits for the month.',
      exhausted: true,
    })
    expect(aiCreateCreditsView({ kind: 'band', used: 7_600, limit: 7_500, remaining: 0, stopsAtBand: false })?.exhausted).toBe(
      false,
    )
    expect(aiCreateCreditsView({ kind: 'unlimited' })?.text).toBe('AI credits are not capped on this workspace.')
    expect(aiCreateCreditsView({ kind: 'none' })).toBeNull()
  })
})

const PLAN = {
  reuse: [],
  create: [{ kind: 'layout' as const, name: 'Frame', why: 'every page', duplicateOf: null, fields: [] }],
  screens: [
    {
      title: 'Spring offer',
      slug: '/spring',
      layout: 'new:Frame',
      template: null,
      record: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Spring offer',
      seoDescription: 'The spring offer',
      sections: [
        { name: 'hero', uses: [], items: 0 },
        { name: 'quote form', uses: [], items: 0 },
      ],
    },
  ],
  status: 'proposed' as const,
  labels: {},
  proposedAt: '2026-10-16T00:00:00.000Z',
  confirmedAt: null,
  confirmedBy: null,
}

function job(patch: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'page',
    status: 'needs_review',
    brief: 'A landing page for our spring offer',
    batch: null,
    steps: [
      { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 4, error: null },
      { name: 'page', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
    ],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 4,
    refundedCredits: 0,
    createdBy: 'u1',
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
    error: null,
    running: false,
    plan: PLAN,
    review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
    applied: null,
    ...patch,
  } as AiJobSummary
}

describe('the job it started, as the follow card reads it', () => {
  it('waits on its plan: the plan’s lines, its estimated cost and Confirm', () => {
    const view = aiJobFollowView(job())
    expect(view.phase).toBe('plan-ready')
    expect(view.phaseLabel).toBe('Plan ready')
    expect(view.line).toEqual({ tone: 'warning', text: AI_JOB_FOLLOW_PHASE_LINES['plan-ready'].text })
    expect(view.moving).toBe(false)
    expect(view.settled).toBe(false)
    expect(view.steps).toBe('1 of 2 steps')
    expect(view.plan).toEqual({
      heading: 'Proposed plan',
      lines: ['Creates the layout Frame — every page', 'Builds the page Spring offer at /spring in Frame: hero, quote form'],
    })
    const range = aiJobCreditRange('page', PLAN)
    expect(view.estimate).toContain('Estimated cost: About')
    expect(view.estimate).toContain(range.ceiling.toLocaleString('en-US'))
    expect(view.estimate).toContain('What it costs is what its steps spend.')
    expect(view.confirm).toEqual({ label: 'Confirm plan', enabled: true })
    expect(view.spent).toBe('Used 4 credits so far.')
    expect(view.open).toBeNull()
  })

  it('names the Free credits left beside the estimate', () => {
    const view = aiJobFollowView(
      job({
        review: {
          reason: 'plan',
          message: 'The plan is ready.',
          findings: [],
          freeCredits: { left: 140, total: 300, resetsOn: '2026-11-01' },
        },
      }),
    )
    expect(view.estimate).toContain('You have 140 of your free AI credits left this month, until November 1.')
  })

  it('warns beside Confirm when another page is being built on the site', () => {
    expect(aiJobFollowView(job(), { buildInFlight: true }).building).toBe(AI_SITE_BUILD_IN_FLIGHT_COPY)
    expect(aiJobFollowView(job()).building).toBeNull()
  })

  it('is moving while it plans and builds, with no Confirm', () => {
    const planning = aiJobFollowView(
      job({
        status: 'running',
        review: null,
        plan: null,
        steps: [{ name: 'plan', status: 'running', startedAt: null, endedAt: null, creditsSpent: 0, error: null }],
        creditsSpent: 0,
      }),
    )
    expect(planning.phase).toBe('planning')
    expect(planning.moving).toBe(true)
    expect(planning.confirm).toBeNull()
    expect(planning.estimate).toBeNull()
    expect(planning.steps).toBeNull()
    expect(planning.spent).toBeNull()
  })

  it('says why a stopped job has nothing to show, and offers Try again unless refused', () => {
    const refused = aiJobFollowView(
      job({
        review: {
          reason: 'doctrine',
          message: 'The page broke a building rule twice.',
          findings: [{ rule: 3, code: 'grid', message: 'A grid needs a width per item.' }],
          retryRefusal: 'Your free AI credits cannot pay for another try.',
        } as never,
      }),
    )
    expect(refused.phase).toBe('attention')
    expect(refused.line.text).toBe('The page broke a building rule twice.')
    expect(refused.problem).toBe('The page broke a building rule twice.')
    expect(refused.findings).toEqual(['A grid needs a width per item.'])
    expect(refused.confirm).toEqual({ label: 'Try again', enabled: false })
    expect(refused.retryRefusal).toBe('Your free AI credits cannot pay for another try.')

    const failed = aiJobFollowView(job({ status: 'failed', review: null, error: 'The page could not be built.' }))
    expect(failed.line).toEqual({ tone: 'error', text: 'The page could not be built.' })
    expect(failed.settled).toBe(true)
    expect(failed.confirm).toBeNull()
  })

  it('leads a finished page with its page, and its version in the Besigner', () => {
    const done = aiJobFollowView(
      job({
        status: 'done',
        review: null,
        creditsSpent: 31,
        outputs: [{ resource: 'screen', id: 'scr-1', versionId: 'v-1', hostId: 'host-1', hostSubdomain: 'roofs', label: 'Spring offer' }],
      }),
      { orgSlug: 'acme' },
    )
    expect(done.line.tone).toBe('success')
    expect(done.spent).toBe('Used 31 credits.')
    expect(done.open).toEqual({
      label: 'Open the draft page',
      detail: '/acme/hosts/roofs/screens/scr-1/versions/v-1/view',
      besigner: '/acme/hosts/roofs/screens/scr-1/versions/v-1/besigner',
    })
  })
})

describe('where an output opens in the apps', () => {
  const output = { id: 'x1', versionId: 'v1', hostSubdomain: 'roofs' }
  beforeAll(() => {
    // The owner's address for a record kind, as the forms plugin publishes its form's.
    registerPluginRecordRoute(
      'form',
      { list: ({ orgSlug, host }) => `/${orgSlug}/hosts/${host}/owner-list`, record: ({ orgSlug, host }, id) => `/${orgSlug}/hosts/${host}/owner-list/${id}` },
      { pluginId: 'owner' },
    )
  })
  it('opens a component, layout or template on its details, and its version in the Besigner', () => {
    expect(aiJobOutputAppLinks({ ...output, resource: 'layout' }, 'acme')).toEqual({
      detail: '/acme/hosts/roofs/layouts/x1',
      besigner: '/acme/hosts/roofs/layouts/x1/versions/v1/besigner',
    })
    expect(aiJobOutputAppLinks({ ...output, resource: 'reusableComponent' }, 'acme')?.detail).toBe('/acme/hosts/roofs/components/x1')
    expect(aiJobOutputAppLinks({ ...output, resource: 'template' }, 'acme')?.detail).toBe('/acme/hosts/roofs/templates/x1')
  })

  it('opens a form on the page its owner publishes for it, with no version to design yet', () => {
    expect(aiJobOutputAppLinks({ ...output, resource: 'form', versionId: null }, 'acme')).toEqual({
      detail: '/acme/hosts/roofs/owner-list/x1',
      besigner: null,
    })
  })

  it('opens nothing for an output that names no site or has no page', () => {
    expect(aiJobOutputAppLinks({ ...output, resource: 'layout', hostSubdomain: null }, 'acme')).toBeNull()
    expect(aiJobOutputAppLinks({ ...output, resource: 'layout' }, '')).toBeNull()
    expect(aiJobOutputAppLinks({ ...output, resource: 'text' }, 'acme')).toBeNull()
  })

  it('opens the Pages list for several pages, and nothing before the job is done', () => {
    const pages = [
      { resource: 'screen' as const, id: 'a', versionId: 'v', hostId: 'h', hostSubdomain: 'roofs', label: 'A' },
      { resource: 'screen' as const, id: 'b', versionId: 'v', hostId: 'h', hostSubdomain: 'roofs', label: 'B' },
    ]
    expect(aiJobFollowOpen({ status: 'done', outputs: pages }, 'acme')).toEqual({
      label: 'Open your draft pages',
      detail: '/acme/hosts/roofs/screens',
      besigner: null,
    })
    expect(aiJobFollowOpen({ status: 'running', outputs: pages }, 'acme')).toBeNull()
    expect(
      aiJobFollowOpen({
        status: 'done',
        outputs: [{ resource: 'layout', id: 'l', versionId: 'v', hostId: 'h', hostSubdomain: 'roofs', label: 'Site frame' }],
      }, 'acme')?.label,
    ).toBe('Open Site frame')
  })
})
