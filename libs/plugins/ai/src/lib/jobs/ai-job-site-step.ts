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

import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import {
  isAiPlanNewRef,
  type AiBuildPlanCreate,
  type AiBuildPlanCreateKind,
  type AiBuildPlanScreen,
} from '../model/ai-build-plan'
import type {
  AiJob,
  AiJobItemLedger,
  AiJobKind,
  AiJobOutput,
  AiJobOutputResource,
  AiJobPlan,
} from '../model/ai-jobs.types'
import {
  aiBuildDegradation,
  aiBuildInitialLedger,
  aiBuildItemDelivered,
  aiBuildItemOpen,
  aiBuildNextUnit,
  type AiBuildUnit,
} from '../model/ai-build-job'
import { aiBuildBuiltRefs, aiUnitErrorRetryable, aiUnitFailure, aiUnitSpend } from './ai-build-unit-outcome'
import {
  AI_SITE_EMAIL_TYPE,
  AI_SITE_MAX_SECTIONS,
  AI_SITE_PAGES,
  aiSiteNameSentence,
  aiSitePagesRefusal,
  aiSitePlanRefusal,
  aiSiteSubmissions,
  aiSiteWords,
  parseAiSiteJobInputs,
  type AiSiteJobInputs,
  aiSiteBlogNavPage,
} from '../model/ai-site-job'
import {
  AI_SITE_SEO_OUTPUT_ID,
  aiSiteSeoProposalForInputs,
} from '../model/ai-site-start-seo'
import { aiModelForStep } from '../providers/routing'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiOriginJobId, aiRecordedJobDraftId } from './ai-job-draft-ids'
import { readAiDraftNodes } from './ai-job-drafts'
import {
  AI_LAYOUT_SITE_PAGES_INPUT,
  AI_LAYOUT_SITE_PAGES_MAX,
  aiLayoutIsHomeSlug,
  aiLayoutSitePagesOfPlan,
} from './ai-job-layout-site-pages'
import { aiPageSectionNodeId } from './ai-job-page-sections'
import { AI_LAYOUT_FORM_PAGE_INPUT, AI_LAYOUT_LANGUAGE_INPUT, aiLayoutFormPageOfPlan } from './ai-job-page-language'
import { aiJobPublishesSite, aiPublishGuidedSite } from './ai-site-publish'
import {
  AI_SITE_CONTENT_INPUT,
  AI_SITE_POST_BUDGET,
  AI_SITE_POSTS,
  AI_SITE_POSTS_LABEL,
  AI_SITE_PRODUCTS_LABEL,
  aiPublishSitePosts,
  aiSiteContentBriefLines,
  aiSiteContentPart,
  aiSiteContentRefusal,
  aiSiteProductsBriefLine,
  createAiSiteProductsRunner,
  runAiSitePostsUnit,
  type AiSitePostsInput,
} from './ai-job-site-content'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { AI_SITE_LOOK_BUDGET, aiRunSiteLook } from './ai-job-site-look'
import { aiConfirmedPlan, aiUnspentOutcome } from './ai-job-generation'
import {
  AI_JOB_BRIEF_MAX_CHARS,
  type AiJobItemOutcome,
  type AiJobStepContext,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import { AI_JOB_PAGE_STEP_MINIMUM_MS } from './ai-job-page-budget'
import {
  aiJobStepRunMinimumMs,
  aiJobStepRunnerFor,
  registerAiJobStep,
  registerAiJobStepPasses,
} from './ai-jobs'

/**
 * The site scaffold (AGL-2911): the generation step of a `site` job, run once
 * a member confirmed the plan their brief produced.
 *
 * ── It builds nothing itself ─────────────────────────────────────────────
 *
 * A scaffold is a whole site: a palette suggestion, the layout its pages
 * render inside, the contact form they place, four to eight pages with their
 * search listings, and a welcome email. Every one of those is already a job
 * kind with a step of its own, so this step generates nothing and asks no
 * model anything. It works through the confirmed plan one UNIT at a time and
 * hands each unit to the runner registered for the kind that owns it — the
 * theme step for the palette, the page step for a page — under a job of that
 * kind derived from this one.
 *
 * That is why the scaffold cannot drift from the thing it scaffolds: a page
 * it builds is a page job's page, held to the same doctrine, written by the
 * same draft writer, left unpublished by the same rule. A kind whose step
 * this deployment has not loaded is simply not among the units, so nothing
 * here knows which issues have landed.
 *
 * ── One unit a pass ──────────────────────────────────────────────────────
 *
 * The step runs ONE delegated pass and asks the machine to continue, so every
 * pass is one reservation, one provider exchange and one recorded spend, and
 * the org's monthly ceiling binds a scaffold exactly as it binds a chat turn.
 * Credits running out mid-scaffold is therefore the machine's own park: the
 * job waits as `needs_input` with the meter's words, and the beat resumes it
 * where it stopped once the workspace's standing has changed. A pass needs the
 * time its unit's own step needs (`aiSiteJobRunMinimumMs`), so the beat starts
 * a palette change only with a palette change's time left.
 *
 * Where it stopped is read from the job's OUTPUTS rather than kept anywhere:
 * each unit reports exactly one output when it completes, so the units
 * already represented there are the ones already built. A pass interrupted
 * between its work and its record repeats a unit that then finds its own
 * draft and reports it, which is what every step's draft id already gives.
 *
 * ── Never published ──────────────────────────────────────────────────────
 *
 * Nothing here publishes, routes or sends: each delegated step writes the
 * unpublished draft it already wrote for a job of its own kind, and the
 * palette and navigation travel as proposals a member applies.
 *
 * ── The page job builds its creations the same way (AGL-3031) ────────────
 *
 * A page job whose plan creates a layout, forms or components builds them
 * before its page through this same machinery: the units a creation implies
 * (`aiCreationUnit`), where the job stands read from its outputs
 * (`aiSitePendingUnits`), one delegated pass a unit (`aiRunJobUnit`), and the
 * `new:<name>` references resolved to what was built (`aiSiteBuiltRefs`,
 * `aiSiteUnitJob`). There is one loop, and it is the machine's.
 */

/**
 * What a scaffold's units are, in the order it builds them; a component is a
 * page job's. A blog's first posts and a store's first products (AGL-3676)
 * are built after the layout and the form and before the pages, which are
 * told what they are.
 */
export type AiSiteUnitKind = 'theme' | 'layout' | 'form' | 'component' | 'posts' | 'products' | 'page' | 'email'

export interface AiSiteUnit {
  kind: AiSiteUnitKind
  /** The job kind whose registered runner builds it. */
  jobKind: AiJobKind
  /** The resource the unit reports when it completes. */
  resource: AiJobOutputResource
  /** Stable within the job: what the unit's derived job and draft are addressed by. */
  slot: string
  /** The plan screen a page unit builds. */
  screen?: AiBuildPlanScreen
  /** The creation a theme, layout or form unit builds. */
  creation?: AiBuildPlanCreate
  /** What the unit is, for the derived job's brief. */
  label: string
}

/** The job kind and output resource each unit is built through. */
const UNIT_KINDS: Record<
  AiSiteUnitKind,
  { jobKind: AiJobKind; resource: AiJobOutputResource }
> = {
  theme: { jobKind: 'theme', resource: 'theme' },
  layout: { jobKind: 'layout', resource: 'layout' },
  form: { jobKind: 'form', resource: 'form' },
  component: { jobKind: 'component', resource: 'reusableComponent' },
  page: { jobKind: 'page', resource: 'screen' },
  email: { jobKind: 'email', resource: 'emailScreen' },
  // The scaffold's own runner writes them (`ai-job-site-content.ts`); the
  // posts' job kind is the one whose derived job a post's brief is, and the
  // products' the step that proposes the catalog they are written from.
  posts: { jobKind: 'text', resource: 'entry' },
  products: { jobKind: 'products', resource: 'product' },
}

/** The unit kind a creation is built as, where a unit builds it. */
const CREATION_UNIT_KINDS: Partial<Record<AiBuildPlanCreateKind, AiSiteUnitKind>> = {
  'theme-change': 'theme',
  layout: 'layout',
  form: 'form',
  component: 'component',
}

/**
 * The unit one creation is built as, under the slot its derived job and draft
 * are addressed by; `null` for a creation no unit builds.
 */
export function aiCreationUnit(creation: AiBuildPlanCreate, slot: string): AiSiteUnit | null {
  const kind = CREATION_UNIT_KINDS[creation.kind]
  if (!kind) return null
  return { kind, ...UNIT_KINDS[kind], slot, creation, label: creation.name }
}

/** The creation kinds a unit is built from, by unit kind. */
const CREATION_UNITS: Array<{
  unit: AiSiteUnitKind
  create: AiBuildPlanCreateKind
}> = [
  { unit: 'theme', create: 'theme-change' },
  { unit: 'layout', create: 'layout' },
  { unit: 'form', create: 'form' },
]

/** What the look's unit is called on the ledger. */
export const AI_SITE_LOOK_LABEL = 'Your look'

export const AI_SITE_NO_PLAN_COPY =
  'This site job has no confirmed plan to build.'

/** What a scaffold answers where the step that builds a page is not loaded. */
export const AI_SITE_NO_PAGE_STEP_COPY =
  'Building a whole site is not available yet.'

/** A unit that finished without reporting what it built; the scaffold cannot go on. */
export const AI_SITE_UNIT_EMPTY_COPY =
  'Part of this site could not be built. Try the site brief again.'

/**
 * The most passes a scaffold's step may take: the largest plan it admits —
 * eight pages of eight sections, its three creations, a blog's first posts
 * (one a pass, the largest part) and a welcome email — with nothing to
 * spare, so a runner that never finishes is still bounded while a real site
 * is not.
 */
export const AI_SITE_MAX_PASSES =
  AI_SITE_PAGES.max * (AI_SITE_MAX_SECTIONS + 1) + CREATION_UNITS.length + AI_SITE_POSTS + 1

/**
 * The units a plan implies, in build order: the palette first, because a
 * member reads it while the pages are still building; then the layout every
 * page renders inside and the form they place, because a page binds both by
 * id and so needs them to exist; then the pages; then the welcome email,
 * which is about the site rather than part of it.
 */
export function aiSiteJobUnits(
  plan: Pick<AiJobPlan, 'create' | 'screens'>,
  options: { welcomeEmail?: boolean; content?: 'posts' | 'products' | null } = {},
): AiSiteUnit[] {
  // The site's look is designed first, on every scaffold (AGL-3660): the
  // header, the footer and every page render in it from their first draft.
  // A theme change the plan names is that same unit, never a second one.
  const units: AiSiteUnit[] = [
    { kind: 'theme', ...UNIT_KINDS.theme, slot: 't', label: AI_SITE_LOOK_LABEL },
  ]
  for (const { unit, create } of CREATION_UNITS) {
    if (unit === 'theme') continue
    const creation = plan.create.find((entry) => entry.kind === create)
    if (!creation) continue
    units.push({
      kind: unit,
      ...UNIT_KINDS[unit],
      slot: unit[0],
      creation,
      label: creation.name,
    })
  }
  // A paid blog's first posts and a paid store's first products (AGL-3676).
  if (options.content === 'posts') {
    units.push({ kind: 'posts', ...UNIT_KINDS.posts, slot: 'posts', label: AI_SITE_POSTS_LABEL })
  } else if (options.content === 'products') {
    units.push({ kind: 'products', ...UNIT_KINDS.products, slot: 'products', label: AI_SITE_PRODUCTS_LABEL })
  }
  plan.screens.forEach((screen, index) => {
    units.push({
      kind: 'page',
      ...UNIT_KINDS.page,
      slot: `p${index}`,
      screen,
      label: screen.title,
    })
  })
  if (options.welcomeEmail) {
    units.push({
      kind: 'email',
      ...UNIT_KINDS.email,
      slot: 'e',
      label: 'Welcome email',
    })
  }
  return units
}

/**
 * The units a scaffold still owes after the outputs recorded so far. Each
 * unit reports one output of its own resource when it completes, so the
 * outputs already recorded are consumed against the units in build order.
 */
export function aiSitePendingUnits(
  units: readonly AiSiteUnit[],
  outputs: readonly Pick<AiJobOutput, 'resource'>[],
): AiSiteUnit[] {
  const done = new Map<AiJobOutputResource, number>()
  for (const output of outputs) {
    done.set(output.resource, (done.get(output.resource) ?? 0) + 1)
  }
  return units.filter((unit) => {
    const left = done.get(unit.resource) ?? 0
    if (left <= 0) return true
    done.set(unit.resource, left - 1)
    return false
  })
}

/**
 * The site's own search listing as the scaffold reports it (AGL-2918), or
 * nothing when the job already reported one or its inputs describe no site.
 *
 * It costs nothing and asks no model: the values are arithmetic on the
 * answers (`aiSiteSeoProposal`), so they ride out on the first pass that
 * builds anything rather than waiting for a pass of their own. Its resource
 * is `seo`, which no unit reports, so it cannot be mistaken for a unit's
 * output by `aiSitePendingUnits` and cannot move where the scaffold thinks
 * it is.
 */
export function aiSiteSeoOutputs(job: AiJob): AiJobOutput[] {
  const outputs = job.outputs ?? []
  if (outputs.some((output) => output.resource === 'seo' && output.id === AI_SITE_SEO_OUTPUT_ID)) {
    return []
  }
  const proposal = aiSiteSeoProposalForInputs(job.inputs)
  if (!proposal) return []
  return [
    {
      resource: 'seo',
      id: AI_SITE_SEO_OUTPUT_ID,
      hostId: job.hostId ?? null,
      label: 'The site’s search title and description',
      proposal: proposal as unknown as Record<string, unknown>,
    },
  ]
}

/** A record an earlier unit created, as a later one references it. */
export interface AiSiteBuiltRef {
  id: string
  label: string
  /** Only what becomes a record a page can name; a palette change is not one. */
  kind: 'layout' | 'form' | 'component'
}

/**
 * What the scaffold has already created, as the plan's `new:<name>`
 * references resolve to: the id of the record each completed creation wrote.
 * A page unit is told about the layout and the form by id, exactly as a page
 * job is told about records the site already had.
 */
export function aiSiteBuiltRefs(
  units: readonly AiSiteUnit[],
  outputs: readonly Pick<AiJobOutput, 'resource' | 'id' | 'label'>[],
): Map<string, AiSiteBuiltRef> {
  const byResource = new Map<
    AiJobOutputResource,
    Array<Pick<AiJobOutput, 'id' | 'label'>>
  >()
  for (const output of outputs) {
    const rows = byResource.get(output.resource) ?? []
    rows.push(output)
    byResource.set(output.resource, rows)
  }
  const built = new Map<string, AiSiteBuiltRef>()
  for (const unit of units) {
    const rows = byResource.get(unit.resource)
    const row = rows?.shift()
    if (!row || !unit.creation) continue
    // A theme change is a proposal with no record to reference; a layout, a
    // form and a component become ids a page can name.
    if (
      unit.creation.kind !== 'layout' &&
      unit.creation.kind !== 'form' &&
      unit.creation.kind !== 'component'
    ) {
      continue
    }
    built.set(unit.creation.name.toLowerCase(), {
      id: row.id,
      label: row.label || unit.creation.name,
      kind: unit.creation.kind,
    })
  }
  return built
}

type BuiltRefs = ReturnType<typeof aiSiteBuiltRefs>

/** The layout the scaffold built, when it built one. */
function aiSiteBuiltLayoutId(built: BuiltRefs): string | null {
  for (const entry of built.values()) if (entry.kind === 'layout') return entry.id
  return null
}

/** A plan reference as the unit's own job reads it: an id the site now has, or nothing. */
export function aiSiteResolvedRef(ref: string | null, built: BuiltRefs): string | null {
  if (!ref) return null
  if (!isAiPlanNewRef(ref)) return ref
  return (
    built.get(
      ref
        .slice(ref.indexOf(':') + 1)
        .trim()
        .toLowerCase(),
    )?.id ?? null
  )
}

/**
 * The site's own words, as every unit's brief carries them.
 *
 * The audience is here rather than left to the brief's prose (AGL-2918). A
 * guided start writes it into the brief itself, but an agency batch's brief
 * is a member's own sentence and may never mention it, and a theme, a layout
 * or a form asked to serve nobody in particular serves nobody in particular.
 *
 * The name is said twice (AGL-3596): as a field, and as the instruction to use
 * it as written. A layout told only "a dog groomer in Austin" put a business
 * name of its own in the header and the footer.
 */
export function aiSiteBriefLines(
  brief: string,
  inputs: AiSiteJobInputs,
): string[] {
  const lines = [brief.trim()]
  const site = [
    inputs.businessName ? `name: ${inputs.businessName}` : '',
    `business: ${inputs.businessType}`,
    inputs.audience ? `for: ${inputs.audience}` : '',
    inputs.city ? `city: ${inputs.city}` : '',
    inputs.brand ? `brand: ${inputs.brand}` : '',
  ].filter(Boolean)
  lines.push(`Site — ${site.join('; ')}.`)
  if (inputs.businessName) lines.push(aiSiteNameSentence(inputs.businessName))
  return lines
}

/**
 * What the welcome email is told (AGL-2918), beyond that it is a welcome
 * email.
 *
 * The scaffold's email unit used to carry one sentence, and a yes/no toggle
 * decided whether it ran — so the draft was a welcome email for a business
 * in general, to nobody in particular, about nothing that had happened. The
 * two answers it is missing are who wrote in and what now becomes of what
 * they wrote, and the second of those is the person's own routing answer, so
 * the email and the form it acknowledges cannot say different things.
 *
 * ⛔ A DRAFT either way. Nothing here sends, schedules or enrolls anybody:
 * the email step writes an unpublished email design and stops.
 */
export function aiSiteEmailBriefLines(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): string[] {
  const lines = [
    'Write the welcome email this site sends someone who gets in touch.',
  ]
  const { audience } = aiSiteWords(inputs)
  if (audience) lines.push(`Write it to ${audience}.`)
  const submissions = aiSiteSubmissions(inputs)
  if (submissions === 'lead') {
    lines.push('Their message is a sales lead, so say that somebody will be in touch about it.')
  } else if (submissions === 'inbox') {
    lines.push('Their message has been read, so say it arrived and that a reply is coming.')
  }
  return lines
}

/**
 * The id a unit's job is named by, and so the id its draft is written under
 * (AGL-3079): the id the plan entry it builds recorded, or for the welcome
 * email the id recorded on this job's step. A unit that writes no draft — a
 * palette change — and a unit whose plan recorded no id are named by this
 * job's id and the unit's slot, the name every draft of such a plan has.
 */
export function aiSiteUnitJobId(job: Pick<AiJob, '$id' | 'steps'>, unit: AiSiteUnit): string {
  const recorded =
    unit.creation?.id ?? unit.screen?.id ?? (unit.kind === 'email' ? aiRecordedJobDraftId(job, 'email') : null)
  return recorded || `${job.$id}-${unit.slot}`
}

/**
 * The job a unit is built under: this job's org, site, creator and model,
 * the kind that owns the unit, and a plan narrowed to the unit alone.
 *
 * The derived job carries NO steps and NO outputs of the scaffold's: a page
 * job's step reads its own draft and its own plan, and what the other units
 * produced is not its business. Its `$id` is the id the unit's draft is
 * written under (`aiSiteUnitJobId`), which is what a step with no id of its
 * own recorded names its draft by, so a unit re-run after its write finds its
 * own draft rather than writing a second.
 *
 * A creation unit reuses what the plan reuses less what the plan's screens
 * place themselves (AGL-3031): a component a page's section places is the
 * page's to place, and a layout or a card told to place it would be refused
 * for leaving it out.
 */
export function aiSiteUnitJob(
  job: AiJob,
  unit: AiSiteUnit,
  built: BuiltRefs,
): AiJob {
  const plan = job.plan as AiJobPlan
  const labels = { ...(plan.labels ?? {}) }
  for (const entry of built.values()) labels[entry.id] = entry.label
  const inputs = parseAiSiteJobInputs(job.inputs)
  const brief =
    typeof inputs === 'string'
      ? [job.brief]
      : aiSiteBriefLines(job.brief, inputs)
  const unitPlan: AiJobPlan = {
    ...plan,
    labels,
    reuse: [...plan.reuse],
    create: [],
    screens: [],
  }
  if (unit.creation) {
    const placedByScreens = new Set(
      plan.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses)),
    )
    unitPlan.reuse = plan.reuse.filter((entry) => !placedByScreens.has(entry.id))
    unitPlan.create = [
      {
        ...unit.creation,
        duplicateOf: aiSiteResolvedRef(unit.creation.duplicateOf, built),
      },
    ]
    brief.push(
      `Build the ${unit.creation.kind} “${unit.creation.name}”: ${unit.creation.why}`,
    )
  }
  if (unit.screen) {
    const screen = unit.screen
    // Everything the scaffold has already built is a record the site has, so
    // the page is planned against it the way a page job is planned against
    // what the site always had.
    for (const entry of built.values()) {
      unitPlan.reuse.push({
        kind: entry.kind,
        id: entry.id,
        purpose: `the ${entry.kind} this site’s pages are built on`,
      })
    }
    unitPlan.screens = [
      {
        ...screen,
        // A page the plan named no layout for renders inside the one the
        // scaffold built (AGL-3596); the page step falls back to the site's.
        layout: aiSiteResolvedRef(screen.layout, built) ?? aiSiteBuiltLayoutId(built),
        template: aiSiteResolvedRef(screen.template, built),
        // A scaffold GENERATES every page from its plan (AGL-3596). A page
        // copied from one the site has is not built: a plan that named the
        // starter home page as its home's start produced the starter again,
        // byte for byte, reported as written. A page job keeps rule 15.
        duplicateOf: job.kind === 'site' ? null : aiSiteResolvedRef(screen.duplicateOf, built),
        // A dataset the plan creates and the site has not built yet keeps its
        // name, which the page's draft still binds by (AGL-3475).
        record: screen.record
          ? {
              ...screen.record,
              dataset: aiSiteResolvedRef(screen.record.dataset, built) ?? screen.record.dataset,
            }
          : null,
        sections: screen.sections.map((section) => ({
          ...section,
          uses: section.uses
            .map((ref) => aiSiteResolvedRef(ref, built))
            .filter((ref): ref is string => !!ref),
        })),
      },
    ]
    brief.push(
      `Build the page “${screen.title}” of this site, at ${screen.slug}.`,
    )
    // What the blog's posts or the store's products are, once built (AGL-3676).
    if (job.kind === 'site') brief.push(...aiSiteContentBriefLines(job.outputs ?? []))
  }
  if (unit.kind === 'products') brief.push(aiSiteProductsBriefLine())
  if (unit.kind === 'email') {
    brief.push(...aiSiteEmailBriefLines(job.inputs))
  }
  // The job the member started travels with every unit, so what the unit
  // writes names it (AGL-3596).
  const unitInputs: Record<string, unknown> = { ...job.inputs, originJobId: aiOriginJobId(job) }
  // The layout is built before the pages, so it is told them (AGL-3596): their
  // ids are minted on the plan, and the platform writes the header's links.
  // A page is told them too, so its buttons may go to a page built after it.
  if (job.kind === 'site' && (unit.kind === 'layout' || unit.kind === 'page')) {
    // A guided start links every page the person asked for (AGL-3660), and
    // the blog its first posts are written into, by its path, second after
    // Home (AGL-3676): the live Slow Roads start linked an "Articles" page
    // and never the blog.
    const planned = aiLayoutSitePagesOfPlan(plan.screens, { guided: true })
    const blog = aiSiteWritesPosts(job) ? [aiSiteBlogNavPage(plan.screens)] : []
    const homes = planned.filter((page) => aiLayoutIsHomeSlug(page.slug))
    const pages = [...homes, ...blog, ...planned.filter((page) => !aiLayoutIsHomeSlug(page.slug))].slice(
      0,
      AI_LAYOUT_SITE_PAGES_MAX,
    )
    if (pages.length) unitInputs[AI_LAYOUT_SITE_PAGES_INPUT] = pages
  }
  // A site's pages and its layout are designed in the layout language and
  // compiled (AGL-3660), and a page is told which page places the site's form.
  if (unit.kind === 'layout' || unit.kind === 'page') {
    // The look designed first (AGL-3660): its header arrangement and band rhythm.
    const look = (job.outputs ?? []).find((output) => output.resource === 'theme' && output.id === 'look')
    const style = look?.proposal?.['style'] as Record<string, unknown> | undefined
    if (style) unitInputs['siteStyle'] = { headerAlign: style['headerAlign'], rhythm: style['rhythm'] }
    unitInputs[AI_LAYOUT_LANGUAGE_INPUT] = true
    const formPage = aiLayoutFormPageOfPlan(plan)
    if (formPage) unitInputs[AI_LAYOUT_FORM_PAGE_INPUT] = formPage
  }
  if (unit.kind === 'posts') {
    // The posts already written (one a pass), the addresses the site's own
    // pages answer at, and the byline the person gave (AGL-3676).
    const posts: AiSitePostsInput = {
      written: (job.outputs ?? [])
        .filter((output) => output.resource === 'entry')
        .map((output) => ({ id: output.id, title: output.label })),
      total: AI_SITE_POSTS,
      avoidSlugs: plan.screens.map((screen) => screen.slug.replace(/^\/+/, '').split('/')[0]).filter(Boolean),
      byline: typeof inputs === 'string' ? '' : (inputs.businessName ?? ''),
    }
    unitInputs[AI_SITE_CONTENT_INPUT] = posts
  }
  if (unit.kind === 'products') unitInputs['target'] = 'catalog'
  return {
    ...job,
    $id: aiSiteUnitJobId(job, unit),
    kind: unit.jobKind,
    steps: [],
    outputs: [],
    plan: unitPlan,
    inputs:
      // A theme change on a site with no theme of its own is a new palette.
      unit.kind === 'theme'
        ? { ...unitInputs, mode: 'create' }
        : // The email step reads the kind off the inputs it is handed, so a
          // job the scaffold composed says which kind it is exactly as a
          // member's own does.
          unit.kind === 'email'
          ? { ...unitInputs, emailType: AI_SITE_EMAIL_TYPE }
          : unitInputs,
    brief: brief.join('\n').slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/**
 * Whether this site start writes its first posts (AGL-3676): its ledger owes
 * the posts part and has not given up on it. The ledger is written before the
 * layout is built, so the header knows the blog before it exists.
 */
export function aiSiteWritesPosts(job: Pick<AiJob, 'items'>): boolean {
  return (job.items ?? []).some((row) => row.slot === 'posts' && row.status !== 'skipped' && row.status !== 'failed')
}

/**
 * A scaffold is admitted with inputs that read, for a site of the job's own
 * org, and only where this deployment has loaded the step that builds a page:
 * a scaffold whose pages nothing can build is not a scaffold.
 */
export const aiSiteJobAdmission: AiJobAdmission = async (context) => {
  const inputs = parseAiSiteJobInputs(context.inputs)
  if (typeof inputs === 'string') return { status: 400, error: inputs }
  // The workspace's own page band (AGL-3594): one or two pages on the Free
  // taste, four to eight on a paid plan.
  const freeTaste = aiSiteFreeTaste(context.org)
  const pages = aiSitePagesRefusal(inputs.pages, freeTaste)
  if (pages) return { status: 400, error: pages }
  if (context.plan) {
    const shape = aiSitePlanRefusal(context.plan, { freeTaste })
    if (shape) return { status: 400, error: shape }
  }
  if (!context.hostId) {
    return {
      status: 400,
      error: 'Open the site the scaffold is for before starting the job',
    }
  }
  const owner = await resolveOrgIdForHost(context.hostId)
  if (!owner || owner !== context.orgId)
    return { status: 404, error: 'Unknown site' }
  if (!aiJobStepRunnerFor('page')) {
    return { status: 400, error: AI_SITE_NO_PAGE_STEP_COPY }
  }
  return null
}

/** Whether a scaffold's workspace spends the Free taste (AGL-3594); a missing org reads as paid, as the band has always been. */
export function aiSiteFreeTaste(org: object | null | undefined): boolean {
  return Boolean(org) && resolveEffectivePlan(org as never) === 'free'
}

/**
 * Whether a scaffold drafts its welcome email (AGL-3594): where it was asked
 * for, and never on the Free taste, whose credits its pages need.
 */
export function aiSiteWelcomeEmail(inputs: AiSiteJobInputs, freeTaste: boolean): boolean {
  return inputs.welcomeEmail && !freeTaste
}

/** What one delegated pass came to: the unit's spend as the job records it, and whether the unit is built. */
export interface AiJobUnitPass {
  outcome: AiJobStepOutcome
  /** The unit reported what it built and asked for no pass of its own. */
  built: boolean
}

/**
 * One delegated pass (AGL-2911, AGL-3031): the unit handed to the runner of
 * the kind that owns it, under the job derived for it, and its outcome as the
 * delegating job records it. A delegate proposes a plan for its own job,
 * which does not exist, so no plan is carried back. A unit that stopped for a
 * person, refused or failed is the delegating job's stop; a unit that asked
 * for another pass keeps its turn; and a unit that finished without reporting
 * what it built fails with `emptyCopy`, since another pass would ask the same
 * thing again. The tokens it spent are on the bill either way.
 */
export async function aiRunJobUnit(
  context: AiJobStepContext,
  input: {
    unit: AiSiteUnit
    units: readonly AiSiteUnit[]
    runner: AiJobStepRunner
    emptyCopy: string
  },
): Promise<AiJobUnitPass> {
  const { job } = context
  const outputs = job.outputs ?? []
  const outcome = await input.runner({
    ...context,
    job: aiSiteUnitJob(job, input.unit, aiSiteBuiltRefs(input.units, outputs)),
  })
  const spent: AiJobStepOutcome = {
    outputs: outcome.outputs,
    usage: outcome.usage,
    estCostUsd: outcome.estCostUsd,
    model: outcome.model,
    stopReason: outcome.stopReason,
    ...(outcome.effort ? { effort: outcome.effort } : {}),
    ...(outcome.refused ? { refused: true } : {}),
    ...(outcome.failure ? { failure: outcome.failure } : {}),
    ...(outcome.review ? { review: outcome.review } : {}),
  }
  if (spent.review || spent.refused || spent.failure) return { outcome: spent, built: false }
  if (outcome.continue) return { outcome: { ...spent, continue: true }, built: false }
  if (!outcome.outputs.length) return { outcome: { ...spent, failure: input.emptyCopy }, built: false }
  return { outcome: spent, built: true }
}

export interface AiJobSiteStepDeps {
  /** The runner registry; specs hand in a fake for a kind they drive. */
  runnerFor?: typeof aiJobStepRunnerFor
  /** The draft reader a built page is checked through; specs hand in a fake. */
  readNodes?: typeof readAiDraftNodes
  /** The guided start's publish; specs hand in a fake. */
  publish?: typeof aiPublishGuidedSite
  /** The look's pass (AGL-3660); specs hand in a fake. */
  look?: (context: AiJobStepContext, job: AiJob) => Promise<AiJobStepOutcome>
  /** The first posts' and first products' passes (AGL-3676); specs hand in fakes. */
  posts?: AiJobStepRunner
  products?: AiJobStepRunner
  /** Whether a part may be built for this member, before its first pass. */
  contentRefusal?: typeof aiSiteContentRefusal
  /** The posts' publish once the pages are live, and the cache drop after it. */
  publishPosts?: typeof aiPublishSitePosts
  dropCache?: typeof dropPluginSiteCache
}

/** A page the scaffold reported built that holds none of its plan's sections. */
export const AI_SITE_PAGE_NOT_WRITTEN_COPY =
  'A page of this site was not written from its plan. Try the site brief again.'

/**
 * Whether a page unit's draft holds every section its plan named, under the
 * ids the page step writes them by (AGL-3596). A page counts as written only
 * then: a run that reported a page and wrote none of its sections — a copy of
 * a page the site already had, byte for byte — is not a page the job built,
 * and is never reported done.
 */
export async function aiSitePageWritten(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; unitJobId: string; screen: AiBuildPlanScreen; draftId: string },
  readNodes: typeof readAiDraftNodes = readAiDraftNodes,
): Promise<boolean> {
  if (!input.screen.sections.length) return false
  const stored = await readNodes(firestore, { kind: 'screen', hostId: input.hostId, id: input.draftId })
  if (!stored) return false
  return input.screen.sections.every((_, index) => aiPageSectionNodeId(input.unitJobId, index) in stored.nodes)
}

