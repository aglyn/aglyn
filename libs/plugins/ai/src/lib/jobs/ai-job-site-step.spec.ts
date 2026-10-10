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

import { AiJobCanceledError } from './ai-job-cancel'
import type {
  AiJob,
  AiJobKind,
  AiJobOutput,
  AiJobPlan,
} from '../model/ai-jobs.types'
import {
  AI_SITE_BLOG_NAV_ID,
  AI_SITE_DATASETS_MAX,
  AI_SITE_EMAIL_TYPE,
  AI_SITE_MAX_SECTIONS,
  AI_SITE_PAGES,
  aiSiteBlogNavPage,
  aiFreeSiteCreditEstimate,
  aiFreeSitePrompt,
  aiFreeSiteCreditRange,
  aiFreeCreditsNoneLeftText,
} from '../model/ai-site-job'
import { AI_LAYOUT_SITE_PAGES_INPUT, aiLayoutSiteAliases, aiLayoutSitePages, aiLayoutWithSitePages } from './ai-job-layout-site-pages'
import { aiLayoutPageTargets } from './ai-job-page-language'
import { aiLayoutRenamedLabel, aiLayoutResolveLink } from '../layout-language/ai-layout-links'
import { AI_CREDITS_CONFIRM_CODE, aiCreditsPromptText } from '../model/ai-credit-estimate'
import {
  AI_SITE_SEO_OUTPUT_ID,
  aiSiteSeoProposalForInputs,
  aiSiteSeoProposalOf,
} from '../model/ai-site-start-seo'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { aiPageSectionNodeId } from './ai-job-page-sections'
import type {
  AiJobStepContext,
  AiJobStepOutcome,
  AiJobStepRunner,
} from './ai-job-text-step'
import {
  AI_SITE_BLOG_MERGED_NOTE,
  AI_SITE_MAX_PASSES,
  AI_SITE_NO_PAGE_STEP_COPY,
  AI_SITE_NO_PLAN_COPY,
  AI_SITE_PAGE_NOT_WRITTEN_COPY,
  AI_SITE_UNIT_EMPTY_COPY,
  aiCreationUnit,
  aiRunJobUnit,
  aiSiteBuiltRefs,
  aiSiteInitialLedger,
  aiSiteJobRunMinimumMs,
  aiSiteJobUnits,
  aiSiteLedgerUnits,
  aiSitePendingUnits,
  aiSiteUnitJob,
  aiSiteWritesPosts,
  createAiJobSiteStep,
  createAiSiteJobAdmission,
  registerAiSiteJob,
  type AiSiteUnit,
} from './ai-job-site-step'
import {
  AI_SITE_POST_BUDGET,
  AI_SITE_POSTS,
  AI_SITE_POSTS_LABEL,
  AI_SITE_PRODUCTS_LABEL,
  AI_SITE_PRODUCTS_PRICE_NOTE,
} from './ai-job-site-content'
import { aiLayoutListingsOf } from '../layout-language/ai-layout-listings'
import { AI_SITE_DATASET_BUDGET } from './ai-job-site-datasets'
import { AI_STOCK_PHOTO_AVOID_INPUT } from './ai-layout-stock-photos'
import { AI_FORM_DATASET_MADE_INPUT } from './ai-job-form-dataset'
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

/** The look the scaffold designs first (AGL-3660), as its unit reports it. */
const LOOK: AiJobOutput = { resource: 'theme', id: 'look', hostId: 'host-1', label: 'Your look' }

