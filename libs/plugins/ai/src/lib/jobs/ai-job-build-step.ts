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

import { aiJobCancelAsked } from './ai-job-cancel'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { ResolvedBusinessProfile } from '@aglyn/aglyn/app-utils/business-profile'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import {
  AI_BUILD_LIMITS,
  AI_BUILD_MADE_INPUT,
  AI_BUILD_PUBLISH_INPUT,
  AI_BUILD_THEME_OP,
  aiArticle,
  aiBuildCreationNoun,
  aiBuildCreditRange,
  aiBuildDegradation,
  aiBuildInitialLedger,
  aiBuildItemArgRefs,
  aiBuildItemDelivered,
  aiBuildItemOpen,
  aiBuildNextUnit,
  aiBuildOrder,
  aiBuildItemOutputNote,
  aiBuildPlacedItemLines,
  AI_BUILD_NEEDS_INPUT_CODE,
  aiBuildPlanMissingInput,
  aiBuildPlanShapeRefusal,
  aiBuildRefName,
  aiBuildSmaller,
  aiBuildUnits,
  type AiBuildMade,
  type AiBuildOps,
  type AiBuildUnit,
} from '../model/ai-build-job'
import { isAiPlanNewRef, type AiBuildPlanCreateKind } from '../model/ai-build-plan'
import type {
  AiJob,
  AiJobItemFailure,
  AiJobItemLedger,
  AiJobKind,
  AiJobOutput,
  AiJobPlan,
} from '../model/ai-jobs.types'
import { AI_SITE_INPUT_MAX_CHARS, AI_SITE_MAX_SECTIONS } from '../model/ai-site-job'
import {
  AI_CREDITS_CONFIRM_CODE,
  aiCreditsPromptFor,
  aiCreditsPromptText,
  type AiCreditRange,
  type AiCreditsPrompt,
  type AiCreditsSmaller,
} from '../model/ai-credit-estimate'
import { aiFreeCreditsNoneLeftText, aiSiteWords } from '../model/ai-site-job'
import { readFreeAiCreditsLeft } from '../usage/free-ai-credits-left'
import { readAiSiteContext } from '../runtime/site-context'
import { aiModelForStep } from '../providers/routing'
import {
  AI_BUILD_UNIT_EMPTY_COPY,
  aiBuildBuiltRefs,
  aiUnitErrorRetryable,
  aiUnitFailure,
  aiUnitSpend,
} from './ai-build-unit-outcome'
import { aiBuildOps, type AiBuildOpsContext } from './ai-build-capabilities'
import {
  aiJobAdmissionRefusal,
  registerAiJobAdmission,
  type AiJobAdmission,
  type AiJobAdmissionContext,
  type AiJobAdmissionRefusal,
} from './ai-job-admission'
import { aiOriginJobId } from './ai-job-draft-ids'
import { readAiDraftNodes } from './ai-job-drafts'
import { aiConfirmedPlan, aiUnspentOutcome } from './ai-job-generation'
import { AI_JOB_PAGE_STEP_MINIMUM_MS } from './ai-job-page-budget'
import {
  aiPluginDraftAdmissionRefusal,
  aiPluginDraftWriter,
  type AiPluginDraftWriterLookup,
} from './ai-job-plugin-drafts'
import { aiSitePageWritten, aiSiteResolvedRef } from './ai-job-site-step'
import { AI_LAYOUT_SITE_PAGES_INPUT, aiLayoutSitePagesOfPlan } from './ai-job-layout-site-pages'
import {
  AI_LAYOUT_FORM_PAGE_INPUT,
  AI_LAYOUT_LANGUAGE_INPUT,
  AI_LAYOUT_SITE_MOTION_INPUT,
  aiJobUsesLayoutLanguage,
  aiLayoutFormPageOfPlan,
  aiLayoutSiteMotionOf,
  type AiLayoutSiteMotion,
} from './ai-job-page-language'
import { aiDatasetListingsOf } from './ai-job-site-datasets'
import { AI_SITE_EVENT_OP, aiEventsListings } from './ai-job-site-events'
import { AI_FORM_DATASET_MADE_INPUT } from './ai-job-form-dataset'
import { AI_LAYOUT_LISTINGS_INPUT } from '../layout-language/ai-layout-listings'
import {
  AI_BUILD_STORE_OP,
  AI_BUILD_STORE_PAGES_PRESENT_NOTE,
  aiBuildStoreLayoutLinks,
  aiBuildStoreLayoutOf,
  aiBuildStorePagesOf,
  aiBuildStorePagesStillMissing,
  type AiBuildStoreLinksState,
  type AiStoreSitePage,
} from '../model/ai-build-store-pages'
import type { AiStoreLayoutLinks } from '../model/ai-layout-store-links'
import { writeAiStoreLinksLayoutDraft } from './ai-job-store-links-layout'
import type { AiSitePublishStoreLinks } from './ai-site-publish'
import {
  AI_SITE_STORE_LINKS_INPUT,
  AI_SITE_STORE_PAGES_NOTE,
  aiStoreFrameLinks,
  aiStorePagesToWrite,
} from '../model/ai-site-store-pages'
import {
  AI_SITE_STORE_PAGES_INPUT,
  aiSiteStorePageId,
  aiSiteStorePagesRefusal,
  runAiSiteStorePagesUnit,
  type AiSiteStorePagesInput,
} from './ai-job-site-store-pages'
import {
  AI_JOB_BRIEF_MAX_CHARS,
  type AiJobItemOutcome,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import { aiJobPublishesBuild, aiMergeSitePublish, aiPublishGuidedSite } from './ai-site-publish'
import {
  AI_PLANNED_JOB_KINDS,
  aiJobStepRunMinimumMs,
  aiJobStepRunnerFor,
  registerAiJobStep,
  registerAiJobStepPasses,
} from './ai-jobs'

/**
 * The build step (AGL-3616): the generation step of a `build` job, run once
 * the member confirmed the plan their request produced.
 *
 * Like the site scaffold it generalizes, it builds nothing itself and asks no
 * model of its own. Each pass takes the next unit in dependency order and
 * hands it to what builds that kind of thing — a page, layout, form,
 * component, email design or template to this plugin's own step, under a job
 * derived for the unit; another plugin's resource to that plugin's writer on
 * the resource-draft seam, with the content the owner's capability derives
 * from the item's arguments. One unit, one pass, one recorded spend.
 *
 * ── Settled item by item ────────────────────────────────────────────────
 *
 * Where a unit stands is read from the job's ITEM LEDGER, never from counting
 * outputs: the machine writes each pass's row in the transaction that
 * records its spend (`recordStep`). A unit that fails is a FAILED ROW, not a
 * failed job: the pass reports it, the machine gives back that item's spend
 * where the failure was ours, and the next pass builds the next unit. What
 * depended on it is built without it, or skipped where it cannot stand
 * without it (`aiBuildDegradation`). The machine ends the job when nothing is
 * left: `done` when anything was delivered, `failed` — its planning given
 * back too — when nothing was.
 *
 * ── Drafts, unless asked and confirmed ───────────────────────────────────
 *
 * Every unit writes the draft its own kind writes, which nothing publishes.
 * Only a build whose request asked to publish AND whose member ticked the
 * plan card's box puts its built pages live, once, on its last pass, through
 * the guided start's publish.
 */

/** What a build answers with no confirmed plan to build. */
export const AI_BUILD_NO_PLAN_COPY = 'This build has no confirmed plan to build.'

/** What a unit says when nothing on this site builds its operation any more. */
export const aiBuildUnavailableCopy = (noun: string): string =>
  `Not built: ${aiArticle(noun)} cannot be made on this site right now.`


/** What a page that was reported built but holds none of its plan says. */
export const AI_BUILD_PAGE_NOT_WRITTEN_COPY = 'The page was not written from its plan.'


/**
 * The most passes a build's step may take: every unit at a page's worst — its
 * sections and its listing — so a runner that never finishes is still
 * bounded while the largest plan is not. Try again starts the count over.
 */
export const AI_BUILD_MAX_PASSES = AI_BUILD_LIMITS.units * (AI_SITE_MAX_SECTIONS + 1) + 1

/** The job kind a creation of the build is built by. */
const CREATION_JOB_KINDS: Partial<Record<AiBuildPlanCreateKind, AiJobKind>> = {
  layout: 'layout',
  form: 'form',
  component: 'component',
  email: 'email',
  // The theme operation's unit, where the plan named it as its creation (AGL-4077).
  'theme-change': 'theme',
}

/** The job kind a unit is built by, where an AI runner builds it. */
export function aiBuildUnitJobKind(unit: AiBuildUnit, ops: AiBuildOps): AiJobKind | null {
  if (unit.screen) return 'page'
  if (unit.creation) return CREATION_JOB_KINDS[unit.creation.kind] ?? null
  const runnerKind = ops.get(unit.op)?.runnerKind
  return runnerKind ? (runnerKind as AiJobKind) : null
}

/** What the job drawer says under an item another plugin's writer made (`model/ai-build-job.ts`). */
export { aiBuildItemOutputNote }

/**
 * An item's arguments without the list entries that link what this build
 * could not make (AGL-3832): a menu's `About => new:About` once the page
 * About failed. The item is built with the rest, and its note names what it
 * is without, so its own report never shows a `new:` reference.
 */
export function aiBuildItemArgsWithout(
  args: Readonly<Record<string, unknown>>,
  dropped: ReadonlySet<string> | undefined,
): Record<string, unknown> {
  if (!dropped?.size) return { ...args }
  const links = (entry: unknown) => aiBuildItemArgRefs({ entry }).some((ref) => dropped.has(aiBuildRefName(ref)))
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, Array.isArray(value) ? value.filter((entry) => !links(entry)) : value]),
  )
}