/**
 * A scaffold's units as a build's (AGL-3616): the same slots, each unit's
 * kind as its operation, and every page built after the layout and the form
 * it renders inside and places. What the build's ledger, degradation and
 * Try again read, so a site is settled item by item exactly as a build is.
 */
export function aiSiteLedgerUnits(units: readonly AiSiteUnit[]): AiBuildUnit[] {
  const creations = units.filter((unit) => unit.kind === 'layout' || unit.kind === 'form').map((unit) => unit.slot)
  return units.map((unit) => ({
    slot: unit.slot,
    op: unit.kind === 'theme' || unit.kind === 'posts' || unit.kind === 'products' ? unit.kind : unit.jobKind,
    label: unit.label,
    ...(unit.creation ? { creation: unit.creation } : {}),
    ...(unit.screen ? { screen: unit.screen } : {}),
    deps: unit.kind === 'page' ? creations : [],
  }))
}

/**
 * A scaffold's ledger to start from (AGL-3616): every unit pending, except
 * the units a job already running when the ledger arrived had built, read
 * off its outputs as the scaffold always read them, which stand as built.
 */
export function aiSiteInitialLedger(
  units: readonly AiSiteUnit[],
  outputs: readonly AiJobOutput[],
): AiJobItemLedger[] {
  const pending = new Set(aiSitePendingUnits(units, outputs).map((unit) => unit.slot))
  const byResource = new Map<AiJobOutputResource, string[]>()
  for (const output of outputs) byResource.set(output.resource, [...(byResource.get(output.resource) ?? []), output.id])
  return aiBuildInitialLedger(aiSiteLedgerUnits(units)).map((row, index) => {
    const unit = units[index]
    if (pending.has(unit.slot)) return row
    const id = byResource.get(unit.resource)?.shift()
    return { ...row, status: 'succeeded', outputs: id ? [id] : [] }
  })
}