/** The site's own listing as the scaffold reports it, from `siteJob`'s inputs. */
const SITE_LISTING: AiJobOutput = {
  resource: 'seo',
  id: AI_SITE_SEO_OUTPUT_ID,
  hostId: 'host-1',
  label: 'The site’s search title and description',
  proposal: aiSiteSeoProposalForInputs({
    businessType: 'dog groomer',
  }) as unknown as Record<string, unknown>,
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
    // The look is designed first (AGL-3660); these specs start past it unless they say otherwise.
    outputs: [LOOK],
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

/** A stored page that holds every section any plan could name. */
const EVERY_SECTION = async () => ({
  versionId: 'v-1',
  nodes: new Proxy({}, { has: () => true }) as never,
})

/** The step, with a fake runner per kind it may delegate to. */
function stepWith(
  runners: Partial<Record<AiJobKind, AiJobStepRunner>>,
  deps: Omit<Parameters<typeof createAiJobSiteStep>[0] & object, 'runnerFor'> = {},
) {
  return createAiJobSiteStep({
    runnerFor: (kind) => runners[kind] ?? null,
    readNodes: EVERY_SECTION,
    look: async () => ({ outputs: [LOOK], usage: AI_JOB_ZERO_USAGE, estCostUsd: 0, model: 'test-model', stopReason: null }),
    ...deps,
  })
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
      // The look comes first on every scaffold (AGL-3660).
      'theme',
      'page',
      'page',
      'page',
      'page',
    ])
  })

  it('reads how far it got from the outputs already recorded', () => {
    const units = aiSiteJobUnits(confirmedPlan({ create: [LAYOUT, FORM] }), {})
    expect(aiSitePendingUnits(units, []).map((unit) => unit.slot)).toEqual([
      't',
      'l',
      'f',
      'p0',
      'p1',
      'p2',
      'p3',
    ])
    const built = [
      LOOK,
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

describe('a site start that writes its posts links its blog (AGL-3660)', () => {
  // The Slow Roads plan as the stand-in check leaves it: Home, About, Contact.
  const plan = confirmedPlan({
    create: [LAYOUT],
    screens: [
      planScreen({ title: 'Home', slug: '/', id: 'drftHomePg' }),
      planScreen({ title: 'About', slug: '/about', id: 'drftAbout0' }),
      planScreen({ title: 'Contact', slug: '/contact', id: 'drftContPg' }),
    ],
  })
  const units = aiSiteJobUnits(plan, { content: 'posts' })
  const layout = units.find((unit) => unit.kind === 'layout') as AiSiteUnit
  const ledger = (status: string) =>
    units.map((unit) => ({ slot: unit.slot, op: unit.kind, label: unit.label, status: unit.slot === 'posts' ? status : 'pending' }))
  const sitePagesOf = (job: AiJob) =>
    aiSiteUnitJob(job, layout, aiSiteBuiltRefs(units, [])).inputs?.[AI_LAYOUT_SITE_PAGES_INPUT] as Array<Record<string, unknown>>

  it('hands the layout the blog by its path, second after Home, while the posts are owed', () => {
    const job = siteJob({ plan, items: ledger('pending') as never })
    expect(aiSiteWritesPosts(job)).toBe(true)
    expect(sitePagesOf(job).map((page) => [page['label'], page['href'] ?? page['slug']])).toEqual([
      ['Home', '/'],
      ['Blog', '/blog'],
      ['About', '/about'],
      ['Contact', '/contact'],
    ])
    expect(sitePagesOf(job)[1]).toEqual({ id: AI_SITE_BLOG_NAV_ID, label: 'Blog', slug: '/blog', href: '/blog' })
  })

  it('reads the blog back off the layout unit’s inputs, and links it in the frame and in the raw header', () => {
    const job = siteJob({ plan, items: ledger('pending') as never })
    const unitJob = aiSiteUnitJob(job, layout, aiSiteBuiltRefs(units, []))
    expect(aiLayoutSitePages(unitJob.inputs).find((page) => page.id === AI_SITE_BLOG_NAV_ID)?.href).toBe('/blog')
    // The raw layout path writes a Page Link by path.
    const tree = {
      rootId: 'root',
      nodes: {
        root: { componentId: 'muiBox', nodes: ['bar', 'slot'] },
        bar: { componentId: 'muiToolbar', nodes: [] },
        slot: { componentId: 'layoutSlot' },
      },
    }
    const written = aiLayoutWithSitePages(tree, aiLayoutSitePages(unitJob.inputs)) as { nodes: Record<string, { props?: Record<string, unknown> }> }
    const links = Object.values(written.nodes).filter((node) => node.props?.['renderAs'] === 'link')
    expect(links.map((node) => node.props?.['href'] ?? node.props?.['screenId'])).toEqual(['drftHomePg', '/blog', 'drftAbout0', 'drftContPg'])
  })

  it('takes the next free address when a kept plan still holds a page at /blog, and links that', () => {
    const kept = confirmedPlan({ ...plan, screens: [...plan.screens, planScreen({ title: 'Blog', slug: '/blog', id: 'drftBlogPg' })] })
    expect(aiSiteBlogNavPage(kept.screens).href).toBe('/posts')
  })

  /*
   * The plan step asks once for a plan with no page standing in for the blog,
   * and keeps a second answer that still has one (#1264). The Slow Roads
   * render linked both "Blog" and "Articles", and its hero said "Read the
   * articles". The scaffold merges such a page into the blog (AGL-3676).
   */
  it('merges a kept page standing in for the blog into it: unlinked, its links the blog’s, its row skipped', async () => {
    const kept = confirmedPlan({
      ...plan,
      screens: [...plan.screens, planScreen({ title: 'Articles', slug: '/articles', id: 'drftArticl' })],
    })
    const keptUnits = aiSiteJobUnits(kept, { content: 'posts' })
    const keptLayout = keptUnits.find((unit) => unit.kind === 'layout') as AiSiteUnit
    const items = keptUnits.map((unit) => ({ slot: unit.slot, op: unit.kind, label: unit.label, status: 'pending' }))
    const job = siteJob({ plan: kept, items: items as never })
    const unitJob = aiSiteUnitJob(job, keptLayout, aiSiteBuiltRefs(keptUnits, []))
    const pages = aiLayoutSitePages(unitJob.inputs)
    expect(pages.map((page) => page.label)).toEqual(['Home', 'Blog', 'About', 'Contact'])
    expect(aiLayoutSiteAliases(unitJob.inputs)).toEqual([
      { id: 'drftArticl', label: 'Blog', slug: '/blog', href: '/blog', standsInFor: 'Articles' },
    ])
    // A link to the merged page goes to the blog, under words that name it.
    const targets = aiLayoutPageTargets({ job: unitJob, inventory: null, own: [] })
    const destination = aiLayoutResolveLink('page:drftArticl', 'Read the articles', { sections: [], from: 0, formSection: null }, targets)
    expect(destination).toMatchObject({ kind: 'path', href: '/blog' })
    expect(aiLayoutRenamedLabel('Read the articles', destination as never)).toBe('Read the blog')
    expect(aiLayoutRenamedLabel('Browse Articles', destination as never)).toBe('Browse Blog')
    // Its page is not built while the posts are written.
    const slot = keptUnits.find((unit) => unit.kind === 'page' && unit.screen?.id === 'drftArticl')?.slot
    const page = jest.fn()
    const step = stepWith({ page }, { contentRefusal: async () => null })
    const ahead = items.map((row) => (row.slot === slot || row.op === 'posts' ? row : { ...row, status: 'succeeded' }))
    const outcome = await step(
      context(siteJob({ plan: kept, items: ahead.map((row) => (row.op === 'posts' ? { ...row, status: 'succeeded' } : row)) as never })),
    )
    expect(page).not.toHaveBeenCalled()
    expect(outcome.item).toEqual({ slot, status: 'skipped', note: AI_SITE_BLOG_MERGED_NOTE })
  })

  it('links no blog where the posts are not owed, or the part was skipped', () => {
    expect(sitePagesOf(siteJob({ plan })).some((page) => page['id'] === AI_SITE_BLOG_NAV_ID)).toBe(false)
    expect(aiSiteWritesPosts(siteJob({ plan, items: ledger('skipped') as never }))).toBe(false)
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
  // The look's unit leads every scaffold (AGL-3660); these address the units after it.
  const units = aiSiteJobUnits(plan, { welcomeEmail: true }).slice(1)
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
    const legacy = aiSiteJobUnits(unrecorded, { welcomeEmail: true }).slice(1)
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

  it('hands the layout unit the pages it is built before, by the ids their drafts are written under (AGL-3596)', () => {
    const derived = aiSiteUnitJob(siteJob({ plan }), units[0], built)
    expect(derived.inputs['sitePages']).toEqual(
      plan.screens.filter((screen) => screen.nav).map((screen) => ({ id: screen.id, label: screen.title, slug: screen.slug })),
    )
    // A page unit is told them too, so its buttons may go to a page built after it; a form unit is not.
    expect(aiSiteUnitJob(siteJob({ plan }), units[1], built).inputs['sitePages']).toBeUndefined()
    expect(aiSiteUnitJob(siteJob({ plan }), units[2], built).inputs['sitePages']).toEqual(derived.inputs['sitePages'])
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

  it('carries who the site is for into every unit’s brief (AGL-2918)', () => {
    // A guided start writes the audience into its brief; an agency batch's
    // brief is a member's own sentence and may never mention it, so the
    // scalar is said on the site line every unit reads.
    const job = siteJob({
      plan,
      brief: 'A site for a dog groomer',
      inputs: { businessType: 'dog groomer', audience: 'local dog owners', pages: 4 },
    })
    for (const unit of units) {
      expect([unit.kind, aiSiteUnitJob(job, unit, built).brief]).toEqual([
        unit.kind,
        expect.stringContaining('for: local dog owners'),
      ])
    }
    const said = siteJob({ plan, inputs: { businessType: 'dog groomer', pages: 4 } })
    expect(aiSiteUnitJob(said, units[0], built).brief).not.toContain('for:')
  })

  it('shows a delegate none of the scaffold’s other steps or outputs', () => {
    const job = siteJob({
      plan,
      steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
      outputs: [LOOK, output('layout', 'layout-1')],
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
    // The site's own listing rides out beside the first unit's output; it is
    // derived, not generated, so it costs the pass nothing (AGL-2918).
    expect(outcome.outputs).toEqual([SITE_LISTING, output('screen', 'screen-0')])
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
          outputs: [LOOK, output('screen', 'screen-0'), output('screen', 'screen-1')],
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
      outputs: [LOOK, ...['screen-0', 'screen-1', 'screen-2'].map((id) => output('screen', id))],
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
    expect(outcome.outputs).toEqual([SITE_LISTING])
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

  it('settles a unit that stopped for a person as its own failed item, not the workspace’s fault, and goes on (AGL-3616)', async () => {
    const review = {
      reason: 'limit' as const,
      message: 'no room',
      findings: [],
    }
    const step = stepWith({ page: fakeRunner([], () => ({ review })) })
    const outcome = await step(context(siteJob()))
    expect(outcome.review).toBeUndefined()
    expect(outcome.item).toMatchObject({ slot: 'p0', status: 'failed', failure: { ours: false, reason: 'review', message: 'no room' } })
    expect(outcome.continue).toBe(true)
  })

  it('settles a unit’s refusal and its failure as that item’s, and goes on (AGL-3616)', async () => {
    const refused = await stepWith({
      page: fakeRunner([], () => ({ refused: true })),
    })(context(siteJob()))
    expect(refused.refused).toBeUndefined()
    expect(refused.item).toMatchObject({ status: 'failed', failure: { ours: false, reason: 'refused' } })
    expect(refused.continue).toBe(true)
    const failed = await stepWith({
      page: fakeRunner([], () => ({ failure: 'the draft is gone' })),
    })(context(siteJob()))
    expect(failed.item).toMatchObject({ status: 'failed', failure: { ours: true, reason: 'step-failure', message: 'the draft is gone' } })
  })

  it('fails, on our side, a unit that reported nothing, rather than ask it again', async () => {
    const outcome = await stepWith({ page: fakeRunner([], () => ({})) })(
      context(siteJob()),
    )
    expect(outcome.item).toMatchObject({ slot: 'p0', status: 'failed', failure: { ours: true, message: AI_SITE_UNIT_EMPTY_COPY } })
    expect(outcome.continue).toBe(true)
  })

  it('builds a page whose form failed without it, and says so (AGL-3616)', async () => {
    const pages: AiJob[] = []
    const job = siteJob({ plan: confirmedPlan({ create: [FORM], screens: confirmedPlan().screens.map((screen) => ({ ...screen, sections: [{ name: 'contact form', uses: ['new:Contact'], items: 0 }] })) }) })
    const step = stepWith({
      form: fakeRunner([], () => ({ failure: 'no form' })),
      page: fakeRunner(pages, () => ({ outputs: [output('screen', 'screen-0')] })),
    })
    const first = await step(context(job))
    expect(first.item).toMatchObject({ slot: 'f', status: 'failed' })
    const items = (first.items ?? []).map((row) => (row.slot === 'f' ? { ...row, status: 'failed' as const } : row))
    const second = await step(context({ ...job, items }))
    expect(pages[0].plan?.screens[0]?.sections[0]?.uses).toEqual([])
    expect(pages[0].brief).toContain('without the form “Contact”')
    expect(second.item).toMatchObject({ slot: 'p0', status: 'degraded', degradedBy: ['f'] })
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
      outputs: [LOOK, ...['a', 'b', 'c', 'd'].map((id) => output('screen', id))],
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

/*
 * The welcome email's copy (AGL-2918). It was one sentence and a yes/no
 * toggle: a welcome email for a business in general, to nobody in
 * particular, about nothing that had happened.
 *
 * ⛔ A DRAFT throughout. The email step writes an unpublished email design;
 * nothing here sends, schedules or enrolls anybody, and none of these tests
 * would pass if it did — the fake runner is the only thing that runs.
 */
describe('what the welcome email is told', () => {
  const emailUnit = () => aiSiteJobUnits(confirmedPlan(), { welcomeEmail: true }).at(-1)

  const emailJob = (inputs: Record<string, unknown> = {}) => {
    const unit = emailUnit()
    if (!unit || unit.kind !== 'email') throw new Error('the last unit is not the email')
    return aiSiteUnitJob(
      siteJob({ inputs: { businessType: 'dog groomer', pages: AI_SITE_PAGES.min, ...inputs } }),
      unit,
      new Map(),
    )
  }

  const emailBrief = (inputs: Record<string, unknown>) => emailJob(inputs).brief

  it('says which kind of email it is, which the email step reads off the inputs', () => {
    expect(emailJob().inputs?.['emailType']).toBe(AI_SITE_EMAIL_TYPE)
    // ⛔ Never the signup label. It is the nearest one in the catalog and it
    // describes a thing that did not happen.
    expect(AI_SITE_EMAIL_TYPE).not.toBe('welcome')
  })

  it('says it of the email alone, leaving every other unit’s inputs as they were', () => {
    const units = aiSiteJobUnits(confirmedPlan(), { welcomeEmail: true })
    const job = siteJob({
      inputs: { businessType: 'dog groomer', pages: AI_SITE_PAGES.min, welcomeEmail: true },
    })
    for (const unit of units.filter((each) => each.kind !== 'email')) {
      expect(aiSiteUnitJob(job, unit, new Map()).inputs?.['emailType']).toBeUndefined()
    }
  })

  it('keeps the scaffold’s own answers on the email’s inputs beside the kind', () => {
    // The kind is added to the inputs, not swapped for them: the form's
    // routing and the audience are read off the same job.
    const inputs = emailJob({ audience: 'local dog owners', submissions: 'lead' }).inputs
    expect(inputs?.['audience']).toBe('local dog owners')
    expect(inputs?.['submissions']).toBe('lead')
  })

  it('still says what it always said', () => {
    expect(emailBrief({})).toContain(
      'Write the welcome email this site sends someone who gets in touch.',
    )
  })

  it('writes it to the people the site is for', () => {
    expect(emailBrief({ audience: 'local dog owners' })).toContain(
      'Write it to local dog owners.',
    )
    expect(emailBrief({})).not.toContain('Write it to')
  })

  it('says what became of the message, in the person’s own routing answer', () => {
    // The email and the form it acknowledges cannot say different things:
    // both read the one answer.
    expect(emailBrief({ submissions: 'lead' })).toContain('somebody will be in touch about it')
    expect(emailBrief({ submissions: 'inbox' })).toContain('a reply is coming')
  })

  it('says nothing about what became of it where nobody was asked', () => {
    const brief = emailBrief({})
    expect(brief).not.toContain('in touch about it')
    expect(brief).not.toContain('a reply is coming')
  })
})

/*
 * The site's own search listing (AGL-2918). The scaffold's page step writes
 * one listing per page; the SITE's title and description are the fallback
 * every page with none of its own publishes, and nothing was filling them.
 * They are arithmetic on the answers rather than a model's writing, so they
 * cost no pass and no credit, and they are ready before anything is built.
 */
describe('the site’s own listing, from the answers', () => {
  it('reports it once, beside the first unit, and never again', async () => {
    const step = stepWith({
      page: fakeRunner([], (job) => ({ outputs: [output('screen', job.$id)] })),
    })
    const first = await step(context(siteJob()))
    expect(first.outputs.filter((entry) => entry.resource === 'seo')).toEqual([SITE_LISTING])
    // A later pass has the listing among the job's outputs already, and adds
    // no second one — a person staging it twice would stage it twice.
    const later = await step(
      context(siteJob({ outputs: [LOOK, SITE_LISTING, output('screen', 'drftPage00')] })),
    )
    expect(later.outputs.filter((entry) => entry.resource === 'seo')).toEqual([])
    expect(later.outputs).toEqual([output('screen', 'drftPage01')])
  })

  it('says what the person said the site is, and who it is for', async () => {
    const step = stepWith({
      page: fakeRunner([], () => ({ outputs: [output('screen', 's')] })),
    })
    const outcome = await step(
      context(
        siteJob({
          inputs: {
            businessType: 'a neighborhood dog groomer',
            audience: 'local dog owners',
            pages: AI_SITE_PAGES.min,
            welcomeEmail: false,
          },
        }),
      ),
    )
    expect(aiSiteSeoProposalOf(outcome.outputs)?.values).toEqual({
      'seo.title': 'Neighborhood dog groomer',
      'seo.description': 'Neighborhood dog groomer for local dog owners.',
    })
  })

  it('spends nothing to report it', async () => {
    const step = stepWith({ page: fakeRunner([], () => ({ outputs: [output('screen', 's')] })) })
    const outcome = await step(context(siteJob()))
    // The pass's whole spend is the unit's. A listing that cost a token would
    // show up here, because the fake unit reports none.
    expect({ usage: outcome.usage, estCostUsd: outcome.estCostUsd }).toEqual({
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
    })
  })

  it('does not move where the scaffold thinks it is', async () => {
    // `aiSitePendingUnits` counts outputs by resource. An `seo` output is no
    // unit's resource, so the scaffold resumes at the same unit with it among
    // the outputs as it would without — the assertion the whole design rests
    // on, and the one a new unit resource would quietly break.
    const units = aiSiteJobUnits(confirmedPlan(), { welcomeEmail: true })
    const built = [output('screen', 'screen-0')]
    expect(aiSitePendingUnits(units, [SITE_LISTING, ...built])).toEqual(
      aiSitePendingUnits(units, built),
    )
  })

  it('proposes nothing for a scaffold whose inputs describe no site', async () => {
    // The door refuses such a job, so this is the belt to that braces: a
    // proposal with an empty title would be staged into a REQUIRED field.
    const step = stepWith({ page: fakeRunner([], () => ({ outputs: [output('screen', 's')] })) })
    const outcome = await step(
      context(siteJob({ inputs: { businessType: '  ', pages: AI_SITE_PAGES.min } })),
    )
    expect(outcome.outputs.filter((entry) => entry.resource === 'seo')).toEqual([])
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
    org: object = { plan: 'pro' },
  ) =>
    aiJobAdmissionRefusal('site', {
      firestore: {} as unknown as FirebaseFirestore.Firestore,
      orgId: 'org-1',
      hostId,
      inputs,
      org,
    })

  const good = { businessType: 'dog groomer', pages: AI_SITE_PAGES.min }

  it('admits a scaffold for a site of its own org', async () => {
    await expect(ask(good)).resolves.toBeNull()
  })

  it('refuses inputs that do not read, and a job that names no site', async () => {
    await expect(ask({ pages: 4 })).resolves.toMatchObject({ status: 400 })
    await expect(ask(good, null)).resolves.toMatchObject({ status: 400 })
  })

  it('holds a Free workspace to one or two pages and a paid one to its band, refusing rather than clamping (AGL-3594)', async () => {
    const free = { plan: 'free' }
    await expect(ask({ ...good, pages: 2 }, 'host-1', free)).resolves.toBeNull()
    await expect(ask({ ...good, pages: 1 }, 'host-1', free)).resolves.toBeNull()
    await expect(ask({ ...good, pages: 3 }, 'host-1', free)).resolves.toEqual({
      status: 400,
      error: "A Free workspace's AI site start builds 1 or 2 pages. Paid plans can generate more pages.",
    })
    await expect(ask({ ...good, pages: AI_SITE_PAGES.min }, 'host-1', free)).resolves.toMatchObject({ status: 400 })
    // A paid workspace keeps the band it always had.
    await expect(ask({ ...good, pages: 2 })).resolves.toEqual({
      status: 400,
      error: `A site is planned with ${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max} pages.`,
    })
  })

  it('admits a Free start on its p90, asks first past it, starts it on the go-ahead, and refuses only when nothing is left (AGL-3722)', async () => {
    const seen: unknown[] = []
    const admission = (left: number) =>
      createAiSiteJobAdmission({
        freeCreditsLeft: async (_firestore, input) => {
          seen.push(input.orgId)
          return { left, total: 300, resetsOn: '2026-11-01' }
        },
      })
    const context = (pages: number, extra: Record<string, unknown> = {}) => ({
      firestore: {} as unknown as FirebaseFirestore.Firestore,
      orgId: 'org-1',
      hostId: 'host-1',
      inputs: { ...good, pages },
      org: { plan: 'free' },
      ...extra,
    })
    // Past what is left: not refused, ASKED — the prompt rides a 409, and no job starts.
    const asked = await admission(70)(context(2))
    const prompt = aiFreeSitePrompt({ left: 70, resetsOn: '2026-11-01' }, 2)
    expect(asked).toEqual({ status: 409, error: aiCreditsPromptText(prompt!, 'site'), code: AI_CREDITS_CONFIRM_CODE, credits: prompt })
    expect(asked?.error).toBe(
      'This site is about 137 credits (up to 282). You have 70 left, so it will build as much as it can and pause ' +
        'when your credits run out. You can upgrade or resume when they renew on November 1.',
    )
    expect(seen).toEqual(['org-1'])
    // The go-ahead admits it, and the door is told what was confirmed.
    const confirmed: unknown[] = []
    await expect(
      admission(70)(context(2, { creditsConfirmed: true, onCreditsConfirmed: (one: unknown) => confirmed.push(one) })),
    ).resolves.toBeNull()
    expect(confirmed).toEqual([prompt])
    // Its p90 fits: admitted with no prompt — and the old worst-case hold (282) is gone.
    await expect(admission(aiFreeSiteCreditRange(2).p90)(context(2))).resolves.toBeNull()
    await expect(admission(aiFreeSiteCreditRange(1).p90)(context(1))).resolves.toBeNull()
    expect(aiFreeSiteCreditRange(2).p90).toBeLessThan(aiFreeSiteCreditEstimate(2))
    // Nothing left at all: refused, confirmed or not.
    await expect(admission(0)(context(2, { creditsConfirmed: true }))).resolves.toEqual({
      status: 429,
      error: aiFreeCreditsNoneLeftText('2026-11-01'),
    })
    // Nothing known about what is left: admitted, and the reservation decides.
    await expect(createAiSiteJobAdmission({ freeCreditsLeft: async () => null })(context(2))).resolves.toBeNull()
    // A resume carries on the same job: not asked again.
    seen.length = 0
    await expect(admission(0)(context(2, { plan: { screens: [], create: [], reuse: [], status: 'confirmed' } }))).resolves.not.toMatchObject({ status: 429 })
    expect(seen).toEqual([])
    // A paid workspace is never asked.
    await expect(admission(0)({ ...context(AI_SITE_PAGES.min), org: { plan: 'pro' } })).resolves.toBeNull()
    expect(seen).toEqual([])
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

describe('a site job generates every page from its plan (AGL-3596)', () => {
  const STARTER_HOME = 'scrStarter'
  const LAYOUT_BUILT = 'drftFrameL'

  it('never hands a page unit a page to copy, and names the job the member started', () => {
    const plan = confirmedPlan({
      screens: [planScreen({ title: 'Home', slug: '/', duplicateOf: STARTER_HOME, id: 'drftPage00' })],
    })
    const job = siteJob({ plan, inputs: { businessType: 'dog groomer', pages: 1, autoConfirm: true } })
    const [, unit] = aiSiteJobUnits(plan)
    const derived = aiSiteUnitJob(job, unit, new Map())
    expect(derived.plan?.screens[0].duplicateOf).toBeNull()
    expect(derived.inputs['originJobId']).toBe('job-1')
  })

  it('a page job keeps the page it was asked to start from', () => {
    const plan = confirmedPlan({ screens: [planScreen({ duplicateOf: 'scrAbout' })] })
    const [, unit] = aiSiteJobUnits(plan)
    expect(aiSiteUnitJob(siteJob({ kind: 'page', plan }), unit, new Map()).plan?.screens[0].duplicateOf).toBe('scrAbout')
  })

  it('renders a page the plan named no layout for inside the layout the scaffold built', () => {
    const plan = confirmedPlan({ create: [LAYOUT] })
    const units = aiSiteJobUnits(plan)
    const built = aiSiteBuiltRefs(units, [output('layout', LAYOUT_BUILT, 'Site frame')])
    const page = units.find((unit) => unit.kind === 'page')
    if (!page) throw new Error('a page is a unit')
    expect(aiSiteUnitJob(siteJob({ plan }), page, built).plan?.screens[0].layout).toBe(LAYOUT_BUILT)
  })

  it('does not count a page as built when its draft holds none of its planned sections', async () => {
    // The production failure: the home page was a byte-for-byte copy of the
    // starter, reported as written.
    const starterNodes = { root: { $id: 'root', nodes: ['dh_hero'] }, dh_hero: { $id: 'dh_hero' } }
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'scrCopy')] })) },
      { readNodes: async () => ({ versionId: 'v-1', nodes: starterNodes as never }) },
    )
    const outcome = await step(context(siteJob()))
    // The page is its own failed item, on our side; the rest of the site goes on (AGL-3616).
    expect(outcome.failure).toBeUndefined()
    expect(outcome.item).toMatchObject({ slot: 'p0', status: 'failed', failure: { ours: true, message: AI_SITE_PAGE_NOT_WRITTEN_COPY } })
    expect(outcome.continue).toBe(true)
    expect(outcome.outputs.some((entry) => entry.resource === 'screen')).toBe(false)
  })

  it('counts a page whose draft holds every section its plan named, under the unit’s ids', async () => {
    const [, ...rest] = confirmedPlan().screens
    const plan = confirmedPlan({
      screens: [
        planScreen({
          id: 'drftPage00',
          sections: [
            { name: 'hero', uses: [], items: 0 },
            { name: 'services', uses: [], items: 3 },
          ],
        }),
        ...rest,
      ],
    })
    const written = {
      [aiPageSectionNodeId('drftPage00', 0)]: {},
      [aiPageSectionNodeId('drftPage00', 1)]: {},
    }
    const read = jest.fn(async () => ({ versionId: 'v-1', nodes: written as never }))
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'drftPage00')] })) },
      { readNodes: read },
    )
    const outcome = await step(context(siteJob({ plan })))
    expect(outcome.failure).toBeUndefined()
    expect(outcome.continue).toBe(true)
    expect(read).toHaveBeenCalledWith(expect.anything(), { kind: 'screen', hostId: 'host-1', id: 'drftPage00' })
  })
})

describe('a guided site start publishes what it built (AGL-3596)', () => {
  const SITE_PUBLISH = {
    liveUrl: 'https://hillside.aglyn.app/',
    published: [{ id: 'screen-3', label: 'screen-3', path: '/' }],
    drafts: [],
  }
  const lastPass = (inputs: Record<string, unknown>) =>
    siteJob({
      inputs: { businessType: 'dog groomer', pages: AI_SITE_PAGES.min, welcomeEmail: false, ...inputs },
      outputs: [LOOK, ...['screen-0', 'screen-1', 'screen-2'].map((id) => output('screen', id))],
    })

  it('publishes every page on the last pass of a guided start, once, and keeps what it put live', async () => {
    const publish = jest.fn(async () => SITE_PUBLISH)
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'screen-3')] })) },
      { publish },
    )
    const outcome = await step(context(lastPass({ autoConfirm: true })))
    expect(publish).toHaveBeenCalledTimes(1)
    const [, input] = publish.mock.calls[0] as unknown as [unknown, { outputs: AiJobOutput[] }]
    expect(input.outputs.filter((entry) => entry.resource === 'screen').map((entry) => entry.id)).toEqual([
      'screen-0',
      'screen-1',
      'screen-2',
      'screen-3',
    ])
    expect(outcome.sitePublish).toEqual(SITE_PUBLISH)
    // A job that already published does not publish again.
    publish.mockClear()
    await step(context({ ...lastPass({ autoConfirm: true }), sitePublish: SITE_PUBLISH }))
    expect(publish).not.toHaveBeenCalled()
  })

  it('never puts a canceled start live: its pages stay drafts (AGL-3616)', async () => {
    const publish = jest.fn(async () => SITE_PUBLISH)
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'screen-3')] })) },
      { publish },
    )
    // Seen by the step's own watch: its signal was aborted by the cancel.
    const aborted = new AbortController()
    aborted.abort(new AiJobCanceledError())
    const watched = await step({ ...context(lastPass({ autoConfirm: true })), signal: aborted.signal })
    expect(publish).not.toHaveBeenCalled()
    expect(watched.sitePublish).toBeUndefined()
    expect(watched.outputs.map((entry) => entry.id)).toContain('screen-3')
    // Read fresh right before the publish: the cancel was asked a moment ago.
    const read = (stored: Record<string, unknown>) =>
      ({
        collection: () => ({
          doc: () => ({
            collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => stored }) }) }),
          }),
        }),
      }) as unknown as FirebaseFirestore.Firestore
    await step({
      ...context(lastPass({ autoConfirm: true })),
      firestore: read({ status: 'running', cancelRequested: { at: new Date(), by: 'uid-2' } }),
    })
    expect(publish).not.toHaveBeenCalled()
    // A budget that ran out is not a cancel, and a job nobody canceled publishes.
    const timedOut = new AbortController()
    timedOut.abort(Object.assign(new Error('budget'), { name: 'TimeoutError' }))
    await step({
      ...context(lastPass({ autoConfirm: true })),
      signal: timedOut.signal,
      firestore: read({ status: 'running' }),
    })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('publishes what was built when the last unit fails, since no pass comes after it (AGL-3676)', async () => {
    // The local store run: the welcome email, the last unit, broke a building
    // rule twice, and the site it ended was never published.
    const publish = jest.fn(async () => SITE_PUBLISH)
    const step = stepWith(
      { page: fakeRunner([], () => ({})), email: fakeRunner([], () => ({ refused: true })) },
      { publish },
    )
    const job = siteJob({
      inputs: { businessType: 'dog groomer', pages: AI_SITE_PAGES.min, welcomeEmail: true, autoConfirm: true },
      outputs: [LOOK, ...['screen-0', 'screen-1', 'screen-2', 'screen-3'].map((id) => output('screen', id))],
    })
    const outcome = await step(context(job))
    expect(outcome.item).toMatchObject({ slot: 'e', status: 'failed' })
    expect(outcome.continue).toBeUndefined()
    expect(publish).toHaveBeenCalledTimes(1)
    const [, input] = publish.mock.calls[0] as unknown as [unknown, { outputs: AiJobOutput[] }]
    expect(input.outputs.map((entry) => entry.id)).toEqual(['screen-0', 'screen-1', 'screen-2', 'screen-3'])
    expect(outcome.sitePublish).toEqual(SITE_PUBLISH)
    // A unit that fails with others still open publishes nothing yet.
    publish.mockClear()
    await stepWith({ page: fakeRunner([], () => ({ refused: true })) }, { publish })(
      context(siteJob({ inputs: { businessType: 'dog groomer', pages: AI_SITE_PAGES.min, autoConfirm: true } })),
    )
    expect(publish).not.toHaveBeenCalled()
  })

  it('leaves every other site job’s pages as drafts', async () => {
    const publish = jest.fn(async () => SITE_PUBLISH)
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'screen-3')] })) },
      { publish },
    )
    const outcome = await step(context(lastPass({})))
    expect(publish).not.toHaveBeenCalled()
    expect(outcome.sitePublish).toBeUndefined()
  })

  it('does not publish before the last unit, and a publish that throws never fails the job', async () => {
    const publish = jest.fn(async () => {
      throw new Error('down')
    })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'screen-0')] })) },
      { publish },
    )
    await step(context(siteJob({ inputs: { businessType: 'dog groomer', pages: AI_SITE_PAGES.min, autoConfirm: true } })))
    expect(publish).not.toHaveBeenCalled()
    const last = await step(context(lastPass({ autoConfirm: true })))
    expect(publish).toHaveBeenCalledTimes(1)
    expect(last.failure).toBeUndefined()
    expect(last.sitePublish).toBeUndefined()
    error.mockRestore()
  })
})