/**
 * What a build's theme change says under its proposal (AGL-4077): the theme
 * runner proposes and never saves, so the owner applies it, or not, where
 * every theme change is made.
 */
export const AI_BUILD_THEME_PROPOSAL_NOTE =
  'A proposal, in Setup → Theme. Nothing on the site changes until you apply it there and save.'

/**
 * What a build's units are told about the business (AGL-4077), in the inputs
 * a site start's own units carry: what it does (`businessType`), its name and
 * who it is for. A build started from the chat carries none of them, so its
 * pages searched photos by their section names alone.
 */
export interface AiBuildBusinessWords {
  businessType?: string
  businessName?: string
  audience?: string
}

/** Text held to what a site start's own answer holds, cut at a word. */
function clipWords(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= AI_SITE_INPUT_MAX_CHARS) return text
  const cut = text.slice(0, AI_SITE_INPUT_MAX_CHARS + 1)
  const space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, AI_SITE_INPUT_MAX_CHARS)).replace(/[\s,;:.–—-]+$/, '')
}

/**
 * The site's business profile as those inputs (AGL-4077): what the business
 * does, else the schema.org type its settings name, as words; its name; who
 * it is for. Only what the profile says; nothing for a site with none.
 */
export function aiBuildBusinessWords(profile: ResolvedBusinessProfile | null | undefined): AiBuildBusinessWords {
  if (!profile) return {}
  const type = profile.businessType ? profile.businessType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : ''
  const words: AiBuildBusinessWords = {
    businessType: clipWords(profile.whatYouDo?.value) || clipWords(type),
    businessName: clipWords(profile.name?.value),
    audience: clipWords(profile.audience?.value),
  }
  return Object.fromEntries(Object.entries(words).filter(([, value]) => value)) as AiBuildBusinessWords
}

/**
 * The business words a page is handed (AGL-4077): only where the build itself
 * names no business, and only what the build does not say already.
 */
function aiBuildBusinessInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
  business: AiBuildBusinessWords | null | undefined,
): AiBuildBusinessWords {
  if (!business || aiSiteWords(inputs).about) return {}
  const given = (key: string) => typeof inputs?.[key] === 'string' && (inputs[key] as string).trim() !== ''
  return Object.fromEntries(Object.entries(business).filter(([key]) => !given(key))) as AiBuildBusinessWords
}

/** The id a unit's job, and so its draft, is named by. */
export function aiBuildUnitJobId(job: Pick<AiJob, '$id'>, unit: AiBuildUnit): string {
  return unit.creation?.id ?? unit.screen?.id ?? unit.item?.id ?? `${job.$id}-${unit.slot}`
}

/**
 * The job a unit is built under (generalizing `aiSiteUnitJob`): this job's
 * org, site, creator and model; the kind that builds the unit; a plan
 * narrowed to the unit, its `new:` references resolved to what was built and
 * the failed ones left out; and a brief that says what the unit is, what it
 * is built without, and which blocks its sections place.
 */