/** The units a scaffold owes on this job: what its plan implies that this deployment can build. */
function aiSiteOwedUnits(
  job: AiJob,
  plan: AiJobPlan,
  inputs: AiSiteJobInputs,
  freeTaste: boolean,
  runnerFor: typeof aiJobStepRunnerFor,
): AiSiteUnit[] {
  return aiSiteJobUnits(plan, {
    welcomeEmail: aiSiteWelcomeEmail(inputs, freeTaste),
    content: aiSiteContentPart(job.inputs, freeTaste),
  }).filter((unit) => unit.kind === 'theme' || unit.kind === 'posts' || runnerFor(unit.jobKind))
}

export function createAiJobSiteStep(
  deps: AiJobSiteStepDeps = {},
): AiJobStepRunner {
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  const readNodes = deps.readNodes ?? readAiDraftNodes
  const publish = deps.publish ?? aiPublishGuidedSite
  const look = deps.look ?? aiRunSiteLook
  const contentRefusal = deps.contentRefusal ?? aiSiteContentRefusal
  const publishPosts = deps.publishPosts ?? aiPublishSitePosts
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  return async (context): Promise<AiJobStepOutcome> => {
    const { job } = context
    // The scaffold asks no model of its own. What it names where it spends
    // nothing is the model its plan ran on, which is the one exchange this
    // job has already had of its own.
    const model = context.modelFor?.('job.plan') ?? aiModelForStep('job.plan')
    const plan = aiConfirmedPlan(job)
    if (!plan)
      return { ...aiUnspentOutcome(model), failure: AI_SITE_NO_PLAN_COPY }
    // The resume door refuses such a plan at confirmation once it can read
    // one; a plan confirmed before a site changed still stops here, unspent.
    const freeTaste = aiSiteFreeTaste(context.org)
    const refusal = aiSitePlanRefusal(plan, { freeTaste })
    if (refusal) return { ...aiUnspentOutcome(model), failure: refusal }
    const inputs = parseAiSiteJobInputs(job.inputs)
    if (typeof inputs === 'string')
      return { ...aiUnspentOutcome(model), failure: inputs }

    // A kind this deployment has not loaded is not among the units at all, so
    // a scaffold owes only what something can build.
    const units = aiSiteOwedUnits(job, plan, inputs, freeTaste, runnerFor)
    const ledgerUnits = aiSiteLedgerUnits(units)
    // Settled item by item, like a build (AGL-3616): the ledger, not the
    // outputs, says where the scaffold stands once it has one.
    const starting = !job.items?.length
    const ledger = starting ? aiSiteInitialLedger(units, job.outputs ?? []) : (job.items as AiJobItemLedger[])
    const init = starting ? { items: ledger } : {}
    const rows = new Map(ledger.map((row) => [row.slot, row]))
    const next = aiBuildNextUnit(ledgerUnits, ledger)

    /** A guided start's last pass puts what it built on the site, once (AGL-3596): only its pages that were built. */
    const finish = async (outcome: AiJobStepOutcome, pages: readonly AiJobOutput[]): Promise<AiJobStepOutcome> => {
      if (!aiJobPublishesSite(job) || job.sitePublish || !job.hostId || !pages.length) return outcome
      // A blog the header links by path before its posts exist (AGL-3660):
      // owed and not delivered, its links come out of what is published.
      const postsRow = rows.get('posts')
      const sitePublish = await publish(context.firestore, {
        job,
        outputs: pages,
        now: context.now,
        ...(postsRow ? { blogUnwritten: !aiBuildItemDelivered(postsRow) || !postsRow.outputs?.length } : {}),
      }).catch((error: unknown) => {
        // The site is built either way; the pages stay drafts and say so.
        console.error('ai site publish threw', { orgId: job.orgId, jobId: job.$id, error })
        return null
      })
      if (sitePublish?.published.length) await finishPosts()
      return sitePublish ? { ...outcome, sitePublish } : outcome
    }
    /** The blog's posts go live with its pages (AGL-3676), as a person's Publish would put them. */
    const finishPosts = async () => {
      const row = rows.get('posts')
      if (!row || !aiBuildItemDelivered(row) || !job.hostId) return
      const ids = new Set(row.outputs)
      const posts = (job.outputs ?? []).filter((output) => output.resource === 'entry' && ids.has(output.id))
      const published = await publishPosts(context.firestore, { job, outputs: posts, now: context.now })
      if (!published?.paths.length) return
      await dropCache({
        hostIds: [job.hostId],
        reason: 'guided AI site start published its posts',
        paths: { [job.hostId]: published.paths },
      }).catch((error: unknown) => console.warn('ai site posts: cache not dropped', { jobId: job.$id, error }))
    }
    /** The pages built so far, as the job reported them. */
    const builtPages = (extra: readonly AiJobOutput[] = []) => {
      const ids = new Set(
        units
          .filter((unit) => unit.kind === 'page' && aiBuildItemDelivered(rows.get(unit.slot) ?? { status: 'pending' }))
          .flatMap((unit) => rows.get(unit.slot)?.outputs ?? []),
      )
      return [...(job.outputs ?? []).filter((output) => output.resource === 'screen' && ids.has(output.id)), ...extra]
    }

    if (!next) return finish({ ...aiUnspentOutcome(model), ...init }, builtPages())
    const unit = units.find((one) => one.slot === next.slot) as AiSiteUnit
    // The look is the scaffold's own pass (AGL-3660), not the theme job's proposal.
    const catalog = unit.kind === 'products' ? runnerFor('products') : undefined
    const runner: AiJobStepRunner | undefined =
      unit.kind === 'theme'
        ? (lookContext) => look(lookContext, lookContext.job)
        : unit.kind === 'posts'
          ? (deps.posts ?? runAiSitePostsUnit)
          : unit.kind === 'products'
            ? (deps.products ?? (catalog ? createAiSiteProductsRunner({ catalog }) : undefined))
            : runnerFor(unit.jobKind)
    if (!runner) return { ...aiUnspentOutcome(model), ...init }
    const othersOpen = ledgerUnits.some(
      (one) => one.slot !== unit.slot && aiBuildItemOpen(rows.get(one.slot) ?? { status: 'pending' }),
    )
    // The site's own listing rides out beside the first unit's output, once
    // (AGL-2918): it is derived from the answers rather than generated, so it
    // is ready before anything is built and costs the pass nothing.
    const listing = aiSiteSeoOutputs(job)
    const settle = (item: AiJobItemOutcome, spent: AiJobStepOutcome = aiUnspentOutcome(model)): AiJobStepOutcome => ({
      ...spent,
      outputs: [...listing, ...spent.outputs],
      ...init,
      item,
      ...(item.status === 'running' || othersOpen ? { continue: true } : {}),
    })

    // A blog's posts and a store's products ask, before their first pass,
    // whether this member may have them here (AGL-3676): a refusal spends
    // nothing, and the row says why, as a build's item does.
    if ((unit.kind === 'posts' || unit.kind === 'products') && rows.get(unit.slot)?.status !== 'running') {
      const refusal = await contentRefusal(unit.kind, { ...context, job }).catch((error: unknown) => {
        console.error('ai site part admission failed', { orgId: job.orgId, jobId: job.$id, slot: unit.slot, error })
        return AI_SITE_UNIT_EMPTY_COPY
      })
      if (refusal) return settle({ slot: unit.slot, status: 'skipped', note: `Not built: ${refusal}` })
    }

    // A page whose layout or form failed is built without it, and says so.
    const degradation = aiBuildDegradation(next, { units: ledgerUnits, ledger })
    const degraded = degradation.degradedBy.length > 0
    const note = degradation.notes.length ? degradation.notes.join(' ') : null
    const built = aiBuildBuiltRefs(ledgerUnits, ledger, job.outputs ?? [])
    const derived = aiSiteUnitJob(job, unit, built)
    const handed: AiJob = degradation.briefLines.length
      ? { ...derived, brief: [derived.brief, ...degradation.briefLines].join('\n').slice(0, AI_JOB_BRIEF_MAX_CHARS) }
      : derived

    let outcome: AiJobStepOutcome
    try {
      outcome = await runner({ ...context, job: handed })
    } catch (error) {
      if (aiUnitErrorRetryable(error)) throw error
      console.error('ai site unit threw', { orgId: job.orgId, jobId: job.$id, slot: unit.slot, error })
      return settle({ slot: unit.slot, status: 'failed', failure: { ours: true, reason: 'provider', message: AI_SITE_UNIT_EMPTY_COPY } })
    }
    const spent = aiUnitSpend(outcome)
    const stopped = aiUnitFailure(unit.slot, outcome)
    if (stopped) {
      return settle(
        stopped.status === 'failed' && stopped.failure && !outcome.failure && !outcome.refused && !outcome.review
          ? { ...stopped, failure: { ...stopped.failure, message: AI_SITE_UNIT_EMPTY_COPY } }
          : stopped,
        spent,
      )
    }
    // A page counts as built only when its plan's sections are in it
    // (AGL-3596): otherwise the page fails, on our side, and is not reported.
    if (unit.kind === 'page' && unit.screen && job.hostId) {
      const page = outcome.outputs.find((output) => output.resource === 'screen')
      const written =
        page !== undefined &&
        (await aiSitePageWritten(
          context.firestore,
          { hostId: job.hostId, unitJobId: aiSiteUnitJobId(job, unit), screen: unit.screen, draftId: page.id },
          readNodes,
        ))
      if (!written) {
        return settle(
          { slot: unit.slot, status: 'failed', failure: { ours: true, reason: 'step-failure', message: AI_SITE_PAGE_NOT_WRITTEN_COPY } },
          { ...spent, outputs: spent.outputs.filter((output) => output.resource !== 'screen') },
        )
      }
    }
    const done = settle(
      {
        slot: unit.slot,
        status: degraded ? 'degraded' : 'succeeded',
        outputs: outcome.outputs.map((output) => output.id),
        note,
        ...(degraded ? { degradedBy: degradation.degradedBy } : {}),
      },
      spent,
    )
    if (done.continue) return done
    rows.set(unit.slot, { ...(rows.get(unit.slot) as AiJobItemLedger), status: degraded ? 'degraded' : 'succeeded' })
    return finish(done, builtPages(unit.kind === 'page' ? outcome.outputs.filter((output) => output.resource === 'screen') : []))
  }
}

