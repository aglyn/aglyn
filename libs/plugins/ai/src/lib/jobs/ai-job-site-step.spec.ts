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

/**
 * The site scaffold (AGL-2911), against the REAL registry it delegates
 * through: the step under test asks no model, so what is stubbed is the
 * kinds it hands work to — one fake runner per kind, recording the job it
 * was handed — and the host index the admission reads.
 *
 * So what these prove is the scaffold's whole job: which units a plan owes,
 * in what order, what each delegated job is told, where the scaffold resumes
 * from, and that it spends nothing of its own.
 */

const mockOwners = new Map<string, string>()

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

import type {
  AiJob,
  AiJobKind,
  AiJobOutput,
  AiJobPlan,
} from '../model/ai-jobs.types'
import { AI_SITE_MAX_SECTIONS, AI_SITE_PAGES } from '../model/ai-site-job'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import type {
  AiJobStepContext,
  AiJobStepOutcome,
  AiJobStepRunner,
} from './ai-job-text-step'
import {
  AI_SITE_MAX_PASSES,
  AI_SITE_NO_PAGE_STEP_COPY,
  AI_SITE_NO_PLAN_COPY,
  AI_SITE_UNIT_EMPTY_COPY,
  aiCreationUnit,
  aiRunJobUnit,
  aiSiteBuiltRefs,
  aiSiteJobUnits,
  aiSitePendingUnits,
  aiSiteUnitJob,
  createAiJobSiteStep,
  registerAiSiteJob,
} from './ai-job-site-step'
import {
  AI_JOB_STEP_MAX_PASSES,
  aiJobStepMaxPasses,
  registerAiJobStep,
} from './ai-jobs'

const NOW = new Date('2026-09-16T00:00:00.000Z')

/** A delegate that reports one output of its kind's resource, and what it was handed. */
function fakeRunner(
  seen: AiJob[],
  outcome: (job: AiJob) => Partial<AiJobStepOutcome>,
): AiJobStepRunner {
  return async ({ job }) => {
    seen.push(job)
    return {
      outputs: [],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'delegate-model',
      stopReason: null,
      ...outcome(job),
    }
  }
}

function output(
  resource: AiJobOutput['resource'],
  id: string,
  label = id,
): AiJobOutput {
  return { resource, id, hostId: 'host-1', label }
}

function planScreen(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Home',
    slug: 'home',
    layout: null,
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: 'Home',
    seoDescription: 'The home page',
    sections: [{ name: 'hero', uses: [], items: 0 }],
    ...overrides,
  } as AiJobPlan['screens'][number]
}

function confirmedPlan(overrides: Partial<AiJobPlan> = {}): AiJobPlan {
  return {
    reuse: [],
    create: [],
    screens: Array.from({ length: AI_SITE_PAGES.min }, (_, index) =>
      planScreen({
        title: `Page ${index}`,
        slug: `page-${index}`,
        nav: index === 0,
        // The id the plan recorded for the page when the job kept it (AGL-3079).
        id: `drftPage0${index}`,
      }),
    ),
    status: 'confirmed',
    labels: {},
    proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
    confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
    confirmedBy: 'uid-1',
    ...overrides,
  }
}

function siteJob(overrides: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief: 'A site for a dog groomer',
    inputs: {
      businessType: 'dog groomer',
      pages: AI_SITE_PAGES.min,
      welcomeEmail: false,
    },
    // The welcome email's id, recorded on the step when the job was created (AGL-3079).
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0, draftIds: { email: 'drftWelcom' } }],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as unknown as AiJob['createdAt'],
    updatedAt: NOW as unknown as AiJob['updatedAt'],
    expiresAt: NOW as unknown as AiJob['expiresAt'],
    plan: confirmedPlan(),
    ...overrides,
  }
}

function context(job: AiJob): AiJobStepContext {
  return {
    job,
    stepIndex: 1,
    now: NOW,
    firestore: {} as unknown as FirebaseFirestore.Firestore,
  }
}

/** The step, with a fake runner per kind it may delegate to. */
function stepWith(runners: Partial<Record<AiJobKind, AiJobStepRunner>>) {
  return createAiJobSiteStep({ runnerFor: (kind) => runners[kind] ?? null })
}