export function aiBuildUnitJob(
  job: AiJob,
  unit: AiBuildUnit,
  context: {
    kind: AiJobKind
    units: readonly AiBuildUnit[]
    ledger: readonly AiJobItemLedger[]
    ops: AiBuildOps
    briefLines?: readonly string[]
    /** The `new:` names, lowercased, of what failed and the unit is built without (`aiBuildDegradation`). */
    dropped?: ReadonlySet<string>
    /** The motion of the site the build adds to, from its stored look (`aiLayoutSiteMotionOf`); absent, none stored. */
    siteMotion?: AiLayoutSiteMotion | null
    /** What the site's business profile says the business is (`aiBuildBusinessWords`, AGL-4077); absent, nothing read. */
    business?: AiBuildBusinessWords | null
  },
): AiJob {
  const plan = job.plan as AiJobPlan
  const built = aiBuildBuiltRefs(context.units, context.ledger, job.outputs ?? [])
  const labels = { ...(plan.labels ?? {}) }
  for (const entry of built.values()) labels[entry.id] = entry.label
  const brief = [job.brief.trim()]
  const unitPlan: AiJobPlan = { ...plan, labels, reuse: [...plan.reuse], create: [], screens: [] }
  delete unitPlan.items
  const placedByScreens = new Set(plan.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses)))
  if (unit.creation) {
    unitPlan.reuse = plan.reuse.filter((entry) => !placedByScreens.has(entry.id))
    unitPlan.create = [
      {
        ...unit.creation,
        duplicateOf: aiSiteResolvedRef(unit.creation.duplicateOf, built),
        // The dataset a form writes to, new or the site's own (AGL-3616); one
        // this build failed to make leaves the form as it always was.
        ...(unit.creation.writesTo ? { writesTo: aiSiteResolvedRef(unit.creation.writesTo, built) } : {}),
      },
    ]
    const what = unit.creation.kind === 'theme-change' ? aiBuildCreationNoun(unit.creation.kind) : unit.creation.kind
    brief.push(`Build the ${what} “${unit.creation.name}”: ${unit.creation.why}`)
  }
  if (unit.screen) {
    const screen = unit.screen
    for (const entry of built.values()) {
      unitPlan.reuse.push({ kind: entry.kind, id: entry.id, purpose: `the ${entry.kind} this request built` })
    }
    let builtLayout: string | null = null
    for (const entry of built.values()) if (entry.kind === 'layout') builtLayout = builtLayout ?? entry.id
    unitPlan.screens = [
      {
        ...screen,
        // A page whose layout failed renders inside the site's own: the page
        // step falls back to it when the plan names none.
        layout: aiSiteResolvedRef(screen.layout, built) ?? (isAiPlanNewRef(screen.layout) ? builtLayout : null),
        template: aiSiteResolvedRef(screen.template, built),
        duplicateOf: aiSiteResolvedRef(screen.duplicateOf, built),
        record: screen.record
          ? { ...screen.record, dataset: aiSiteResolvedRef(screen.record.dataset, built) ?? screen.record.dataset }
          : null,
        sections: screen.sections.map((section) => ({
          ...section,
          uses: section.uses
            .map((ref) => aiSiteResolvedRef(ref, built))
            .filter((ref): ref is string => !!ref),
        })),
      },
    ]
    brief.push(`Build the page “${screen.title}”, at ${screen.slug}.`)
    // A build's events are listed by the platform (AGL-3755), never written by the page.
    brief.push(
      ...aiBuildPlacedItemLines(unit, { units: context.units, ledger: context.ledger, ops: context.ops, placedByCode: [AI_SITE_EVENT_OP] }),
    )
  }
  const item = unit.item
  if (item) {
    const noun = context.ops.get(item.op)?.noun ?? item.op
    brief.push(`Build the ${noun} “${item.name}”${item.why ? `: ${item.why}` : '.'}`)
    // A planned kind's step builds the plan's first creation of its kind.
    unitPlan.create = AI_PLANNED_JOB_KINDS.includes(context.kind)
      ? [{ kind: context.kind as AiBuildPlanCreateKind, name: item.name, why: item.why, duplicateOf: null, fields: [], ...(item.id ? { id: item.id } : {}) }]
      : []
  }
  brief.push(...(context.briefLines ?? []))
  const inputs: Record<string, unknown> = {
    ...job.inputs,
    // What the business is, from the site's profile, where the build says
    // nothing of it (AGL-4077): a page's photos are searched with them. Never
    // a layout, which would write the name where the token that reads the
    // site's own name goes, and never an item, whose inputs are its arguments.
    ...(unit.screen ? aiBuildBusinessInputs(job.inputs, context.business) : {}),
    ...aiBuildItemArgsWithout(item?.args ?? {}, context.dropped),
    originJobId: aiOriginJobId(job),
  }
  delete inputs[AI_BUILD_PUBLISH_INPUT]
  // A theme change is a change to the theme the site has (AGL-4077), never a new one.
  if (context.kind === 'theme') inputs['mode'] = 'modify'
  // What a build adds to a site moves the way the site's own pages do
  // (AGL-3949): its look's motion style, drawn with the site's seed.
  if (context.siteMotion && (context.kind === 'page' || context.kind === 'layout' || context.kind === 'template')) {
    inputs[AI_LAYOUT_SITE_MOTION_INPUT] = context.siteMotion
  }
  // An item is told the pages and layouts this build made before it, which
  // its arguments may link as `new:<name>` (a menu item, AGL-3728).
  if (item) {
    const rows = new Map(context.ledger.map((row) => [row.slot, row]))
    const made: AiBuildMade = {
      pages: context.units.flatMap((one) => {
        const row = rows.get(one.slot)
        return one.screen?.id && row && aiBuildItemDelivered(row) ? [{ title: one.screen.title, id: one.screen.id }] : []
      }),
      layouts: [...built.entries()].filter(([, entry]) => entry.kind === 'layout').map(([name, entry]) => ({ name, id: entry.id })),
    }
    if (made.pages.length || made.layouts.length) inputs[AI_BUILD_MADE_INPUT] = made
  }
  // A dataset this build made for its form, which the form may bind (AGL-3616).
  const madeFor = unit.creation?.kind === 'form' && isAiPlanNewRef(unit.creation.writesTo) ? unitPlan.create[0]?.writesTo : null
  if (madeFor) inputs[AI_FORM_DATASET_MADE_INPUT] = madeFor
  // A build's pages and layouts are designed in the layout language and
  // compiled (AGL-3660), told the pages the build plans and where its form is.
  if (context.kind === 'page' || context.kind === 'layout') {
    inputs[AI_LAYOUT_LANGUAGE_INPUT] = true
    const pages = aiLayoutSitePagesOfPlan(plan.screens)
    if (pages.length) inputs[AI_LAYOUT_SITE_PAGES_INPUT] = pages
    const formPage = aiLayoutFormPageOfPlan(plan)
    if (formPage) inputs[AI_LAYOUT_FORM_PAGE_INPUT] = formPage
    // The datasets this build made, repeated in the sections that name them (AGL-3616),
    // and the site's own the plan reuses (AGL-3747): the page reads their fields,
    // and the record pages the site already serves for them, off its inventory.
    const datasets = [...built.entries()]
      .filter(([, entry]) => entry.kind === 'dataset')
      .map(([name, entry]) => ({ id: entry.id, name: context.units.find((one) => one.item?.name.toLowerCase() === name)?.label ?? entry.label }))
    for (const entry of plan.reuse) {
      if (entry.kind !== 'dataset' || datasets.some((one) => one.id === entry.id)) continue
      datasets.push({ id: entry.id, name: plan.labels?.[entry.id] ?? entry.id })
    }
    const listings = aiDatasetListingsOf(datasets, plan.screens)
    // The events this build wrote, in the sections that name them (AGL-3755).
    const eventUnits = context.units.filter((one) => one.item?.op === AI_SITE_EVENT_OP)
    const ledgerRows = new Map(context.ledger.map((row) => [row.slot, row]))
    listings.push(
      ...aiEventsListings({
        written: eventUnits
          .filter((one) => {
            const row = ledgerRows.get(one.slot)
            return Boolean(row && aiBuildItemDelivered(row) && row.outputs.length)
          })
          .map((one) => one.item?.name ?? one.label),
        planned: eventUnits.map((one) => one.item?.name ?? one.label),
        screens: plan.screens,
      }),
    )
    if (listings.length) inputs[AI_LAYOUT_LISTINGS_INPUT] = listings
  }
  // A build that makes the site a store links its account and policies from
  // the layout it makes (AGL-3676), by path: they are written after it.
  const storePages = aiBuildStorePagesOf(plan)
  if (context.kind === 'layout' && storePages) inputs[AI_SITE_STORE_LINKS_INPUT] = aiStoreFrameLinks(storePages.pages)
  return {
    ...job,
    $id: aiBuildUnitJobId(job, unit),
    kind: context.kind,
    steps: [],
    outputs: [],
    items: null,
    // Only a planned kind builds from a plan: an item's other runners, and the theme runner, take none.
    plan: AI_PLANNED_JOB_KINDS.includes(context.kind) ? unitPlan : null,
    inputs,
    brief: brief.join('\n').slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/** The unit's failure, for its row: ours or not, why, in customer-safe words. */
function failed(
  slot: string,
  failure: AiJobItemFailure,
  extra: Partial<AiJobItemOutcome> = {},
): AiJobItemOutcome {
  return { slot, status: 'failed', failure, ...extra }
}

export interface AiJobBuildStepDeps {
  /** The runner registry; specs hand in fakes. */
  runnerFor?: typeof aiJobStepRunnerFor
  /** The draft writer registry; specs hand in fakes. */
  writerFor?: AiPluginDraftWriterLookup
  /** The operations this site may use; the registry and its gates otherwise. */
  opsFor?: (context: AiBuildOpsContext) => Promise<AiBuildOps>
  /** A runner kind's own admission, asked before its item runs; the registry's otherwise. */
  admissionFor?: typeof aiJobAdmissionRefusal
  /** Another plugin's admission for its writer; the seam's otherwise. */
  pluginAdmission?: typeof aiPluginDraftAdmissionRefusal
  /** The draft reader a built page is checked through. */
  readNodes?: typeof readAiDraftNodes
  /** The publish a build asked for and confirmed. */
  publish?: typeof aiPublishGuidedSite
  /** A store's own pages' pass and whether they may be added here (AGL-3676); specs hand in fakes. */
  storePages?: AiJobStepRunner
  storePagesRefusal?: typeof aiSiteStorePagesRefusal
  /** The site's pages as they are now, which a store's own pages are checked against before they are written. */
  readSitePages?: typeof readAiStoreSitePages
  /** The draft version of the site's layout a store's links are written into. */
  writeStoreLinks?: typeof writeAiStoreLinksLayoutDraft
  /** The site's business profile, read where the build names no business (AGL-4077). */
  readSiteContext?: typeof readAiSiteContext
}

/** The site's pages as a store's own pages are checked against them (AGL-3676): every page that is not deleted. */
export async function readAiStoreSitePages(firestore: FirebaseFirestore.Firestore, hostId: string): Promise<AiStoreSitePage[]> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('screens')
    .select('displayName', 'slug', 'kind', 'deletedAt', 'layoutId')
    .get()
  return snapshot.docs.flatMap((doc) => {
    const kind = doc.get('kind')
    if (doc.get('deletedAt') || (kind && kind !== 'template')) return []
    const slug = String(doc.get('slug') ?? '')
    const layoutId = doc.get('layoutId')
    return slug
      ? [{ id: doc.id, slug, title: String(doc.get('displayName') ?? ''), template: kind === 'template', layoutId: typeof layoutId === 'string' && layoutId ? layoutId : null }]
      : []
  })
}