export const runAiJobSiteStep = createAiJobSiteStep()

/**
 * The least time a scaffold's next pass needs (AGL-3035). The scaffold asks no
 * model itself: each pass hands one unit to the step registered for its kind,
 * under the job derived for it, so it needs what that step registers for that
 * job — a palette change's or a layout's time for those units, a page pass's
 * for a page. A scaffold with nothing left to build, or with no plan it can
 * build, spends nothing, and a page pass's time covers it.
 */
export function aiSiteJobRunMinimumMs(job: AiJob): number {
  const plan = aiConfirmedPlan(job)
  const inputs = parseAiSiteJobInputs(job.inputs)
  if (!plan || typeof inputs === 'string') return AI_JOB_PAGE_STEP_MINIMUM_MS
  // The org is not read here, so a blog's or a store's part is counted as a
  // paid plan's; a ledger, once the job has one, says which units it owes.
  const owed = new Set((job.items ?? []).map((row) => row.slot))
  const units = aiSiteJobUnits(plan, {
    welcomeEmail: inputs.welcomeEmail,
    content: aiSiteContentPart(job.inputs, false),
  }).filter(
    (unit) =>
      (unit.kind === 'theme' || unit.kind === 'posts' || aiJobStepRunnerFor(unit.jobKind)) &&
      (!owed.size || owed.has(unit.slot)),
  )
  const outputs = job.outputs ?? []
  const ledger = job.items?.length ? job.items : aiSiteInitialLedger(units, outputs)
  const next = aiBuildNextUnit(aiSiteLedgerUnits(units), ledger)
  const unit = next ? units.find((one) => one.slot === next.slot) : undefined
  if (!unit) return AI_JOB_PAGE_STEP_MINIMUM_MS
  if (unit.kind === 'theme') return AI_SITE_LOOK_BUDGET.minimumMs
  if (unit.kind === 'posts') return AI_SITE_POST_BUDGET.minimumMs
  return aiJobStepRunMinimumMs(aiSiteUnitJob(job, unit, aiBuildBuiltRefs(aiSiteLedgerUnits(units), ledger, outputs)))
}

/**
 * Registers the site scaffold with the least time a pass needs — every
 * scaffold builds pages, and a page pass needs the least of any unit — and the
 * time its next pass needs, the passes a whole site's plan may take, and the
 * check a site job passes before it is created or resumed.
 */
export function registerAiSiteJob(): void {
  registerAiJobStep('site', runAiJobSiteStep, {
    minimumMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
    minimumMsFor: aiSiteJobRunMinimumMs,
  })
  registerAiJobStepPasses('site', AI_SITE_MAX_PASSES)
  registerAiJobAdmission('site', aiSiteJobAdmission)
}