const LAYOUT = {
  kind: 'layout' as const,
  name: 'Site frame',
  why: 'every page renders in it',
  duplicateOf: null,
  fields: [],
  id: 'drftFrameL',
}
const FORM = {
  kind: 'form' as const,
  name: 'Contact',
  why: 'rule 3',
  duplicateOf: null,
  fields: ['email'],
  id: 'drftContct',
}
const PALETTE = {
  kind: 'theme-change' as const,
  name: 'Palette',
  why: 'the brand',
  duplicateOf: null,
  fields: ['palette.primary.main'],
}

describe('the units a plan owes', () => {
  it('builds the palette, the layout and the form before the pages, and the email last', () => {
    const units = aiSiteJobUnits(
      confirmedPlan({ create: [FORM, PALETTE, LAYOUT] }),
      {
        welcomeEmail: true,
      },
    )
    expect(units.map((unit) => unit.kind)).toEqual([
      'theme',
      'layout',
      'form',
      'page',
      'page',
      'page',
      'page',
      'email',
    ])
    expect(units.map((unit) => unit.slot)).toEqual([
      't',
      'l',
      'f',
      'p0',
      'p1',
      'p2',
      'p3',
      'e',
    ])
  })

  it('owes only what the plan names, and no email unless one is asked for', () => {
    const units = aiSiteJobUnits(confirmedPlan(), {})
    expect(units.map((unit) => unit.kind)).toEqual([
      'page',
      'page',
      'page',
      'page',
    ])
  })

  it('reads how far it got from the outputs already recorded', () => {
    const units = aiSiteJobUnits(confirmedPlan({ create: [LAYOUT, FORM] }), {})
    expect(aiSitePendingUnits(units, []).map((unit) => unit.slot)).toEqual([
      'l',
      'f',
      'p0',
      'p1',
      'p2',
      'p3',
    ])
    const built = [
      output('layout', 'layout-1'),
      output('form', 'form-1'),
      output('screen', 's-0'),
    ]
    expect(aiSitePendingUnits(units, built).map((unit) => unit.slot)).toEqual([
      'p1',
      'p2',
      'p3',
    ])
  })

  it('resolves what earlier units created into ids a page can name', () => {
    const units = aiSiteJobUnits(
      confirmedPlan({ create: [LAYOUT, FORM, PALETTE] }),
      {},
    )
    const built = aiSiteBuiltRefs(units, [
      output('theme', 'proposal'),
      output('layout', 'layout-1', 'Site frame'),
      output('form', 'form-1', 'Contact'),
    ])
    expect([...built.entries()]).toEqual([
      ['site frame', { id: 'layout-1', label: 'Site frame', kind: 'layout' }],
      ['contact', { id: 'form-1', label: 'Contact', kind: 'form' }],
    ])
    // A palette change is a proposal with no record to reference.
    expect(built.has('palette')).toBe(false)
  })
})