/**
 * What a build's store pages unit is told (AGL-3676): the pages its plan kept,
 * less any the site has gained since — never counting the pages this unit
 * wrote itself on an earlier pass, which it finds again by their ids — what
 * their words link, and the layout they render inside: the plan's Shop
 * page's, else the site's own (`aiBuildStoreLayoutOf`).
 */
export function aiBuildStorePagesInput(
  job: AiJob,
  context: { unitJobId: string; sitePages: readonly AiStoreSitePage[]; units: readonly AiBuildUnit[]; ledger: readonly AiJobItemLedger[] },
): AiSiteStorePagesInput | null {
  const plan = job.plan as AiJobPlan
  const kept = aiBuildStorePagesOf(plan)
  if (!kept) return null
  const own = new Set(kept.pages.map((page) => aiSiteStorePageId(context.unitJobId, page.key)))
  const pages = aiBuildStorePagesStillMissing(
    kept.pages,
    context.sitePages.filter((page) => !page.id || !own.has(page.id)),
  )
  const built = aiBuildBuiltRefs(context.units, context.ledger, job.outputs ?? [])
  const shop = plan.screens.find((screen) => !screen.record && screen.slug.replace(/^\/+/, '').split('/')[0].toLowerCase() === kept.facts.shopPath.slice(1))
  const layout = shop ? aiSiteResolvedRef(shop.layout, built) : null
  return {
    pages,
    facts: kept.facts,
    layoutId: aiBuildStoreLayoutOf(layout && !isAiPlanNewRef(layout) ? layout : null, context.sitePages),
  }
}

/**
 * Adds a store's links to the site's own layout (AGL-3676), as a draft
 * version, where the build made no layout of its own for its store pages: the
 * outputs that record it — the layout version written (`storeLinks: draft`),
 * and on the first page `storeLinks: missing` where the layout had no header
 * or footer list to add them to, or there is no layout at all.
 */
