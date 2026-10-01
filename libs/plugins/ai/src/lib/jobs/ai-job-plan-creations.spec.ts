/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { AI_JOB_CREATE_KINDS, aiJobOtherCreations } from '../model/ai-job-creations'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { aiPlanCapabilityLines, aiUnrestrictedPlanCapabilities, aiPlanCapabilitiesForJob } from '../model/ai-plan-capabilities'
import { aiJobPlanCreditEstimate, AI_SITE_PASS_CREDITS } from '../model/ai-site-job'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { aiPlanReuseViolations } from './ai-job-generation'
import {
  AI_JOB_CREATION_EMPTY_COPY,
  AI_JOB_CREATION_UNAVAILABLE_COPY,
  aiBuildingPlanCreations,
  aiJobCreationUnits,
  aiJobPlanCreationsRefusal,
  aiJobWithBuiltCreations,
  aiPlanCreationsRunMinimumMs,
} from './ai-job-plan-creations'
import { AI_JOB_PLAN_SCOPES } from './ai-job-plan-step'
import { runAiJobTemplateStep } from './ai-job-template-step'
import type { AiJobStepContext, AiJobStepOutcome } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-01T14:04:06.000Z')
const firestore = {} as FirebaseFirestore.Firestore
const USAGE = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }
const spend: AiJobStepOutcome = { outputs: [], usage: USAGE, estCostUsd: 0.02, model: 'claude-sonnet-5', stopReason: 'tool_use' }

/**
 * The plan the 2026-10-01 live template job confirmed (job 2xD9Y7NayF): a
 * card for each related article, then the template. Its template step built
 * only the template, so the card the member confirmed was never made and the
 * job still reported Done.
 */
const PLAN: AiJobPlan = {
  reuse: [
    { kind: 'layout', id: 'A_QaSMkfVN', purpose: 'Renders the site header, nav and footer around each article page' },
    { kind: 'collection', id: 'seed-blog', purpose: 'Supplies the entry and collection tokens the template binds' },
    { kind: 'component', id: 'cmp-byline', purpose: 'The byline every article shows' },
  ],
  create: [
    {
      kind: 'component',
      name: 'related-article-card',
      why: 'No listed component previews or links to another article.',
      duplicateOf: null,
      fields: ['title:text', 'excerpt:richText', 'coverImage:image', 'url:text'],
      id: 'drftRelCrd',
    },
    {
      kind: 'template',
      name: 'insights-article-template',
      why: 'No template in the inventory renders an insights article.',
      duplicateOf: null,
      fields: ['{{entry.title}}', '{{entry.body}}'],
      id: 'drftInsTpl',
    },
  ],
  screens: [],
  status: 'confirmed',
  labels: { A_QaSMkfVN: 'insights-article-layout', 'seed-blog': 'Insights', 'cmp-byline': 'Byline' },
  proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
  confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
  confirmedBy: 'uid-1',
}

const CARD: AiJobOutput = {
  resource: 'reusableComponent',
  id: 'drftRelCrd',
  versionId: null,
  hostId: 'host-1',
  label: 'related-article-card',
}
const TEMPLATE: AiJobOutput = {
  resource: 'template',
  id: 'drftTmpl01',
  versionId: null,
  hostId: 'host-1',
  label: 'insights-article-template',
}

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'template',
    status: 'running',
    brief: 'A page template for each of our insights articles: the headline, the author and date, the article body, and a short list of related reading.',
    inputs: { subject: 'entry', collectionId: 'seed-blog' },
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 70 },
      { name: 'generate', status: 'running', creditsSpent: 0, draftIds: { template: 'drftTmpl01' } },
    ],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 70,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: PLAN,
    review: null,
    ...patch,
  } as AiJob
}

const context = (patch: Partial<AiJob> = {}): AiJobStepContext => ({ job: job(patch), stepIndex: 1, now: NOW, firestore })

/** A unit's runner that answers `outcome`, typed as the registry hands runners out. */
const answering = (outcome: AiJobStepOutcome) =>
  jest.fn(async (_context: AiJobStepContext): Promise<AiJobStepOutcome> => outcome)

function runners(component = answering({ ...spend, outputs: [CARD] })) {
  const own = jest.fn(async (_: AiJobStepContext) => ({ ...spend, outputs: [TEMPLATE] }))
  const registry: Record<string, unknown> = { component, form: jest.fn() }
  return { own, component, runnerFor: (kind: string) => (registry[kind] ?? null) as never }
}