describe('the job each unit is built under', () => {
  const plan = confirmedPlan({
    create: [LAYOUT, FORM],
    screens: [
      planScreen({
        title: 'Home',
        slug: 'home',
        layout: 'new:Site frame',
        sections: [
          { name: 'hero', uses: [], items: 0 },
          { name: 'contact', uses: ['new:Contact', 'new:Palette'], items: 0 },
        ],
        id: 'drftHomePg',
      }),
      planScreen({ title: 'About', slug: 'about', id: 'drftAbout0' }),
      planScreen({ title: 'Services', slug: 'services', id: 'drftServcs' }),
      planScreen({ title: 'Contact', slug: 'contact', id: 'drftContPg' }),
    ],
  })
  const units = aiSiteJobUnits(plan, { welcomeEmail: true })
  const built = aiSiteBuiltRefs(units, [
    output('layout', 'layout-1', 'Site frame'),
    output('form', 'form-1', 'Contact'),
  ])

  it('names each unit by the id its draft was recorded under, so a re-run finds its own draft (AGL-3079)', () => {
    const job = siteJob({ plan })
    expect(units.map((unit) => aiSiteUnitJob(job, unit, built).$id)).toEqual([
      'drftFrameL',
      'drftContct',
      'drftHomePg',
      'drftAbout0',
      'drftServcs',
      'drftContPg',
      'drftWelcom',
    ])
    // Never the scaffold's own id, nor one derived from it.
    for (const unit of units) expect(aiSiteUnitJob(job, unit, built).$id).not.toContain('job-1')
  })

  it('names a unit whose plan and step recorded no id by the job’s id and its slot, as every such draft was written', () => {
    const unrecorded = confirmedPlan({
      create: plan.create.map((entry) => ({ ...entry, id: undefined })),
      screens: plan.screens.map((screen) => ({ ...screen, id: undefined })),
    })
    const job = siteJob({ plan: unrecorded, steps: [] })
    const legacy = aiSiteJobUnits(unrecorded, { welcomeEmail: true })
    expect(legacy.map((unit) => aiSiteUnitJob(job, unit, built).$id)).toEqual([
      'job-1-l',
      'job-1-f',
      'job-1-p0',
      'job-1-p1',
      'job-1-p2',
      'job-1-p3',
      'job-1-e',
    ])
    // A palette change writes no draft, so no id is recorded for it.
    const palette = aiCreationUnit(PALETTE, 't')
    if (!palette) throw new Error('a palette change is a unit')
    expect(aiSiteUnitJob(siteJob(), palette, new Map()).$id).toBe('job-1-t')
  })

  it('hands a creation unit its own creation and nothing else', () => {
    const derived = aiSiteUnitJob(siteJob({ plan }), units[0], built)
    expect(derived.kind).toBe('layout')
    expect(derived.plan?.create).toEqual([LAYOUT])
    expect(derived.plan?.screens).toEqual([])
    expect(derived.brief).toContain('Build the layout “Site frame”')
  })

  it('hands a page unit one screen, no creations, and the ids the scaffold built', () => {
    const derived = aiSiteUnitJob(siteJob({ plan }), units[2], built)
    expect(derived.kind).toBe('page')
    expect(derived.plan?.create).toEqual([])
    expect(derived.plan?.screens).toHaveLength(1)
    const screen = derived.plan?.screens[0]
    expect(screen?.layout).toBe('layout-1')
    // The form is placed by id; the palette change is not a thing a page places.
    expect(screen?.sections[1].uses).toEqual(['form-1'])
    expect(derived.plan?.reuse).toEqual([
      {
        kind: 'layout',
        id: 'layout-1',
        purpose: 'the layout this site’s pages are built on',
      },
      {
        kind: 'form',
        id: 'form-1',
        purpose: 'the form this site’s pages are built on',
      },
    ])
    expect(derived.plan?.labels).toMatchObject({
      'layout-1': 'Site frame',
      'form-1': 'Contact',
    })
  })

  it('carries the site’s own words into every unit’s brief', () => {
    const job = siteJob({
      plan,
      inputs: {
        businessType: 'dog groomer',
        pages: 4,
        businessName: 'Wag & Co',
        city: 'Austin',
        brand: 'teal',
      },
    })
    const derived = aiSiteUnitJob(job, units[2], built)
    expect(derived.brief).toContain('A site for a dog groomer')
    expect(derived.brief).toContain('name: Wag & Co')
    expect(derived.brief).toContain('city: Austin')
    expect(derived.brief).toContain('brand: teal')
    expect(derived.brief).toContain(
      'Build the page “Home” of this site, at home.',
    )
  })

  it('shows a delegate none of the scaffold’s other steps or outputs', () => {
    const job = siteJob({
      plan,
      steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
      outputs: [output('layout', 'layout-1')],
    })
    const derived = aiSiteUnitJob(job, units[2], built)
    expect(derived.steps).toEqual([])
    expect(derived.outputs).toEqual([])
  })

  it('asks the theme step for a new palette rather than an edit of one', () => {
    const themed = aiSiteJobUnits(confirmedPlan({ create: [PALETTE] }), {})
    const derived = aiSiteUnitJob(siteJob(), themed[0], new Map())
    expect(derived.kind).toBe('theme')
    expect(derived.inputs['mode']).toBe('create')
  })
})