export async function aiBuildStoreLinksOutputs(
  firestore: FirebaseFirestore.Firestore,
  input: {
    job: AiJob
    unitJobId: string
    store: AiSiteStorePagesInput
    outputs: readonly AiJobOutput[]
    sitePages: readonly AiStoreSitePage[]
    builtLayouts: ReadonlySet<string>
    now: Date
  },
  write: typeof writeAiStoreLinksLayoutDraft = writeAiStoreLinksLayoutDraft,
): Promise<AiJobOutput[]> {
  const outputs = input.outputs.map((output) => ({ ...output }))
  const layoutId = input.store.layoutId
  // A layout this build made was told the store's links as it was compiled.
  if (layoutId && input.builtLayouts.has(layoutId)) return outputs
  const written = new Set(outputs.map((output) => output.proposal?.['storePage']).filter((key): key is string => typeof key === 'string'))
  const links = aiBuildStoreLayoutLinks(input.store.pages, written)
  const missing = (): AiJobOutput[] => {
    const [first, ...rest] = outputs
    const state: AiBuildStoreLinksState = 'missing'
    return first ? [{ ...first, proposal: { ...(first.proposal ?? {}), storeLinks: state } }, ...rest] : outputs
  }
  if (!layoutId || !input.job.hostId) return missing()
  const hrefs = new Set([...links.header, ...(links.cart ? [links.cart] : []), ...links.footer].map((link) => link.href.slice(1)))
  const screenPaths: Record<string, string> = {}
  for (const page of input.sitePages) {
    const slug = page.slug.replace(/^\/+/, '').split('/')[0].toLowerCase()
    if (page.id && hrefs.has(slug)) screenPaths[page.id] = slug
  }
  const draft = await write(firestore, {
    hostId: input.job.hostId,
    layoutId,
    versionId: `${input.unitJobId}-links`.slice(0, 64),
    links,
    screenPaths,
    uid: input.job.createdBy,
    aiJobId: aiOriginJobId(input.job),
    now: input.now,
  })
  if (draft.status === 'present') return outputs
  if (draft.status === 'gone') return missing()
  const versionId = draft.versionId
  const layout: AiJobOutput[] = versionId
    ? [
        {
          resource: 'layout',
          id: draft.layoutId,
          versionId,
          hostId: input.job.hostId,
          hostSubdomain: outputs.find((output) => output.hostSubdomain)?.hostSubdomain,
          label: draft.name,
          note: 'A new draft version with Account and policy links. Visitors see it once it is published.',
          proposal: { storeLinks: 'draft' satisfies AiBuildStoreLinksState, links, screenPaths },
        },
      ]
    : []
  return [...(draft.status === 'unrecognized' ? missing() : outputs), ...layout]
}

/** The store's links a build drafted into the site's layout (AGL-3676), as its publish puts them live; `null` where it drafted none. */
export function aiBuildStoreLinksToPublish(outputs: readonly AiJobOutput[]): AiSitePublishStoreLinks | null {
  // The newest: a retried store drafts its links again after the first attempt's (AGL-3739).
  const draft = [...outputs]
    .reverse()
    .find((output) => output.resource === 'layout' && output.proposal?.['storeLinks'] === 'draft' && output.versionId)
  if (!draft?.versionId) return null
  return {
    layoutId: draft.id,
    versionId: draft.versionId,
    links: draft.proposal?.['links'] as AiStoreLayoutLinks,
    screenPaths: (draft.proposal?.['screenPaths'] ?? {}) as Record<string, string>,
  }
}

/** Whether a build's workspace spends the Free taste. */
export function aiBuildFreeTaste(org: object | null | undefined): boolean {
  return Boolean(org) && resolveEffectivePlan(org as never) === 'free'
}

/** The site document a gate reads, or `null`. */
async function readHost(firestore: FirebaseFirestore.Firestore, hostId: string | null) {
  if (!hostId) return null
  return ((await firestore.collection('hosts').doc(hostId).get()).data() ?? null) as Record<string, unknown> | null
}