describe('a blog’s first posts and a store’s first products (AGL-3676)', () => {
  const blogInputs = { businessType: 'a pottery blog', siteKind: 'blog', businessName: 'Clay Notes', pages: AI_SITE_PAGES.min, welcomeEmail: false }
  const storeInputs = { businessType: 'a candle shop', siteKind: 'store', pages: AI_SITE_PAGES.min, welcomeEmail: false }
  const entry = (id: string, label: string): AiJobOutput => ({
    resource: 'entry',
    id,
    hostId: 'host-1',
    label,
    proposal: { collectionId: 'job-1-posts', collectionSlug: 'blog', slug: id },
  })
  const pageRunner = () => fakeRunner([], () => ({ outputs: [output('screen', 'screen-x')] }))

  it('builds the part after the layout and the form and before the pages, as its own row', () => {
    const plan = confirmedPlan({ create: [LAYOUT, FORM] })
    expect(aiSiteJobUnits(plan, { content: 'posts' }).map((unit) => unit.slot)).toEqual(['t', 'l', 'f', 'posts', 'p0', 'p1', 'p2', 'p3'])
    const units = aiSiteJobUnits(plan, { content: 'products' })
    expect(units[3]).toMatchObject({ kind: 'products', jobKind: 'products', resource: 'product', label: AI_SITE_PRODUCTS_LABEL })
    expect(aiSiteLedgerUnits(units)[3]).toMatchObject({ slot: 'products', op: 'products', deps: [] })
    expect(aiSiteLedgerUnits(aiSiteJobUnits(plan, { content: 'posts' }))[3]).toMatchObject({ op: 'posts', label: AI_SITE_POSTS_LABEL })
    expect(aiSiteJobUnits(plan).some((unit) => unit.kind === 'posts' || unit.kind === 'products')).toBe(false)
  })

  it('writes a paid blog’s posts after its look, told the posts written, the pages’ addresses and the byline', async () => {
    const seen: AiJob[] = []
    const contentRefusal = jest.fn(async () => null)
    const step = stepWith({ page: pageRunner() }, { posts: fakeRunner(seen, () => ({ outputs: [entry('job-1-posts-0', 'One')], continue: true })), contentRefusal })
    const outcome = await step(context(siteJob({ inputs: blogInputs })))
    expect(contentRefusal).toHaveBeenCalledWith('posts', expect.objectContaining({ job: expect.objectContaining({ $id: 'job-1' }) }))
    expect(seen.map((job) => job.$id)).toEqual(['job-1-posts'])
    expect(seen[0].inputs['siteContent']).toEqual({
      written: [],
      total: AI_SITE_POSTS,
      avoidSlugs: ['page-0', 'page-1', 'page-2', 'page-3'],
      byline: 'Clay Notes',
    })
    expect(outcome.item).toMatchObject({ slot: 'posts', status: 'running', outputs: ['job-1-posts-0'] })
    expect(outcome.continue).toBe(true)
  })

  it('asks no admission again on a later pass of the same part, and tells it what was written', async () => {
    const seen: AiJob[] = []
    const contentRefusal = jest.fn(async () => 'never asked')
    const units = aiSiteJobUnits(confirmedPlan(), { content: 'posts' })
    const outputs = [LOOK, entry('job-1-posts-0', 'One')]
    const items = aiSiteInitialLedger(units, [LOOK]).map((row) =>
      row.slot === 'posts' ? { ...row, status: 'running' as const, outputs: ['job-1-posts-0'] } : row,
    )
    const step = stepWith({ page: pageRunner() }, { posts: fakeRunner(seen, () => ({ outputs: [entry('job-1-posts-1', 'Two')], continue: true })), contentRefusal })
    await step(context(siteJob({ inputs: blogInputs, outputs, items })))
    expect(contentRefusal).not.toHaveBeenCalled()
    expect((seen[0].inputs['siteContent'] as { written: unknown[] }).written).toEqual([{ id: 'job-1-posts-0', title: 'One' }])
  })

  it('skips the part, unspent, where the member or the plan may not have it, and says why', async () => {
    const posts = jest.fn()
    const step = stepWith({ page: pageRunner() }, { posts, contentRefusal: async () => 'Editing requires the editor role' })
    const outcome = await step(context(siteJob({ inputs: blogInputs })))
    expect(posts).not.toHaveBeenCalled()
    expect(outcome.item).toEqual({ slot: 'posts', status: 'skipped', note: 'Not built: Editing requires the editor role' })
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.continue).toBe(true)
  })

  it('asks a store’s catalog for 3 to 6 products under the products step, as a catalog', async () => {
    const seen: AiJob[] = []
    const products = fakeRunner(seen, () => ({ outputs: [output('product', 'job-1-products-0', 'Candle')] }))
    // Owed only where the step that proposes a catalog is loaded.
    expect((await stepWith({ page: pageRunner() }, { products })(context(siteJob({ inputs: storeInputs })))).item?.slot).toBe('p0')
    const step = stepWith({ page: pageRunner(), products: fakeRunner([], () => ({})) }, { products, contentRefusal: async () => null })
    const outcome = await step(context(siteJob({ inputs: storeInputs })))
    expect(seen[0]).toMatchObject({ $id: 'job-1-products', kind: 'products', inputs: { target: 'catalog' } })
    expect(seen[0].brief.split('\n').pop()).toBe("Propose between 3 and 6 products: the store's first ones.")
    expect(outcome.item).toMatchObject({ slot: 'products', status: 'succeeded', outputs: ['job-1-products-0'] })
    // The row says what is left before the store sells (AGL-3676).
    expect(outcome.item?.note).toBe(AI_SITE_PRODUCTS_PRICE_NOTE)
  })

  it('hands each page the store’s catalog and the blog to list, and a selling site’s layout its cart (AGL-3676)', () => {
    const plan = confirmedPlan({ create: [LAYOUT] })
    const units = aiSiteJobUnits(plan, { content: 'products' })
    const page = units.find((unit) => unit.kind === 'page')
    const layout = units.find((unit) => unit.kind === 'layout')
    if (!page || !layout) throw new Error('a page and a layout are units')
    const listingsOf = (job: AiJob) => aiLayoutListingsOf(job.inputs)
    const store = aiSiteUnitJob(siteJob({ plan, inputs: storeInputs, outputs: [LOOK, output('product', 'p0', 'Fig candle')] }), page, new Map())
    expect(listingsOf(store)).toEqual([expect.objectContaining({ kind: 'products', records: ['Fig candle'] })])
    const blog = aiSiteUnitJob(siteJob({ plan, inputs: blogInputs, outputs: [LOOK, entry('a', 'Centering clay')] }), page, new Map())
    expect(listingsOf(blog)).toEqual([expect.objectContaining({ kind: 'posts', href: '/blog', collectionSlug: 'blog' })])
    // Built before the products, the layout is told the store sells while its ledger owes them.
    const owed = units.map((unit) => ({ slot: unit.slot, op: unit.kind, label: unit.label, status: 'pending' }))
    const sells = aiSiteUnitJob(siteJob({ plan, inputs: storeInputs, items: owed as never }), layout, aiSiteBuiltRefs(units, []))
    expect(listingsOf(sells).map((listing) => listing.kind)).toEqual(['products'])
    const skipped = owed.map((row) => (row.slot === 'products' ? { ...row, status: 'skipped' } : row))
    // A store whose products were skipped still lists its catalog, as a storefront
    // that says new pieces are on the way, but carries no cart (AGL-3676).
    expect(listingsOf(aiSiteUnitJob(siteJob({ plan, inputs: storeInputs, items: skipped as never }), layout, aiSiteBuiltRefs(units, [])))).toEqual([
      expect.objectContaining({ kind: 'products', records: [], cart: false }),
    ])
    const portfolio = { ...storeInputs, siteKind: 'portfolio' }
    expect(listingsOf(aiSiteUnitJob(siteJob({ plan, inputs: portfolio, items: skipped as never }), layout, aiSiteBuiltRefs(units, [])))).toEqual([])
  })

  it('tells each page the posts and the products built before it, by name', () => {
    const plan = confirmedPlan()
    const page = aiSiteJobUnits(plan).find((unit) => unit.kind === 'page')
    if (!page) throw new Error('a page is a unit')
    const blog = aiSiteUnitJob(siteJob({ inputs: blogInputs, outputs: [LOOK, entry('a', 'Centering clay'), entry('b', 'Trimming feet')] }), page, new Map())
    expect(blog.brief).toContain('This site\'s blog at /blog has these posts: “Centering clay”, “Trimming feet”.')
    const store = aiSiteUnitJob(siteJob({ inputs: storeInputs, outputs: [LOOK, output('product', 'p0', 'Fig candle')] }), page, new Map())
    expect(store.brief).toContain('This store\'s products are: “Fig candle”.')
    expect(aiSiteUnitJob(siteJob(), page, new Map()).brief).not.toContain('This site\'s blog')
  })

  it('publishes a guided blog’s posts once its pages are live, and drops the blog’s cached addresses', async () => {
    const units = aiSiteJobUnits(confirmedPlan(), { content: 'posts' })
    const posts = [entry('job-1-posts-0', 'One'), entry('job-1-posts-1', 'Two'), entry('job-1-posts-2', 'Three')]
    const pages = ['screen-0', 'screen-1', 'screen-2'].map((id) => output('screen', id))
    const items = aiSiteInitialLedger(units, [LOOK, ...pages]).map((row) =>
      row.slot === 'posts' ? { ...row, status: 'succeeded' as const, outputs: posts.map((post) => post.id) } : row,
    )
    const publish = jest.fn(async () => ({ liveUrl: null, published: [{ id: 'screen-3', label: 'Home', path: '/' }], drafts: [] }))
    const publishPosts = jest.fn(async () => ({ published: 3, kept: 0, paths: ['/blog', '/blog/one'] }))
    const dropCache = jest.fn(async () => ({ complete: true }))
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'screen-3')] })) },
      { publish, publishPosts, dropCache: dropCache as never },
    )
    await step(context(siteJob({ inputs: { ...blogInputs, autoConfirm: true }, outputs: [LOOK, ...posts, ...pages], items })))
    expect(publishPosts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outputs: posts }))
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'], paths: { 'host-1': ['/blog', '/blog/one'] } }))
    // Nothing published, nothing for the posts either.
    publishPosts.mockClear()
    publish.mockResolvedValueOnce({ liveUrl: null, published: [], drafts: [] })
    await step(context(siteJob({ inputs: { ...blogInputs, autoConfirm: true }, outputs: [LOOK, ...posts, ...pages], items })))
    expect(publishPosts).not.toHaveBeenCalled()
  })

  it('tells the publish the blog went unwritten when its posts part failed, so its links come out (AGL-3660)', async () => {
    const units = aiSiteJobUnits(confirmedPlan(), { content: 'posts' })
    const pages = ['screen-0', 'screen-1', 'screen-2'].map((id) => output('screen', id))
    const ledger = (posts: Record<string, unknown>) =>
      aiSiteInitialLedger(units, [LOOK, ...pages]).map((row) => (row.slot === 'posts' ? { ...row, ...posts } : row))
    const publish = jest.fn(async () => ({ liveUrl: null, published: [], drafts: [] }))
    const step = stepWith(
      { page: fakeRunner([], () => ({ outputs: [output('screen', 'screen-3')] })) },
      { publish, publishPosts: jest.fn(async () => null) as never, dropCache: jest.fn(async () => ({ complete: true })) as never },
    )
    await step(context(siteJob({ inputs: { ...blogInputs, autoConfirm: true }, outputs: [LOOK, ...pages], items: ledger({ status: 'failed', outputs: [] }) as never })))
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ blogUnwritten: true }))
    const posts = [entry('job-1-posts-0', 'One')]
    await step(
      context(
        siteJob({
          inputs: { ...blogInputs, autoConfirm: true },
          outputs: [LOOK, ...posts, ...pages],
          items: ledger({ status: 'succeeded', outputs: posts.map((post) => post.id) }) as never,
        }),
      ),
    )
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ blogUnwritten: false }))
    // A site that owes no posts says nothing about a blog.
    const plain = aiSiteInitialLedger(aiSiteJobUnits(confirmedPlan()), [LOOK, ...pages])
    await step(context(siteJob({ inputs: { ...siteJob().inputs, autoConfirm: true }, outputs: [LOOK, ...pages], items: plain })))
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), expect.not.objectContaining({ blogUnwritten: expect.anything() }))
  })

  it('gives a post’s pass the time a post needs, and bounds the passes with every post in them', () => {
    expect(aiSiteJobRunMinimumMs(siteJob({ inputs: blogInputs }))).toBe(AI_SITE_POST_BUDGET.minimumMs)
    // …and a site's datasets, one pass each (AGL-3616).
    expect(AI_SITE_MAX_PASSES).toBe(AI_SITE_PAGES.max * (AI_SITE_MAX_SECTIONS + 1) + 3 + AI_SITE_DATASETS_MAX + AI_SITE_POSTS + 1)
  })
})