describe('one unit a pass', () => {
  it('hands the first pending unit to the kind that owns it, and asks to continue', async () => {
    const pages: AiJob[] = []
    const step = stepWith({
      page: fakeRunner(pages, () => ({
        outputs: [output('screen', 'screen-0')],
      })),
    })
    const outcome = await step(context(siteJob()))
    expect(pages.map((job) => job.$id)).toEqual(['drftPage00'])
    expect(outcome.outputs).toEqual([output('screen', 'screen-0')])
    expect(outcome.continue).toBe(true)
  })

  it('resumes at the unit the outputs say is next', async () => {
    const pages: AiJob[] = []
    const step = stepWith({
      page: fakeRunner(pages, () => ({
        outputs: [output('screen', 'screen-2')],
      })),
    })
    await step(
      context(
        siteJob({
          outputs: [output('screen', 'screen-0'), output('screen', 'screen-1')],
        }),
      ),
    )
    expect(pages.map((job) => job.$id)).toEqual(['drftPage02'])
  })

  it('stops asking to continue once the last unit reports', async () => {
    const step = stepWith({
      page: fakeRunner([], () => ({ outputs: [output('screen', 'screen-3')] })),
    })
    const job = siteJob({
      outputs: ['screen-0', 'screen-1', 'screen-2'].map((id) =>
        output('screen', id),
      ),
    })
    expect((await step(context(job))).continue).toBeUndefined()
  })

  it('keeps the same unit while the unit itself asks for another pass', async () => {
    const pages: AiJob[] = []
    const step = stepWith({
      page: fakeRunner(pages, () => ({ continue: true })),
    })
    const outcome = await step(context(siteJob()))
    expect(pages.map((job) => job.$id)).toEqual(['drftPage00'])
    expect(outcome.continue).toBe(true)
    expect(outcome.outputs).toEqual([])
  })

  it('carries what the unit spent, and spends nothing of its own', async () => {
    const step = stepWith({
      page: fakeRunner([], () => ({
        outputs: [output('screen', 's')],
        usage: {
          inputTokens: 90,
          outputTokens: 40,
          cacheReadTokens: 10,
          cacheWriteTokens: 0,
        },
        estCostUsd: 0.02,
        model: 'delegate-model',
        effort: 'low',
        stopReason: 'end_turn',
      })),
    })
    const outcome = await step(context(siteJob()))
    expect(outcome.usage.inputTokens).toBe(90)
    expect(outcome.estCostUsd).toBe(0.02)
    expect(outcome.model).toBe('delegate-model')
    expect(outcome.effort).toBe('low')
    expect(outcome.stopReason).toBe('end_turn')
  })

  it('waits on a unit that stopped for a person, and does not continue', async () => {
    const review = {
      reason: 'limit' as const,
      message: 'no room',
      findings: [],
    }
    const step = stepWith({ page: fakeRunner([], () => ({ review })) })
    const outcome = await step(context(siteJob()))
    expect(outcome.review).toEqual(review)
    expect(outcome.continue).toBeUndefined()
  })

  it('hands a unit’s refusal and its failure straight back', async () => {
    const refused = await stepWith({
      page: fakeRunner([], () => ({ refused: true })),
    })(context(siteJob()))
    expect(refused.refused).toBe(true)
    expect(refused.continue).toBeUndefined()
    const failed = await stepWith({
      page: fakeRunner([], () => ({ failure: 'the draft is gone' })),
    })(context(siteJob()))
    expect(failed.failure).toBe('the draft is gone')
  })

  it('stops rather than ask a unit that reported nothing to build again', async () => {
    const outcome = await stepWith({ page: fakeRunner([], () => ({})) })(
      context(siteJob()),
    )
    expect(outcome.failure).toBe(AI_SITE_UNIT_EMPTY_COPY)
    expect(outcome.continue).toBeUndefined()
  })

  it('keeps the plan a member confirmed, whatever a delegate proposes', async () => {
    const step = stepWith({
      page: fakeRunner([], () => ({
        outputs: [output('screen', 's')],
        plan: confirmedPlan({ screens: [] }),
      })),
    })
    expect((await step(context(siteJob()))).plan).toBeUndefined()
  })

  it('owes no unit a kind this deployment has not loaded', async () => {
    const emails: AiJob[] = []
    const pages: AiJob[] = []
    const job = siteJob({
      inputs: {
        businessType: 'dog groomer',
        pages: AI_SITE_PAGES.min,
        welcomeEmail: true,
      },
      outputs: ['a', 'b', 'c', 'd'].map((id) => output('screen', id)),
    })
    // No email runner: the last page's report finishes the scaffold.
    expect(
      (await stepWith({ page: fakeRunner(pages, () => ({})) })(context(job)))
        .continue,
    ).toBeUndefined()
    expect(pages).toEqual([])
    // With one, the welcome email is the unit still owed.
    const outcome = await stepWith({
      page: fakeRunner(pages, () => ({})),
      email: fakeRunner(emails, () => ({
        outputs: [output('emailScreen', 'email-1')],
      })),
    })(context(job))
    expect(emails.map((each) => each.$id)).toEqual(['drftWelcom'])
    expect(emails[0].brief).toContain('welcome email')
    expect(outcome.continue).toBeUndefined()
  })
})