export function createAiJobBuildStep(deps: AiJobBuildStepDeps = {}): AiJobStepRunner {
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  const writerFor = deps.writerFor ?? aiPluginDraftWriter
  const opsFor = deps.opsFor ?? ((context) => aiBuildOps(context))
  const admissionFor = deps.admissionFor ?? aiJobAdmissionRefusal
  const pluginAdmission = deps.pluginAdmission ?? aiPluginDraftAdmissionRefusal
  const readNodes = deps.readNodes ?? readAiDraftNodes
  const publish = deps.publish ?? aiPublishGuidedSite
  const storePagesRunner = deps.storePages ?? runAiSiteStorePagesUnit
  const storePagesRefusal = deps.storePagesRefusal ?? aiSiteStorePagesRefusal
  const readSitePages = deps.readSitePages ?? readAiStoreSitePages
  const writeStoreLinks = deps.writeStoreLinks ?? writeAiStoreLinksLayoutDraft
  const readSiteContext = deps.readSiteContext ?? readAiSiteContext

  return async (context): Promise<AiJobStepOutcome> => {
    const { job, firestore } = context
    const model = context.modelFor?.('job.plan') ?? aiModelForStep('job.plan')
    const plan = aiConfirmedPlan(job)
    if (!plan) return { ...aiUnspentOutcome(model), failure: AI_BUILD_NO_PLAN_COPY }
    const org = (context.org ?? null) as Partial<AglynOrgBilling> | null
    const units = aiBuildUnits(plan)
    const ordered = aiBuildOrder(units) ?? units
    const starting = !job.items?.length
    const ledger = starting ? aiBuildInitialLedger(units) : (job.items as AiJobItemLedger[])
    const init = starting ? { items: ledger } : {}
    const unit = aiBuildNextUnit(ordered, ledger)
    const rows = new Map(ledger.map((row) => [row.slot, row]))
    const host = await readHost(firestore, job.hostId ?? null)
    const ops = await opsFor({
      orgId: job.orgId,
      hostId: job.hostId ?? null,
      org,
      host,
      freeTaste: aiBuildFreeTaste(org),
    })

    /** Whether units other than this one are still to build. */
    const othersOpen = (slot: string) =>
      ordered.some((one) => one.slot !== slot && aiBuildItemOpen(rows.get(one.slot) ?? { status: 'pending' }))

    /**
     * The build's last pass puts its pages live, where it was asked and
     * confirmed. Once it has, Try again's last pass puts only the pages the
     * retry built live (AGL-3739, AGL-3730's fix for a site start),
     * merged into the record of the first.
     */
    const finish = async (
      outcome: AiJobStepOutcome,
      extraPages: readonly AiJobOutput[] = [],
      extraOutputs: readonly AiJobOutput[] = [],
    ): Promise<AiJobStepOutcome> => {
      if (!aiJobPublishesBuild(job) || !job.hostId) return outcome
      const previous = job.sitePublish ?? null
      const retry = Boolean(previous?.published.length)
      const already = new Set((previous?.published ?? []).map((page) => page.id))
      // A record template renders once per record only once its binding is
      // saved, so it is never published at its own address (AGL-3616).
      // A store's own pages (AGL-3676) go live with the pages the build planned.
      const pageIds = new Set(
        units
          .filter(
            (one) =>
              ((one.screen && !one.screen.record) || one.op === AI_BUILD_STORE_OP) &&
              aiBuildItemDelivered(rows.get(one.slot) ?? { status: 'pending' }),
          )
          .flatMap((one) => rows.get(one.slot)?.outputs ?? []),
      )
      const built = [
        ...(job.outputs ?? []).filter((output) => output.resource === 'screen' && pageIds.has(output.id)),
        ...extraPages,
      ]
      const pages = built.filter((page) => !already.has(page.id))
      if (!pages.length) return outcome
      // A canceled build never puts anything live (AGL-3616): its pages stay drafts.
      if (await aiJobCancelAsked(firestore, job, context.signal)) return outcome
      // The store pages a layout this build made links and that were not written come out of it.
      const storePages = aiBuildStorePagesOf(plan)
      const live = new Set(built.map((page) => page.proposal?.['storePage']).filter(Boolean))
      const unwrittenHrefs = storePages
        ? aiStorePagesToWrite(storePages.pages).filter((page) => !live.has(page.key)).map((page) => page.href)
        : []
      // A retry puts the store's links live only with store pages it built:
      // the first publish's links draft is live already, and a person may have edited it since.
      const storeLinks =
        !retry || pages.some((page) => page.proposal?.['storePage'])
          ? aiBuildStoreLinksToPublish([...(job.outputs ?? []), ...extraOutputs])
          : null
      const sitePublish = await publish(firestore, {
        job,
        outputs: pages,
        now: context.now,
        ...(unwrittenHrefs.length ? { unwrittenHrefs } : {}),
        ...(storeLinks ? { storeLinks } : {}),
        ...(retry ? { retry: true } : {}),
      }).catch((error: unknown) => {
        console.error('ai build publish threw', { orgId: job.orgId, jobId: job.$id, error })
        return null
      })
      if (!sitePublish) return outcome
      return { ...outcome, sitePublish: previous ? aiMergeSitePublish(previous, sitePublish) : sitePublish }
    }

    if (!unit) return finish({ ...aiUnspentOutcome(model), ...init })

    const settle = (item: AiJobItemOutcome, spent: AiJobStepOutcome = aiUnspentOutcome(model)): AiJobStepOutcome => ({
      ...spent,
      ...init,
      item,
      ...(item.status === 'running' || othersOpen(unit.slot) ? { continue: true } : {}),
    })

    // What its dependencies came to.
    const degradation = aiBuildDegradation(unit, { units, ledger, ops })
    if (degradation.skip) {
      return settle({ slot: unit.slot, status: 'skipped', note: degradation.skip, degradedBy: degradation.degradedBy })
    }
    // A store's own pages (AGL-3676): written by code, behind the site start's gate.
    if (unit.op === AI_BUILD_STORE_OP) {
      if (!job.hostId) return settle({ slot: unit.slot, status: 'skipped', note: 'Not built: open the site first.' })
      if (rows.get(unit.slot)?.status !== 'running') {
        const refusal = await storePagesRefusal({ ...context, job }).catch((error: unknown) => {
          console.error('ai build store pages admission failed', { orgId: job.orgId, jobId: job.$id, error })
          return AI_BUILD_UNIT_EMPTY_COPY
        })
        if (refusal) return settle({ slot: unit.slot, status: 'skipped', note: `Not built: ${refusal}` })
      }
      const unitJobId = aiBuildUnitJobId(job, unit)
      const sitePages = await readSitePages(firestore, job.hostId)
      const input = aiBuildStorePagesInput(job, { unitJobId, sitePages, units, ledger })
      if (!input) return settle({ slot: unit.slot, status: 'skipped', note: aiBuildUnavailableCopy('store page') })
      if (!aiStorePagesToWrite(input.pages).length) {
        return settle({ slot: unit.slot, status: 'skipped', note: AI_BUILD_STORE_PAGES_PRESENT_NOTE })
      }
      const derived: AiJob = {
        ...job,
        $id: unitJobId,
        kind: 'text',
        steps: [],
        outputs: [],
        items: null,
        plan: null,
        inputs: { ...job.inputs, originJobId: aiOriginJobId(job), [AI_SITE_STORE_PAGES_INPUT]: input },
      }
      let outcome: AiJobStepOutcome
      try {
        outcome = await storePagesRunner({ ...context, job: derived })
      } catch (error) {
        if (aiUnitErrorRetryable(error)) throw error
        console.error('ai build store pages threw', { orgId: job.orgId, jobId: job.$id, error })
        return settle(failed(unit.slot, { ours: true, reason: 'step-failure', message: AI_BUILD_UNIT_EMPTY_COPY }))
      }
      const stopped = aiUnitFailure(unit.slot, outcome)
      if (stopped) return settle(stopped, aiUnitSpend(outcome))
      // The site's own header and footer link them (AGL-3676), in a draft
      // version of its layout; a layout this build made already does.
      const builtLayouts = new Set(
        [...aiBuildBuiltRefs(units, ledger, job.outputs ?? []).values()].filter((entry) => entry.kind === 'layout').map((entry) => entry.id),
      )
      const outputs = await aiBuildStoreLinksOutputs(
        firestore,
        { job, unitJobId, store: input, outputs: outcome.outputs, sitePages, builtLayouts, now: context.now },
        writeStoreLinks,
      ).catch((error: unknown) => {
        console.error('ai build store links not written', { orgId: job.orgId, jobId: job.$id, error })
        return outcome.outputs
      })
      const ids = outputs.map((output) => output.id)
      const done = settle({ slot: unit.slot, status: 'succeeded', outputs: ids, note: AI_SITE_STORE_PAGES_NOTE }, { ...aiUnitSpend(outcome), outputs })
      if (done.continue) return done
      rows.set(unit.slot, { ...(rows.get(unit.slot) as AiJobItemLedger), status: 'succeeded', outputs: ids })
      return finish(
        done,
        outputs.filter((output) => output.resource === 'screen'),
        outputs,
      )
    }

    const capability = ops.get(unit.op)
    const noun = capability?.noun ?? unit.op
    if (!capability) return settle({ slot: unit.slot, status: 'skipped', note: aiBuildUnavailableCopy(noun) })
    const degraded = degradation.degradedBy.length > 0
    const note = degradation.notes.length ? degradation.notes.join(' ') : null
    // What the business is, for a page or another plugin's draft, read from
    // the site's profile where the build names none (AGL-4077): a build from
    // the chat carries no businessType, so its pages searched photos with
    // nothing of the business to go on. Fail-soft: unread, the unit is built
    // as it was.
    const business =
      job.hostId && !aiSiteWords(job.inputs).about && (unit.screen || capability.draftResource)
        ? await readSiteContext(firestore, { orgId: job.orgId, hostId: job.hostId, host })
            .then((read) => aiBuildBusinessWords(read?.profile))
            .catch((error: unknown) => {
              console.warn('ai build business profile unread', { orgId: job.orgId, jobId: job.$id, error })
              return null
            })
        : null

    // Another plugin's resource: its writer, with the content its capability derives.
    if (capability.draftResource) {
      const item = unit.item
      const writer = writerFor(capability.draftResource)
      if (!item || !writer || !job.hostId) {
        return settle({ slot: unit.slot, status: 'skipped', note: aiBuildUnavailableCopy(noun) })
      }
      const admission: AiJobAdmissionContext = {
        firestore,
        orgId: job.orgId,
        hostId: job.hostId,
        inputs: {},
        org,
        uid: job.createdBy,
      }
      const refusal = await pluginAdmission(admission, {
        kind: 'build',
        drafts: [{ resource: capability.draftResource, label: capability.noun }],
        writerFor,
      })
      if (refusal) return settle({ slot: unit.slot, status: 'skipped', note: `Not built: ${refusal.error}` })
      const dependencies: Record<string, { op: string; id: string }> = {}
      for (const slot of unit.deps) {
        const dep = units.find((one) => one.slot === slot)
        const row = rows.get(slot)
        if (!dep || !row || !aiBuildItemDelivered(row) || !row.outputs.length) continue
        dependencies[`new:${dep.label}`] = { op: dep.op, id: row.outputs[0] }
      }
      const content = capability.draftContent?.({ name: item.name, args: item.args }, { hostId: job.hostId, dependencies }) ?? item.args
      const checked = writer.check(content, { hostId: job.hostId })
      if (checked.ok === false) {
        return settle(
          failed(unit.slot, { ours: true, reason: 'step-failure', message: checked.problems[0] ?? AI_BUILD_UNIT_EMPTY_COPY }),
        )
      }
      const id = aiBuildUnitJobId(job, unit)
      const written = await writer.write({
        orgId: job.orgId,
        hostId: job.hostId,
        uid: job.createdBy,
        org,
        now: context.now,
        // Drafts of one build share what must not repeat (a cover photo) and read its business (AGL-3755).
        act: { id: aiOriginJobId(job), business: aiSiteWords(job.inputs).about || business?.businessType || job.brief || '' },
        id,
        name: item.name,
        content,
      })
      if (written.ok === false) {
        return settle(failed(unit.slot, { ours: false, reason: 'review', message: written.error }))
      }
      const output: AiJobOutput = {
        resource: 'draft',
        id: written.id,
        versionId: written.versionId,
        hostId: job.hostId,
        label: written.name,
        draftResource: capability.draftResource,
        // A resource with no draft state is live once written (AGL-3745, AGL-3746).
        note: aiBuildItemOutputNote(capability, written),
      }
      return settle(
        {
          slot: unit.slot,
          status: degraded ? 'degraded' : 'succeeded',
          outputs: [written.id],
          note,
          ...(degraded ? { degradedBy: degradation.degradedBy } : {}),
        },
        { ...aiUnspentOutcome(model), outputs: [output] },
      )
    }

    // This plugin's own runner, under a job derived for the unit.
    const kind = aiBuildUnitJobKind(unit, ops)
    const runner = kind ? runnerFor(kind) : null
    if (!kind || !runner) return settle({ slot: unit.slot, status: 'skipped', note: aiBuildUnavailableCopy(noun) })
    const derived = aiBuildUnitJob(job, unit, {
      kind,
      units,
      ledger,
      ops,
      briefLines: degradation.briefLines,
      dropped: degradation.dropped,
      siteMotion: aiLayoutSiteMotionOf(host?.['siteStyle']),
      business,
    })
    // An item's kind is asked its own admission first (a campaign's plan,
    // a template's subject), once, before its first pass.
    if (unit.item && rows.get(unit.slot)?.status !== 'running') {
      const refusal = await admissionFor(kind, {
        firestore,
        orgId: job.orgId,
        hostId: job.hostId ?? null,
        inputs: derived.inputs,
        org,
        uid: job.createdBy,
      }).catch((error: unknown) => {
        console.error('ai build item admission failed', { orgId: job.orgId, jobId: job.$id, slot: unit.slot, error })
        return { status: 403 as const, error: AI_BUILD_UNIT_EMPTY_COPY }
      })
      if (refusal) return settle({ slot: unit.slot, status: 'skipped', note: `Not built: ${refusal.error}` })
    }

    let outcome: AiJobStepOutcome
    try {
      outcome = await runner({ ...context, job: derived })
    } catch (error) {
      // A provider that will answer later is the machine's to retry; anything
      // else is this item's failure, and the build goes on.
      if (aiUnitErrorRetryable(error)) throw error
      console.error('ai build unit threw', { orgId: job.orgId, jobId: job.$id, slot: unit.slot, error })
      return settle(failed(unit.slot, { ours: true, reason: 'provider', message: AI_BUILD_UNIT_EMPTY_COPY }))
    }
    // A theme change's proposal says where it is applied (AGL-4077).
    const theme = kind === 'theme'
    const spent = theme
      ? {
          ...aiUnitSpend(outcome),
          outputs: outcome.outputs.map((output) => (output.resource === 'theme' ? { ...output, note: AI_BUILD_THEME_PROPOSAL_NOTE } : output)),
        }
      : aiUnitSpend(outcome)
    const ids = outcome.outputs.map((output) => output.id)
    const stopped = aiUnitFailure(unit.slot, outcome)
    if (stopped) return settle(stopped, spent)
    // A page counts as built only when its plan's sections are in it (AGL-3596).
    if (unit.screen && job.hostId) {
      const page = outcome.outputs.find((output) => output.resource === 'screen')
      const written =
        page !== undefined &&
        (await aiSitePageWritten(
          firestore,
          {
            hostId: job.hostId,
            unitJobId: derived.$id,
            screen: unit.screen,
            draftId: page.id,
            layoutLanguage: aiJobUsesLayoutLanguage(derived),
          },
          readNodes,
        ))
      if (!written) {
        return settle(
          failed(unit.slot, { ours: true, reason: 'step-failure', message: AI_BUILD_PAGE_NOT_WRITTEN_COPY }),
          { ...spent, outputs: outcome.outputs.filter((output) => output.resource !== 'screen') },
        )
      }
    }
    const done = settle(
      {
        slot: unit.slot,
        status: degraded ? 'degraded' : 'succeeded',
        outputs: ids,
        note: theme ? [note, AI_BUILD_THEME_PROPOSAL_NOTE].filter(Boolean).join(' ') : note,
        ...(degraded ? { degradedBy: degradation.degradedBy } : {}),
      },
      spent,
    )
    if (done.continue) return done
    // The last unit: what was built goes live where it was asked and confirmed.
    rows.set(unit.slot, { ...(rows.get(unit.slot) as AiJobItemLedger), status: degraded ? 'degraded' : 'succeeded', outputs: ids })
    return finish(done, unit.screen ? outcome.outputs.filter((output) => output.resource === 'screen') : [])
  }
}