describe('a site’s datasets (AGL-3616)', () => {
  const MENU = {
    kind: 'dataset' as const,
    name: 'Menu',
    why: 'the dishes the pages list',
    duplicateOf: null,
    fields: ['Dish', 'Description'],
    id: 'drftMenu01',
  }
  const TEAM = { ...MENU, name: 'Team', fields: ['Role'], id: 'drftTeam01' }
  const MENU_OUTPUT: AiJobOutput = {
    resource: 'draft',
    draftResource: 'dataset',
    id: 'drftMenu01',
    hostId: 'host-1',
    label: 'Menu',
    proposal: { fields: [{ id: 'dish', name: 'Dish', type: 'text' }], recordNames: ['Margherita'], addressField: null },
  }
  /** Four pages: one listing the menu, two plain, and the menu's record template. */
  const plan = confirmedPlan({
    create: [LAYOUT, FORM, MENU, TEAM],
    screens: [
      planScreen({ title: 'Home', slug: '/', id: 'drftPage00', sections: [{ name: 'hero', uses: [], items: 0 }, { name: 'From the menu', uses: ['new:Menu'], items: 3 }] }),
      planScreen({ title: 'About', slug: 'about', id: 'drftPage01', nav: false }),
      planScreen({ title: 'Dish', slug: 'dish', id: 'drftPage02', nav: false, record: { dataset: 'new:Menu', base: 'menu' } }),
      planScreen({ title: 'Contact', slug: 'contact', id: 'drftPage03', nav: false }),
    ],
  })
  const pageRunner = () => fakeRunner([], () => ({ outputs: [output('screen', 'screen-x')] }))

  it('builds each dataset after the layout and before the form and the pages, and a page after the datasets it lists', () => {
    const units = aiSiteJobUnits(plan)
    expect(units.map((unit) => unit.slot)).toEqual(['t', 'l', 'd0', 'd1', 'f', 'p0', 'p1', 'p2', 'p3'])
    expect(units[2]).toMatchObject({ kind: 'dataset', jobKind: 'text', resource: 'draft', label: 'Menu', creation: MENU })
    const ledger = aiSiteLedgerUnits(units)
    expect(ledger[2]).toMatchObject({ slot: 'd0', op: 'dataset', deps: [] })
    // A form that writes to no dataset depends on none.
    expect(ledger.find((unit) => unit.slot === 'f')?.deps).toEqual([])
    // The home lists the menu, the record template shows it; the About page needs neither.
    expect(ledger.find((unit) => unit.slot === 'p0')?.deps).toEqual(['l', 'f', 'd0'])
    expect(ledger.find((unit) => unit.slot === 'p1')?.deps).toEqual(['l', 'f'])
    expect(ledger.find((unit) => unit.slot === 'p2')?.deps).toEqual(['l', 'f', 'd0'])
  })

  it('asks before a dataset’s first pass, and hands it where the plan lists it, under the creation’s id', async () => {
    const seen: AiJob[] = []
    const datasetRefusal = jest.fn(async () => null)
    const dataset = fakeRunner(seen, () => ({ outputs: [MENU_OUTPUT] }))
    const job = siteJob({ plan: confirmedPlan({ create: [MENU], screens: plan.screens }) })
    const outcome = await stepWith({ page: pageRunner() }, { dataset, datasetRefusal })(context(job))
    expect(datasetRefusal).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ $id: 'job-1' }) }))
    expect(seen.map((one) => one.$id)).toEqual(['drftMenu01'])
    expect(seen[0].inputs['siteDataset']).toEqual({ shownIn: ['Home › From the menu (3 items)'], recordPages: true, pictures: 'things' })
    expect(seen[0].brief).toContain('Build the dataset “Menu”: the dishes the pages list')
    expect(outcome.item).toMatchObject({ slot: 'd0', status: 'succeeded', outputs: ['drftMenu01'] })
  })

  it('skips a dataset, unspent, where the data plugin or the member may not have it', async () => {
    const dataset = jest.fn()
    const job = siteJob({ plan: confirmedPlan({ create: [MENU], screens: plan.screens }) })
    const outcome = await stepWith({ page: pageRunner() }, { dataset, datasetRefusal: async () => 'Dataset limit reached (2) — upgrade in Billing' })(context(job))
    expect(dataset).not.toHaveBeenCalled()
    expect(outcome.item).toEqual({ slot: 'd0', status: 'skipped', note: 'Not built: Dataset limit reached (2) — upgrade in Billing' })
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
  })

  it('hands a page that lists the dataset its records to repeat, and names them in its brief', () => {
    const units = aiSiteJobUnits(plan)
    const home = units.find((unit) => unit.slot === 'p0') as AiSiteUnit
    const built = new Map([['menu', { id: 'drftMenu01', label: 'Menu', kind: 'dataset' as const }]])
    const job = aiSiteUnitJob(siteJob({ plan, outputs: [LOOK, MENU_OUTPUT] }), home, built)
    expect(aiLayoutListingsOf(job.inputs)).toEqual([
      expect.objectContaining({
        kind: 'records',
        datasetId: 'drftMenu01',
        fields: [{ id: 'dish', name: 'Dish', type: 'text' }],
        placements: [{ screenId: 'drftPage00', section: 1, role: 'featured' }],
      }),
    ])
    expect(job.brief).toContain('This site\'s dataset “Menu” holds: “Margherita”.')
    // The section names the dataset by the id it was written under.
    expect(job.plan?.screens[0].sections[1].uses).toEqual(['drftMenu01'])
    expect(job.plan?.reuse).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'dataset', id: 'drftMenu01' })]))
    // The record template binds the dataset it shows by id.
    const template = aiSiteUnitJob(siteJob({ plan, outputs: [LOOK, MENU_OUTPUT] }), units.find((unit) => unit.slot === 'p2') as AiSiteUnit, built)
    expect(template.plan?.screens[0].record).toEqual({ dataset: 'drftMenu01', base: 'menu' })
  })

  it('hands a page the record’s photo field to lead each card with, and the photos the records show, which it never places again (AGL-3616)', () => {
    const units = aiSiteJobUnits(plan)
    const home = units.find((unit) => unit.slot === 'p0') as AiSiteUnit
    const built = new Map([['menu', { id: 'drftMenu01', label: 'Menu', kind: 'dataset' as const }]])
    const pictured: AiJobOutput = {
      ...MENU_OUTPUT,
      proposal: {
        fields: [
          { id: 'dish', name: 'Dish', type: 'text' },
          { id: 'image', name: 'Image', type: 'text' },
        ],
        recordNames: ['Margherita'],
        addressField: null,
        imageField: 'image',
        photos: ['media:host-1/m1', 'media:host-1/m2'],
      },
    }
    const job = aiSiteUnitJob(siteJob({ plan, outputs: [LOOK, pictured] }), home, built)
    expect(aiLayoutListingsOf(job.inputs)).toEqual([
      expect.objectContaining({ kind: 'records', imageField: 'image', fields: [{ id: 'dish', name: 'Dish', type: 'text' }] }),
    ])
    expect(job.inputs[AI_STOCK_PHOTO_AVOID_INPUT]).toEqual(['media:host-1/m1', 'media:host-1/m2'])
    // A dataset with no photos names none.
    expect(aiSiteUnitJob(siteJob({ plan, outputs: [LOOK, MENU_OUTPUT] }), home, built).inputs).not.toHaveProperty(AI_STOCK_PHOTO_AVOID_INPUT)
  })

  it('builds no record template for a dataset that was not made, and the page that lists it without it', async () => {
    const units = aiSiteJobUnits(plan)
    const done = ['t', 'l', 'f']
    const items = aiSiteInitialLedger(units, [LOOK]).map((row) =>
      done.includes(row.slot)
        ? { ...row, status: 'succeeded' as const, outputs: [row.slot] }
        : row.slot === 'd0'
          ? { ...row, status: 'failed' as const }
          : row.slot === 'd1' || row.slot === 'p0' || row.slot === 'p1'
            ? { ...row, status: 'succeeded' as const, outputs: [`${row.slot}-out`] }
            : row,
    )
    const page = jest.fn()
    const outcome = await stepWith({ page: page as never })(context(siteJob({ plan, items })))
    expect(page).not.toHaveBeenCalled()
    expect(outcome.item).toMatchObject({
      slot: 'p2',
      status: 'skipped',
      note: 'Not built: the dataset “Menu” it shows a page of each record of could not be created.',
      degradedBy: ['d0'],
    })
    // The home, built after the menu failed, is told to write its items out.
    const homeItems = aiSiteInitialLedger(units, [LOOK]).map((row) =>
      done.includes(row.slot)
        ? { ...row, status: 'succeeded' as const, outputs: [row.slot] }
        : row.slot === 'd0'
          ? { ...row, status: 'failed' as const }
          : row.slot === 'd1'
            ? { ...row, status: 'succeeded' as const, outputs: ['d1'] }
            : row,
    )
    const seen: AiJob[] = []
    const home = await stepWith({ page: fakeRunner(seen, () => ({ outputs: [output('screen', 'drftPage00')] })) })(
      context(siteJob({ plan, items: homeItems })),
    )
    expect(home.item).toMatchObject({ slot: 'p0', status: 'degraded', degradedBy: ['d0'] })
    expect(seen[0].brief).toContain('without the dataset “Menu”')
  })

  it('never publishes a record template at its own address on a guided start', async () => {
    const units = aiSiteJobUnits(plan)
    const outputs = [LOOK, MENU_OUTPUT, output('screen', 'home-out'), output('screen', 'about-out'), output('screen', 'dish-out')]
    const ids: Record<string, string> = { d0: 'drftMenu01', d1: 'drftTeam01', p0: 'home-out', p1: 'about-out', p2: 'dish-out' }
    const items = aiSiteInitialLedger(units, [LOOK]).map((row) =>
      row.slot === 'p3' ? row : { ...row, status: 'succeeded' as const, outputs: [ids[row.slot] ?? row.slot] },
    )
    const publish = jest.fn(async () => ({ liveUrl: null, published: [], drafts: [] }))
    const step = stepWith({ page: fakeRunner([], () => ({ outputs: [output('screen', 'contact-out')] })) }, { publish })
    await step(context(siteJob({ plan, items, outputs, inputs: { businessType: 'a trattoria', pages: 4, welcomeEmail: false, autoConfirm: true } })))
    const [, input] = publish.mock.calls[0] as unknown as [unknown, { outputs: AiJobOutput[] }]
    expect(input.outputs.map((entry) => entry.id)).toEqual(['home-out', 'about-out', 'contact-out'])
  })
})