describe('what a scaffold refuses before it spends', () => {
  it('fails a job whose plan nobody confirmed', async () => {
    const step = stepWith({ page: fakeRunner([], () => ({})) })
    const outcome = await step(
      context(siteJob({ plan: { ...confirmedPlan(), status: 'proposed' } })),
    )
    expect(outcome.failure).toBe(AI_SITE_NO_PLAN_COPY)
    expect(outcome.estCostUsd).toBe(0)
  })

  it('fails a confirmed plan a scaffold cannot build, unspent', async () => {
    const pages: AiJob[] = []
    const step = stepWith({ page: fakeRunner(pages, () => ({})) })
    const outcome = await step(
      context(siteJob({ plan: confirmedPlan({ screens: [planScreen()] }) })),
    )
    expect(outcome.failure).toMatch(/builds 1 page/)
    expect(pages).toEqual([])
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
  })

  it('fails inputs the doors would have refused', async () => {
    const step = stepWith({ page: fakeRunner([], () => ({})) })
    const outcome = await step(context(siteJob({ inputs: { pages: 4 } })))
    expect(outcome.failure).toMatch(/what kind of business/)
  })
})

describe('what a scaffold is admitted with', () => {
  beforeAll(registerAiSiteJob)

  beforeEach(() => {
    mockOwners.clear()
    mockOwners.set('host-1', 'org-1')
    registerAiJobStep(
      'page',
      fakeRunner([], () => ({})),
    )
  })

  const ask = (
    inputs: Record<string, unknown>,
    hostId: string | null = 'host-1',
  ) =>
    aiJobAdmissionRefusal('site', {
      firestore: {} as unknown as FirebaseFirestore.Firestore,
      orgId: 'org-1',
      hostId,
      inputs,
      org: {},
    })

  const good = { businessType: 'dog groomer', pages: AI_SITE_PAGES.min }

  it('admits a scaffold for a site of its own org', async () => {
    await expect(ask(good)).resolves.toBeNull()
  })

  it('refuses inputs that do not read, and a job that names no site', async () => {
    await expect(ask({ pages: 4 })).resolves.toMatchObject({ status: 400 })
    await expect(ask(good, null)).resolves.toMatchObject({ status: 400 })
  })

  it('refuses a site of another workspace', async () => {
    mockOwners.set('host-1', 'org-2')
    await expect(ask(good)).resolves.toEqual({
      status: 404,
      error: 'Unknown site',
    })
  })

  it('refuses a scaffold where nothing can build a page', async () => {
    registerAiJobStep('page', null as unknown as AiJobStepRunner)
    await expect(ask(good)).resolves.toEqual({
      status: 400,
      error: AI_SITE_NO_PAGE_STEP_COPY,
    })
  })
})

describe('the passes a scaffold may take', () => {
  it('registers a bound of its own, above the default an audit keeps', () => {
    registerAiSiteJob()
    expect(aiJobStepMaxPasses('site')).toBe(AI_SITE_MAX_PASSES)
    expect(AI_SITE_MAX_PASSES).toBeGreaterThan(AI_JOB_STEP_MAX_PASSES)
    expect(aiJobStepMaxPasses('seo')).toBe(AI_JOB_STEP_MAX_PASSES)
  })

  it('is enough for the largest site the plan rules admit', () => {
    const largest = confirmedPlan({
      create: [LAYOUT, FORM, PALETTE],
      screens: Array.from({ length: AI_SITE_PAGES.max }, (_, index) =>
        planScreen({
          slug: `page-${index}`,
          sections: Array.from(
            { length: AI_SITE_MAX_SECTIONS },
            (_, section) => ({
              name: `section ${section}`,
              uses: [],
              items: 0,
            }),
          ),
        }),
      ),
    })
    const units = aiSiteJobUnits(largest, { welcomeEmail: true })
    // A page takes a pass a section and one more for its listing; every other
    // unit takes one.
    const passes = units.reduce(
      (total, unit) =>
        total + (unit.screen ? unit.screen.sections.length + 1 : 1),
      0,
    )
    expect(passes).toBeLessThanOrEqual(AI_SITE_MAX_PASSES)
  })
})