export const runAiJobBuildStep = createAiJobBuildStep()

/**
 * The least time a build's next pass needs: what the step that builds its
 * next unit registers for the job derived for it; a page pass's when the
 * next unit is another plugin's draft, which asks no model.
 */
export function aiBuildJobRunMinimumMs(job: AiJob): number {
  const plan = aiConfirmedPlan(job)
  if (!plan) return AI_JOB_PAGE_STEP_MINIMUM_MS
  const units = aiBuildUnits(plan)
  const ordered = aiBuildOrder(units) ?? units
  const ledger = job.items?.length ? job.items : aiBuildInitialLedger(units)
  const unit = aiBuildNextUnit(ordered, ledger)
  if (!unit) return AI_JOB_PAGE_STEP_MINIMUM_MS
  const kind: AiJobKind | null = unit.screen
    ? 'page'
    : unit.creation
      ? (CREATION_JOB_KINDS[unit.creation.kind] ?? null)
      : (AI_BUILD_ITEM_RUNNER_KINDS[unit.op] ?? null)
  if (!kind) return AI_JOB_PAGE_STEP_MINIMUM_MS
  return aiJobStepRunMinimumMs(aiBuildUnitJob(job, unit, { kind, units, ledger, ops: new Map() }))
}

/** The runner kinds this plugin's own item operations use, for the time a pass needs without the registry. */
const AI_BUILD_ITEM_RUNNER_KINDS: Readonly<Record<string, AiJobKind>> = {
  template: 'template',
  campaign: 'campaign',
  workflow: 'workflow',
  function: 'logic',
  edit: 'edit',
  navigation: 'navigation',
  duplicate: 'duplicate',
  settings: 'settings',
  media: 'media',
  tracking: 'tracking',
  privacy: 'privacy',
  [AI_BUILD_THEME_OP]: 'theme',
}