describe('a form that writes to a dataset (AGL-3616)', () => {
  const VOLUNTEERS = {
    kind: 'dataset' as const,
    name: 'Volunteers',
    why: 'each sign-up kept as a record',
    duplicateOf: null,
    fields: ['fullName', 'email', 'availability'],
    id: 'drftVolnt01',
  }
  const SIGN_UP = { ...FORM, name: 'Volunteer sign-up', fields: ['fullName', 'email', 'availability'], writesTo: 'new:Volunteers' }
  const plan = confirmedPlan({
    create: [LAYOUT, SIGN_UP, VOLUNTEERS],
    screens: [
      planScreen({ title: 'Home', slug: '/', id: 'drftPage00' }),
      planScreen({ title: 'Volunteer', slug: 'volunteer', id: 'drftPage01', nav: false, sections: [{ name: 'sign up', uses: ['new:Volunteer sign-up'], items: 0 }] }),
      planScreen({ title: 'About', slug: 'about', id: 'drftPage02', nav: false }),
      planScreen({ title: 'Contact', slug: 'contact', id: 'drftPage03', nav: false }),
    ],
  })

  it('builds the dataset before the form, and the form after it', () => {
    const units = aiSiteJobUnits(plan)
    expect(units.map((unit) => unit.slot)).toEqual(['t', 'l', 'd0', 'f', 'p0', 'p1', 'p2', 'p3'])
    const ledger = aiSiteLedgerUnits(units)
    expect(ledger.find((unit) => unit.slot === 'f')?.deps).toEqual(['d0'])
  })

  it('tells the dataset which form writes to it, with the form’s fields', () => {
    const units = aiSiteJobUnits(plan)
    const job = aiSiteUnitJob(siteJob({ plan }), units.find((unit) => unit.slot === 'd0') as AiSiteUnit, new Map())
    expect(job.inputs['siteDataset']).toEqual({
      shownIn: [],
      recordPages: false,
      forForm: { name: 'Volunteer sign-up', fields: ['fullName', 'email', 'availability'] },
    })
  })

  it('hands the form the dataset built for it, by id', () => {
    const units = aiSiteJobUnits(plan)
    const built = new Map([['volunteers', { id: 'drftVolnt01', label: 'Volunteers', kind: 'dataset' as const }]])
    const job = aiSiteUnitJob(siteJob({ plan }), units.find((unit) => unit.slot === 'f') as AiSiteUnit, built)
    expect(job.plan?.create).toEqual([expect.objectContaining({ kind: 'form', writesTo: 'drftVolnt01' })])
    expect(job.inputs[AI_FORM_DATASET_MADE_INPUT]).toBe('drftVolnt01')
  })

  it('builds the form without the binding where its dataset could not be made', async () => {
    const units = aiSiteJobUnits(plan)
    const items = aiSiteInitialLedger(units, [LOOK]).map((row) =>
      row.slot === 't' || row.slot === 'l'
        ? { ...row, status: 'succeeded' as const, outputs: [row.slot] }
        : row.slot === 'd0'
          ? { ...row, status: 'failed' as const }
          : row,
    )
    const seen: AiJob[] = []
    const form = fakeRunner(seen, () => ({ outputs: [output('form', 'drftContct')] }))
    const outcome = await stepWith({ form, page: fakeRunner([], () => ({ outputs: [output('screen', 'x')] })) })(
      context(siteJob({ plan, items })),
    )
    expect(outcome.item).toMatchObject({
      slot: 'f',
      status: 'degraded',
      degradedBy: ['d0'],
      note: 'Its submissions arrive in the Inbox only: the dataset “Volunteers” could not be created.',
    })
    expect(seen[0].plan?.create[0]?.writesTo).toBeNull()
    expect(seen[0].inputs[AI_FORM_DATASET_MADE_INPUT]).toBeUndefined()
  })
})

describe('a dataset’s pass, timed (AGL-3616)', () => {
  it('gives a dataset’s pass the time one dataset needs', () => {
    const menu = { kind: 'dataset' as const, name: 'Menu', why: 'dishes', duplicateOf: null, fields: ['Dish'], id: 'drftMenu01' }
    expect(aiSiteJobRunMinimumMs(siteJob({ plan: confirmedPlan({ create: [menu] }) }))).toBe(AI_SITE_DATASET_BUDGET.minimumMs)
  })
})