describe('a template job builds what its plan creates before the template (AGL-3143 §15)', () => {
  it('builds the card the 10/1 plan confirmed first, under a component job of its own', async () => {
    const { own, component, runnerFor } = runners()
    const step = aiBuildingPlanCreations('template', 'job.template', own, { runnerFor })

    const first = await step(context())
    // The template is not built on this pass: the card the member confirmed is.
    expect(own).not.toHaveBeenCalled()
    expect(component).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({ outputs: [CARD], continue: true })

    const unit = component.mock.calls[0][0].job
    expect(unit.kind).toBe('component')
    expect(unit.$id).toBe('drftRelCrd')
    expect(unit.plan?.create.map((entry) => entry.name)).toEqual(['related-article-card'])
    // The byline is the template's to place, so the card is not told to place it.
    expect(unit.plan?.reuse.map((entry) => entry.id)).toEqual(['A_QaSMkfVN', 'seed-blog'])
  })

  it('then builds the template on the plan the card resolves, holding it to placing the card', async () => {
    const { own, component, runnerFor } = runners()
    const step = aiBuildingPlanCreations('template', 'job.template', own, { runnerFor })

    const second = await step(context({ outputs: [CARD] }))
    expect(component).not.toHaveBeenCalled()
    expect(second).toMatchObject({ outputs: [TEMPLATE] })
    expect(second.continue).toBeUndefined()

    const built = own.mock.calls[0][0].job
    expect(built.$id).toBe('job-1')
    expect(built.steps).toEqual(job().steps)
    expect(built.plan?.create.map((entry) => entry.name)).toEqual(['insights-article-template'])
    expect(built.plan?.reuse.at(-1)).toEqual({
      kind: 'component',
      id: 'drftRelCrd',
      purpose: 'made for this plan: No listed component previews or links to another article.',
    })
    expect(built.plan?.labels['drftRelCrd']).toBe('related-article-card')

    // The template step's own reuse check (rule 7) now names the card, so a
    // template that leaves it out is re-asked rather than reported Done.
    const inventory = { components: [{ id: 'drftRelCrd', name: 'related-article-card' }, { id: 'cmp-byline', name: 'Byline' }] } as unknown as AiSiteInventory
    const missing = aiPlanReuseViolations(inventory, built.plan ?? null, new Set(['cmp-byline']), 'template')
    expect(missing.map((violation) => violation.code)).toEqual(['plan-reuse-not-placed'])
    expect(missing[0].message).toContain('related-article-card')
    expect(aiPlanReuseViolations(inventory, built.plan ?? null, new Set(['cmp-byline', 'drftRelCrd']), 'template')).toEqual([])
  })

  it('is the template runner the plugin registers, so a live job builds the card first', async () => {
    // Before this, the registered runner was the template step itself, which
    // built only `aiPlanCreation(plan, 'template')` and reported Done.
    const component = jest.fn(async () => ({ ...spend, outputs: [CARD] }))
    registerAiJobStep('component', component, { minimumMs: 1 })
    expect(await runAiJobTemplateStep(context())).toMatchObject({ outputs: [CARD], continue: true })
    expect(component).toHaveBeenCalledTimes(1)
  })

  it('runs the kind’s own step as it always ran when the plan creates nothing else', async () => {
    const { own, component, runnerFor } = runners()
    const step = aiBuildingPlanCreations('template', 'job.template', own, { runnerFor })
    const alone = context({ plan: { ...PLAN, create: [PLAN.create[1]] } })
    await step(alone)
    expect(component).not.toHaveBeenCalled()
    expect(own).toHaveBeenCalledWith(alone)
  })

  it('stops where a creation stops, and never builds the template past it', async () => {
    const review = { reason: 'doctrine' as const, message: 'The card broke a rule.', findings: [] }
    const stopped = runners(answering({ ...spend, review }))
    expect(await aiBuildingPlanCreations('template', 'job.template', stopped.own, stopped)(context())).toMatchObject({ review })
    expect(stopped.own).not.toHaveBeenCalled()

    const empty = runners(answering({ ...spend }))
    expect(await aiBuildingPlanCreations('template', 'job.template', empty.own, empty)(context())).toMatchObject({
      failure: AI_JOB_CREATION_EMPTY_COPY,
    })

    const own = jest.fn()
    expect(
      await aiBuildingPlanCreations('template', 'job.template', own, { runnerFor: () => null })(context()),
    ).toMatchObject({ failure: AI_JOB_CREATION_UNAVAILABLE_COPY, usage: { outputTokens: 0 } })
    expect(own).not.toHaveBeenCalled()
  })

  it('needs the time the card’s step needs on the pass that builds it, and the template’s after', () => {
    registerAiJobStep('component', jest.fn(), { minimumMs: 123_000 })
    const minimum = aiPlanCreationsRunMinimumMs('template')
    expect(minimum(job())).toBe(123_000)
    expect(minimum(job({ outputs: [CARD] }))).toBe(0)
    expect(minimum(job({ plan: null }))).toBe(0)
  })
})