/**
 * What a Free build's credits say before it runs (AGL-3722), on its measured
 * p90 rather than its ceiling: `null` when what is left this month covers the
 * p90 — or when nothing is known about what is left, since each pass's
 * reservation still decides — and `null` too for a build the person chose
 * to build as far as it goes (`confirmed`), whose prompt `onConfirmed` is
 * told so the door records it. Otherwise a 409 carrying the prompt: the
 * range, what is left, and the smaller first build. Nothing left at all is a
 * 429. Read off the same two walls the reservation refuses at
 * (`readFreeAiCreditsLeft`), net of give-backs.
 */
export async function aiBuildFreeCreditsRefusal(input: {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  org: object | null
  range: AiCreditRange
  smaller?: AiCreditsSmaller | null
  confirmed?: boolean
  onConfirmed?: (prompt: AiCreditsPrompt) => void
  now: Date
  freeCreditsLeft?: typeof readFreeAiCreditsLeft
}): Promise<AiJobAdmissionRefusal | null> {
  const read = input.freeCreditsLeft ?? readFreeAiCreditsLeft
  const credits = await read(input.firestore, { orgId: input.orgId, org: input.org, now: input.now })
  if (!credits) return null
  if (credits.left <= 0) return { status: 429, error: aiFreeCreditsNoneLeftText(credits.resetsOn) }
  const prompt = aiCreditsPromptFor(input.range, credits, input.smaller ?? null)
  if (!prompt) return null
  if (!input.confirmed) {
    return { status: 409, error: aiCreditsPromptText(prompt, 'build'), code: AI_CREDITS_CONFIRM_CODE, credits: prompt }
  }
  input.onConfirmed?.(prompt)
  return null
}

export interface AiBuildAdmissionDeps {
  opsFor?: (context: AiBuildOpsContext) => Promise<AiBuildOps>
  freeCreditsLeft?: typeof readFreeAiCreditsLeft
  ownerOf?: typeof resolveOrgIdForHost
  now?: () => Date
}

/**
 * A build is admitted for a site of the job's own org where a page can be
 * built; and confirmed only for a plan it can build here — its shape, its
 * operations as this site has them, and on the Free taste a measured p90
 * the month's Free credits still cover — or the person's go-ahead to build
 * what fits (AGL-3722).
 */
export function createAiBuildJobAdmission(deps: AiBuildAdmissionDeps = {}): AiJobAdmission {
  const opsFor = deps.opsFor ?? ((context) => aiBuildOps(context))
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  return async (context) => {
    if (!context.hostId) return { status: 400, error: 'Open the site to build on before asking Assist to build' }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    if (!aiJobStepRunnerFor('page')) return { status: 400, error: 'Building from a request is not available yet.' }
    const plan = context.plan
    if (!plan) return null
    const org = context.org as Partial<AglynOrgBilling> | null
    const freeTaste = aiBuildFreeTaste(org)
    const host = await readHost(context.firestore, context.hostId)
    const ops = await opsFor({ orgId: context.orgId, hostId: context.hostId, org, host, freeTaste })
    const shape = aiBuildPlanShapeRefusal(plan, { freeTaste, ops })
    if (shape) return { status: 400, error: shape }
    // Something only the person can give (AGL-3751): asked, never built
    // without. The plan step waits for it in `needs_input` (AGL-3978).
    const missing = aiBuildPlanMissingInput(plan, ops)
    if (missing) return { status: 400, error: missing, code: AI_BUILD_NEEDS_INPUT_CODE }
    if (freeTaste) {
      const refusal = await aiBuildFreeCreditsRefusal({
        firestore: context.firestore,
        orgId: context.orgId,
        org,
        range: aiBuildCreditRange(plan, { ops }),
        smaller: aiBuildSmaller(plan, ops),
        confirmed: context.creditsConfirmed === true,
        onConfirmed: context.onCreditsConfirmed,
        now: deps.now?.() ?? new Date(),
        freeCreditsLeft: deps.freeCreditsLeft,
      })
      if (refusal) return refusal
    }
    return null
  }
}

export const aiBuildJobAdmission = createAiBuildJobAdmission()

/**
 * Registers the build with the least time a pass needs, the time its next
 * pass needs, the passes its largest plan may take, and its admission.
 */
export function registerAiBuildJob(): void {
  registerAiJobStep('build', runAiJobBuildStep, {
    minimumMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
    minimumMsFor: aiBuildJobRunMinimumMs,
  })
  registerAiJobStepPasses('build', AI_BUILD_MAX_PASSES)
  registerAiJobAdmission('build', aiBuildJobAdmission)
}