describe('the unit machinery a page job shares (AGL-3031)', () => {
  const CARD = {
    kind: 'component' as const,
    name: 'Price tier',
    why: 'Three tiers repeat.',
    duplicateOf: null,
    fields: ['tier:text'],
    id: 'drftPriceT',
  }

  it('builds a creation as the unit of its kind, and a creation no unit builds as none', () => {
    expect(aiCreationUnit(CARD, 'c0')).toEqual({
      kind: 'component',
      jobKind: 'component',
      resource: 'reusableComponent',
      slot: 'c0',
      creation: CARD,
      label: 'Price tier',
    })
    expect(aiCreationUnit(LAYOUT, 'c1')).toMatchObject({ kind: 'layout', resource: 'layout' })
    expect(aiCreationUnit(PALETTE, 'c2')).toMatchObject({ kind: 'theme', resource: 'theme' })
    expect(aiCreationUnit({ ...CARD, kind: 'dataset' }, 'c3')).toBeNull()
    expect(aiCreationUnit({ ...CARD, kind: 'template' }, 'c4')).toBeNull()
  })

  it('resolves a built component into an id a page places', () => {
    const units = [aiCreationUnit(CARD, 'c0'), aiCreationUnit(LAYOUT, 'c1')].filter((unit) => unit !== null)
    const built = aiSiteBuiltRefs(units, [
      output('reusableComponent', 'drftPriceT', 'Price tier'),
      output('layout', 'drftFrameL', 'Site frame'),
    ])
    expect(built.get('price tier')).toEqual({ id: 'drftPriceT', label: 'Price tier', kind: 'component' })
  })

  it('tells a creation the plan’s reuse, less what the plan’s screens place themselves', () => {
    const plan = confirmedPlan({
      reuse: [
        { kind: 'component', id: 'cmp-quote', purpose: 'customer words' },
        { kind: 'component', id: 'cmp-nav', purpose: 'the header menu' },
      ],
      create: [LAYOUT],
      screens: [
        planScreen({ sections: [{ name: 'customer words', uses: ['cmp-quote'], items: 2 }] }),
        ...confirmedPlan().screens.slice(1),
      ],
    })
    const layout = aiCreationUnit(LAYOUT, 'l')
    if (!layout) throw new Error('a layout is a unit')
    expect(aiSiteUnitJob(siteJob({ plan }), layout, new Map()).plan?.reuse).toEqual([
      { kind: 'component', id: 'cmp-nav', purpose: 'the header menu' },
    ])
  })

  it('reports one delegated pass: built, still going, stopped, or empty', async () => {
    const unit = aiCreationUnit(CARD, 'c0')
    if (!unit) throw new Error('a component is a unit')
    const job = siteJob({ kind: 'page', plan: confirmedPlan({ create: [CARD] }) })
    const seen: AiJob[] = []
    const run = (outcome: Partial<AiJobStepOutcome>) =>
      aiRunJobUnit(context(job), {
        unit,
        units: [unit],
        runner: fakeRunner(seen, () => outcome),
        emptyCopy: 'Nothing was built.',
      })
    const card = output('reusableComponent', 'drftPriceT', 'Price tier')
    expect(await run({ outputs: [card] })).toMatchObject({ built: true, outcome: { outputs: [card] } })
    expect(seen[0]).toMatchObject({ $id: 'drftPriceT', kind: 'component', steps: [], outputs: [] })
    expect(await run({ continue: true })).toMatchObject({ built: false, outcome: { continue: true } })
    const review = { reason: 'limit' as const, message: 'No room.', findings: [] }
    expect(await run({ review })).toMatchObject({ built: false, outcome: { review } })
    expect(await run({})).toMatchObject({ built: false, outcome: { failure: 'Nothing was built.' } })
    // A delegate's own plan never rides back to the job that delegated.
    const proposed = await run({ outputs: [card], plan: confirmedPlan() })
    expect(proposed.outcome.plan).toBeUndefined()
  })
})