describe('what each kind builds of its plan (AGL-3143 §15)', () => {
  it('builds only what its own record can place: a form and a component, never on a form or an email', () => {
    expect(AI_JOB_CREATE_KINDS).toEqual({
      template: ['template', 'form', 'component'],
      layout: ['layout', 'form', 'component'],
      component: ['component', 'form'],
      form: ['form'],
      email: ['email'],
    })
  })

  it('builds a form before the component that may place it, and a component job’s own card last', () => {
    const plan = {
      create: [
        { kind: 'component', name: 'Outer card', why: 'It holds the inner one.', duplicateOf: null, fields: [] },
        { kind: 'component', name: 'Inner badge', why: 'The card shows one.', duplicateOf: null, fields: [] },
        { kind: 'form', name: 'Quote request', why: 'The card asks for a quote.', duplicateOf: null, fields: ['email'] },
        { kind: 'layout', name: 'Frame', why: 'Not a component job’s to build.', duplicateOf: null, fields: [] },
      ],
    } as Pick<AiJobPlan, 'create'>
    // The first creation of the job's own kind is the record the job builds itself.
    expect(aiJobOtherCreations('component', plan).map(({ creation }) => creation.name)).toEqual([
      'Inner badge',
      'Quote request',
    ])
    expect(aiJobCreationUnits('component', plan).map((unit) => [unit.kind, unit.slot])).toEqual([
      ['form', 'c2'],
      ['component', 'c1'],
    ])
    expect(aiJobCreationUnits('form', plan)).toEqual([])
    expect(aiJobCreationUnits('email', plan)).toEqual([])
  })

  it('tells the plan step what a template job may create, and refuses the rest with the one re-ask', () => {
    const lines = aiPlanCapabilityLines(
      aiPlanCapabilitiesForJob(aiUnrestrictedPlanCapabilities(), AI_JOB_PLAN_SCOPES.template),
    )
    expect(lines).toContain('- component: yes')
    expect(lines).toContain('- form: yes')
    expect(lines).toContain('- layout: no, because a template job does not build one')
    expect(lines).toContain('- email design: no, because a template job does not build one')
    expect(AI_JOB_PLAN_SCOPES.email?.creates).toEqual(['email'])
  })

  it('estimates the passes the job takes: the card and the template, not the template alone', () => {
    expect(aiJobPlanCreditEstimate('template', PLAN)).toBe(2 * AI_SITE_PASS_CREDITS)
    expect(aiJobPlanCreditEstimate('template', { ...PLAN, create: [PLAN.create[1]] })).toBe(AI_SITE_PASS_CREDITS)
  })
})

describe('the door that confirms the plan (AGL-3143 §15)', () => {
  const readCapabilities = jest.fn(async () => aiUnrestrictedPlanCapabilities())
  const ask = (kind: AiJob['kind'], plan: AiJobPlan | null, runnerFor = (() => jest.fn()) as never) =>
    aiJobPlanCreationsRefusal(kind, { firestore, org: null, plan }, 'host-1', { runnerFor, readCapabilities })

  it('confirms the 10/1 plan, whose card a template job now builds', async () => {
    expect(await ask('template', PLAN)).toBeNull()
  })

  it('confirms a plan creating only the job’s own record without reading the site', async () => {
    readCapabilities.mockClear()
    expect(await ask('template', { ...PLAN, create: [PLAN.create[1]] })).toBeNull()
    expect(await ask('template', null)).toBeNull()
    expect(readCapabilities).not.toHaveBeenCalled()
  })

  it('refuses a creation the kind does not build, naming it, before a credit is spent', async () => {
    const layout = { kind: 'layout' as const, name: 'Article frame', why: 'A narrower frame.', duplicateOf: null, fields: [] }
    expect(await ask('template', { ...PLAN, create: [...PLAN.create, layout] })).toEqual({
      status: 403,
      error: 'This template cannot be built as planned: it creates the layout “Article frame”, because a template job does not build one. Describe the template again.',
    })
    const form = { kind: 'form' as const, name: 'Signup', why: 'Collect emails.', duplicateOf: null, fields: ['email'] }
    expect(await ask('email', { ...PLAN, create: [{ ...PLAN.create[1], kind: 'email' }, form] })).toMatchObject({
      status: 403,
      error: expect.stringContaining('because an email job does not build one'),
    })
  })

  it('refuses a creation this deployment has no step for', async () => {
    expect(await ask('template', PLAN, (() => null) as never)).toEqual({
      status: 400,
      error: AI_JOB_CREATION_UNAVAILABLE_COPY,
    })
  })
})

describe('the job the template is built under', () => {
  it('resolves a copy the template starts from to the record a creation built', () => {
    const copied: AiJobPlan = {
      ...PLAN,
      create: [
        { ...PLAN.create[0], kind: 'component' },
        { ...PLAN.create[1], duplicateOf: 'new:related-article-card' },
      ],
    }
    const units = aiJobCreationUnits('template', copied)
    const built = aiJobWithBuiltCreations(job({ plan: copied, outputs: [CARD] }), 'template', units)
    expect(built.plan?.create[0].duplicateOf).toBe('drftRelCrd')
  })
})
