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

import { aiSiteKindOfInputs } from '../model/ai-site-kinds'
import { aiSiteHomeArc, aiSiteHomeArcSentence, type AiSiteHomeArc } from '../model/ai-site-home-arcs'
import { aiSiteSeed } from '../model/ai-site-look'
import { AI_SITE_INSPIRATION_INPUT } from '../model/ai-site-inspiration'
import {
  aiSiteInspirationBriefHasFigures,
  aiSiteInspirationHomeOrder,
  aiSiteInspirationPlanLines,
  readAiJobSiteInspiration,
  type AiSiteInspirationReader,
  type AiSiteInspirationStart,
} from './ai-site-inspiration'
import type { AiSiteInspiration } from './ai-site-inspiration-signals'
import { createHash } from 'node:crypto'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  AI_BUILD_PLAN_TOOL,
  aiBuildPlanToolFor,
  aiPlanSlugKey,
  isAiPlanNewRef,
  type AiBuildPlan,
} from '../model/ai-build-plan'
import type { AiJob, AiJobKind, AiJobPlan, AiJobReview, AiJobStatus } from '../model/ai-jobs.types'
import { AI_BUILD_PRODUCT_OP, aiBuildStorePagesFor } from '../model/ai-build-store-pages'
import { readFreeAiCreditsLeft } from '../usage/free-ai-credits-left'
import {
  AI_TEMPLATE_SUBJECT_DEFINITIONS,
  aiTemplateShownTokens,
  type AiTemplateSubject,
} from '../model/ai-template-subjects'
import { AI_JOB_CREATE_KINDS, AI_JOB_CREATE_NOUNS } from '../model/ai-job-creations'
import { AI_PAGE_CREATE_KINDS, aiPagePlanShapeRefusal } from '../model/ai-page-job'
import {
  AI_PLAN_COMPILED_REPEATS_SENTENCE,
  AI_PLAN_NO_FORM_SENTENCE,
  aiPlanCanPlaceForm,
  aiPlanCapabilitiesForJob,
  aiPlanCapabilityLines,
  type AiPlanCapabilities,
  type AiPlanJobScope,
} from '../model/ai-plan-capabilities'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import {
  aiSettleSiteForeignDatasets,
  aiSiteInventoryWithRecordCounts,
  aiSitePlanDatasetCapability,
  type AiDatasetRecordCounter,
} from './ai-job-site-datasets'
import {
  AI_FREE_SITE_WORST_CASE_CREDITS,
  AI_SITE_CREATE_KINDS,
  AI_SITE_FREE_PAGES,
  AI_SITE_FREE_POSTS,
  AI_SITE_PLAN_MAX_TOKENS,
  AI_SITE_HOME_BANDS,
  aiFreeSiteSectionsWithin,
  aiSiteFullPlanSentence,
  aiSiteHomeMinSections,
  aiSiteNameSentence,
  aiSitePlanIsHome,
  aiSitePlanShapeRefusal,
  aiSiteBlogStandInViolations,
  aiSiteThinHomeViolations,
  AI_SITE_GALLERY_SENTENCE,
  aiSiteEmptyGalleryViolations,
  AI_SITE_DATASETS_MAX,
  AI_SITE_GALLERY_MIN_ITEMS,
} from '../model/ai-site-job'
import { aiSiteContentPart } from './ai-job-site-content'
import {
  aiPlanHasCustomerWords,
  aiSettlePlanPlaceholderNames,
  aiSettlePlanSaidSections,
} from '../model/ai-plan-said-sections'
import { aiLayoutIsShopPage, aiLayoutShopGridSection } from '../layout-language/ai-layout-listings'
import { aiLayoutSpeaksOtherThanEnglish } from '../layout-language/ai-layout-labels'
import { aiStorefrontPlanScreens } from '../layout-language/ai-layout-storefront'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { aiPlanFailureCopy, aiPlanRetryRefusal } from '../model/ai-job-failure-copy'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import { aiDoctrineSystemBlocks, runValidatedGeneration } from '../runtime/ai-doctrine'
import { AI_STEP_TIERS, aiCatalogEntry, aiDefaultModelFor } from '../providers/catalog'
import {
  AI_FREE_PAGE_WORST_CASE_CREDITS,
  aiPlanEmbedBriefViolations,
  aiSettlePlanDatasets,
  aiSettlePlanHomeForms,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { ASSIST_RETURNED_USD_FIELD, assistSpendAfterReturnsUsd } from '../usage/assist-credit-returns'
import { freeAccountUsageRef, freeAssistAccount, type AssistMeteredOrg } from '../usage/assist-free-taste'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import type { AiEffort, AiTool } from '../providers/contract'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import { readAiSiteContext } from '../runtime/site-context'
import { aiInstructionsWithSiteContext, type AiSiteContextInput } from '../model/ai-site-context'
import {
  AI_BUILD_CREATE_KINDS,
  AI_BUILD_NEEDS_INPUT_CODE,
  AI_BUILD_STRUCTURAL_OPS,
  aiBuildPageLimit,
  aiBuildPlanInputFields,
  aiBuildPlanShapeRefusal,
  type AiBuildOps,
} from '../model/ai-build-job'
import { aiBuildOpLines, aiBuildOps } from './ai-build-capabilities'
import { aiBuildUnlistedEventsCheck, aiSettleBuildEventPage } from '../model/ai-build-event-page'
import {
  aiSiteEventItemsCheck,
  aiSiteEventPlanLines,
  readAiSiteEventPlanning,
  type AiSiteEventPlanning,
} from './ai-job-site-events'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_CREDITS_CONFIRM_CODE } from '../model/ai-credit-estimate'
import { readAiPlanCapabilities } from './ai-job-drafts'
import {
  AI_JOB_BRIEF_MAX_CHARS,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import { aiJobStepBudget } from './ai-job-budget'
import { aiDoctrineReview, aiUnspentOutcome } from './ai-job-generation'
import { aiOriginJobId, aiPlanWithDraftIds } from './ai-job-draft-ids'
import { AI_JOBS_COLLECTION, registerAiJobPlanStep } from './ai-jobs'

/**
 * The plan step (AGL-2935): the first step of every job that builds site
 * structure. Before a node is generated, the model answers with a typed plan
 * — what the site already has that the job reuses, what it creates and why,
 * and the screens it builds from them — held to the doctrine's plan rules
 * against the site's inventory and re-asked once when it breaks one.
 *
 * A plan that passes is kept on the job, and the job stops for review: the
 * member reads what it will build before a credit is spent building it, and
 * confirms through the resume door. A plan that still breaks a rule on its
 * re-ask stops the job the same way, with the rules named. Either way the
 * step writes nothing itself; the machine records the plan, the spend and
 * the stop, as it records every step.
 *
 * ── Told what it may create, refused what it cannot build (AGL-3030) ─────
 *
 * Before it asks, the step reads what the job may create on its site: the
 * workspace's plan, the site's counts against its limits, and — for a kind
 * that builds only some plans — what the job builds itself. The user turn
 * states it, the plan rules refuse a creation outside it with the one re-ask,
 * and where the workspace keeps no reusable components they accept the page
 * built inline. A plan the confirm door would still refuse — the kind's own
 * admission, handed the plan, as the resume door hands it — is refused HERE,
 * before a member is shown a Confirm: the job fails with the door's sentence,
 * its plan is not kept, and it holds nothing.
 */

/** The plan step's own instructions, cached after the doctrine. */
export const AI_JOB_PLAN_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text:
      'You plan what a website builder job will build, before anything is built. You are given the kind of job and the brief from the person who owns the site. ' +
      'Answer with submit_build_plan: what the site inventory already has that the job reuses, what it must create and why nothing listed will do, and each page it builds (the screens list) with its layout, template, slug, search title, search description and sections from top to bottom. ' +
      'Refer to inventory records by id and to what the plan creates as new:<name>. Plan only what the brief asks for: a component, layout, template, form or email job plans no pages unless the brief asks for them, and a page job plans exactly one page.',
  },
]

/**
 * The plan step's time (AGL-3026, AGL-3036): its two inventory-lookup rounds,
 * its answer and its re-ask at the routing table's ceiling for `job.plan`, on
 * the tier that step kind is served from, with the step's reads and writes,
 * at the rates `ai-job-budget.ts` assumes — fitted to what a beat can give a
 * step, so the served tier asks a little under the routing ceiling.
 */
export const AI_JOB_PLAN_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.plan'],
  maxTokens: AI_ROUTING_TABLE['job.plan'].maxTokens,
})

/**
 * The least time a plan needs before it starts. Registered with the step, so
 * an inline door never starts a plan. A plan thinks before it answers and
 * routinely runs past an inline door's budget, and a provider call that
 * budget cuts off is still generated and billed upstream while the meter
 * records nothing. The beat starts a plan only with this much of its own
 * budget left, and a spec holds it inside that budget.
 */
export const AI_JOB_PLAN_STEP_MINIMUM_MS = AI_JOB_PLAN_STEP_BUDGET.minimumMs

/**
 * The plan's answer ceiling on the model a job runs: the most whose worst
 * case fits the least time the step registered, and never more than the
 * routing table's. A model the catalog does not know is planned at the
 * slowest.
 */
export function aiJobPlanMaxTokens(model: string): number {
  return AI_JOB_PLAN_STEP_BUDGET.maxTokens(model)
}

/** What the member reads while a plan waits for them. */
export const AI_JOB_PLAN_REVIEW_COPY =
  'The plan is ready. Review what the job will reuse and create, then confirm it to build.'

/**
 * The job as the plan step's user turn: its kind, its brief, its scalar
 * inputs and, where the job read them, what it may create on its site
 * (AGL-3030). Per workspace and per site, which is why they ride here and
 * never in a system block the platform's cache entry is keyed on.
 */
export function aiJobPlanPrompt(
  job: Pick<AiJob, 'kind' | 'brief' | 'inputs'> & Partial<Pick<AiJob, '$id'>>,
  capabilities: AiPlanCapabilities | null = null,
  inventory: AiSiteInventory | null = null,
  ops: AiBuildOps | null = null,
  now: Date | null = null,
  options: AiPlanSiteOptions = {},
): string {
  const lines = [`Job kind: ${job.kind}`, `Brief: ${job.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`]
  for (const [key, value] of Object.entries(job.inputs ?? {})) {
    // The sites a person likes are read by code, never shown (AGL-3975).
    if (key === AI_SITE_INSPIRATION_INPUT) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`)
    }
  }
  if (capabilities) lines.push(...aiPlanCapabilityLines(capabilities))
  // A form is a saved form or none (AGL-3596): said where the site read has
  // none to place and the job may create none.
  if (capabilities && inventory && !aiPlanCanPlaceForm(inventory, capabilities)) {
    lines.push(AI_PLAN_NO_FORM_SENTENCE)
  }
  lines.push(...aiPlanTemplateTokenLines(job))
  lines.push(...aiPlanSiteLines(job, inventory, capabilities, options))
  lines.push(...aiPlanBuildLines(job, capabilities, ops, now))
  return lines.join('\n')
}

/** What a site plan's turn is told beyond its job (AGL-3975). */
export interface AiPlanSiteOptions {
  /**
   * The sites the person likes give the home its order (`aiSiteInspirationHomeOrder`),
   * so the seeded home arc (AGL-3899) is not stated beside it.
   */
  ownOrder?: boolean
}

/**
 * What a BUILD job's plan is told (AGL-3616): that one request becomes pages,
 * creations and items, how many pages it may hold, and the item operations
 * this site has with their arguments. On the job's own turn, never a cached
 * system block, because the operations are per site.
 */
export function aiPlanBuildLines(
  job: Pick<AiJob, 'kind'>,
  capabilities: AiPlanCapabilities | null,
  ops: AiBuildOps | null,
  now: Date | null = null,
): string[] {
  if (job.kind !== 'build') return []
  const pages = aiBuildPageLimit(capabilities?.freeTaste === true)
  return [
    `This is a build from one request: plan each page it asks for in screens (at most ${pages}), each new layout, form, component or email design in create, and anything else in items. Plan only what the request asks for; reuse what the site has.`,
    'A page section that shows a form or an item places it: put its new:<name> in that section\'s uses. An item built after another lists it in dependsOn.',
    // The layout language draws a section's repeated items (AGL-3660), so the
    // doctrine's "repeated items place a component" is not asked of a build.
    ...(capabilities?.repeatsCompiled ? [AI_PLAN_COMPILED_REPEATS_SENTENCE] : []),
    ...(ops ? aiBuildOpLines(ops, AI_BUILD_STRUCTURAL_OPS) : []),
    // An item with a date (an event, AGL-3743) is dated after the build.
    ...(now ? [aiPlanTodaySentence(now)] : []),
  ]
}

/** The build's date, so a dated item falls after it (AGL-3743). */
export function aiPlanTodaySentence(now: Date): string {
  return `Today is ${now.toISOString().slice(0, 10)} (UTC). Anything an item dates, such as an event, falls after today.`
}

/**
 * What a SITE job's plan is told beside the inventory (AGL-3594): the pages
 * the site already has and that their addresses are taken, which one — the
 * untouched starter home — a planned home page at `/` replaces, the Free page
 * cap and its guidance, and that a plan is an outline.
 *
 * A site job only. A new site is born with a published home page at `/`
 * (AGL-3497), and a plan that did not know it could replace it planned its own
 * home there and was refused for the clash on every new site. Kept off a page
 * job's turn, whose length the Free page's wall is proven at.
 */
export function aiPlanSiteLines(
  job: Pick<AiJob, 'kind'> & Partial<Pick<AiJob, 'inputs' | 'brief' | '$id'>>,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null,
  options: AiPlanSiteOptions = {},
): string[] {
  if (job.kind !== 'site') return []
  const lines: string[] = []
  // The business's own name, as the name to use (AGL-3596): the plan's search
  // titles carry it, and an input line alone left the model free to coin one.
  const name = job.inputs?.['businessName']
  if (typeof name === 'string' && name.trim()) lines.push(aiSiteNameSentence(name.trim()))
  const pages = (inventory?.screens ?? []).filter((screen) => !screen.template)
  const starter = pages.find((screen) => screen.replaceable)
  if (pages.length) {
    lines.push('Pages the site already has; their addresses are taken unless a line says otherwise:')
    for (const page of pages) {
      lines.push(
        page.replaceable
          ? `- ${page.name} at ${page.slug}: the starter home page the site was created with. Plan this site's home page at / and it replaces this one.`
          : `- ${page.name} at ${page.slug}`,
      )
    }
    if (!starter && pages.some((page) => page.slug.trim() === '/' || page.slug.trim() === '')) {
      lines.push("The home page at / is the owner's own and stays: give every page you plan another address.")
    }
  }
  const cap = capabilities?.freeSitePages
  const home = aiSitePlanHomeRule(inventory, capabilities)
  // The form lives on the page a visitor opens to get in touch (AGL-3899),
  // and the home's call to action links it; a one-page site keeps it home.
  const formOnHome = aiSiteFormStaysHome(job, cap)
  if (cap !== undefined) {
    const where = formOnHome ? ' Put the contact form on the home page.' : ' Put the contact form on the page that is not the home page.'
    lines.push(
      `This is a Free workspace: plan at most ${cap} ${cap === 1 ? 'page' : 'pages'} — the home page at / and the one page the brief most needs, such as services, booking or contact — and ${home.across} sections across them.${aiPlanCanPlaceForm(inventory, capabilities) ? where : ''}`,
    )
  }
  // A new site is a full website (AGL-3660): its home is planned as one, not
  // left to a ceiling the outline is free to stay far under.
  const plansHome = !pages.some((page) => !page.replaceable && aiSitePlanIsHome(page))
  if (home.min > 0 && plansHome) {
    // A store's home is a storefront (AGL-3676): its own parts.
    const bands = aiSiteKindOfInputs(job.inputs)?.id === 'store' ? AI_SITE_STORE_HOME_BANDS : AI_SITE_HOME_BANDS
    lines.push(`The home page at / reads as a full website: at least ${home.min} sections — ${bands}.`)
    // And its own arc, chosen by the job's seed (AGL-3899): two identical
    // briefs are two different homes. A start whose person named sites they
    // like takes its order from them instead (AGL-3975).
    const arc = options.ownOrder ? null : aiSitePlanHomeArc(job)
    if (arc) lines.push(aiSiteHomeArcSentence(arc))
  }
  // The sections are a budget to use (AGL-3660): a prod start of 2026-10-08
  // read "at most 8" as leave to plan a home of two.
  lines.push(aiSiteFullPlanSentence({ pages: cap ?? 1, across: home.across, min: plansHome ? home.min : 0 }))
  // A blog's first posts — a Free blog's one (AGL-3798) — are written at /blog
  // and linked from the header (AGL-3660, AGL-3676), so the plan plans no
  // page standing in for it.
  if (aiSiteContentPart(job.inputs ?? null, capabilities?.freeTaste === true) === 'posts') {
    lines.push(
      "This site's blog is written for it with its first posts at /blog, and the header links it. Plan no page that stands in for it (no Blog, Articles, Journal, Posts or Stories page); feature the posts in a section of the home page instead.",
    )
  }
  // A paid store's account, cart and policy pages are added by the platform,
  // outside the plan's pages (AGL-3676), so the plan spends none of its pages on them.
  if (aiSiteContentPart(job.inputs ?? null, capabilities?.freeTaste === true) === 'products') {
    lines.push(AI_SITE_STORE_PAGES_SENTENCE)
  }
  // A section that shows the work counts its pieces (AGL-3660): a planned
  // gallery of no items let a page about the work show none.
  lines.push(AI_SITE_GALLERY_SENTENCE)
  // No section of customer words the site has none of (AGL-3887); the plan
  // is settled to this in code as well (`aiSettlePlanSaidSections`).
  if (!aiPlanHasCustomerWords({ brief: job.brief, inventory, siteKind: aiSiteKindOfInputs(job.inputs)?.id })) {
    lines.push(AI_SITE_NO_CUSTOMER_WORDS_SENTENCE)
  }
  // A section that asks for something places the form (AGL-3660): a live
  // portfolio start planned a commissions inquiry beside the form it made
  // for its Contact page, without placing it.
  if (aiPlanCanPlaceForm(inventory, capabilities)) lines.push(aiSiteFormSentence(formOnHome))
  // As many items as the content has (AGL-3899): 47 of 55 groups in the
  // newest production homes showed exactly three.
  lines.push(AI_SITE_ITEMS_SENTENCE)
  // Structured content is kept as a dataset where one may be made (AGL-3616).
  if (capabilities?.create.dataset.allowed) {
    lines.push(aiSiteDatasetSentence(Math.min(capabilities.datasetsMax ?? AI_SITE_DATASETS_MAX, capabilities.create.dataset.left ?? AI_SITE_DATASETS_MAX)))
  }
  // The kind of site the person picked (AGL-3660): the pages it usually has.
  const kind = aiSiteKindOfInputs(job.inputs)
  if (kind) lines.push(`This is a ${kind.label.toLowerCase()} site. ${kind.pages}`)
  // A store's Shop page IS its storefront (AGL-3676): the platform lists the
  // real products there, so the plan names the section and draws no range.
  if (kind?.id === 'store') lines.push(AI_SITE_STORE_SHOP_SENTENCE)
  lines.push(
    "Keep the plan an outline: each page's title, address, a short search title and description, and its sections named in a few words. The build writes the copy.",
  )
  return lines
}

/**
 * The settling every plan is given before the doctrine reads it (AGL-3887):
 * no section named a placeholder, and on a site start, where the site and
 * the brief have no customer words, no section of them
 * (`aiSettlePlanSaidSections`). Only a site start's sections are recast: a
 * page or a build may plan a page the owner's own quotes are already on.
 */
export function aiPlanSaidSettle(
  job: Pick<AiJob, 'kind' | 'brief' | 'inputs'>,
  inventory: AiSiteInventory | null,
  homeMin: number,
): (plan: AiBuildPlan) => AiBuildPlan {
  if (job.kind !== 'site') return aiSettlePlanPlaceholderNames
  const hasCustomerWords = aiPlanHasCustomerWords({
    brief: job.brief,
    inventory,
    siteKind: aiSiteKindOfInputs(job.inputs)?.id,
  })
  return (plan) => aiSettlePlanSaidSections(aiSettlePlanPlaceholderNames(plan), { hasCustomerWords, homeMin })
}

/**
 * What a site plan is told where the site has no customer words (AGL-3887):
 * no section of them, and the band to plan in its place.
 */
export const AI_SITE_NO_CUSTOMER_WORDS_SENTENCE =
  'This site has no reviews or testimonials yet, and the build never writes them: plan no testimonials, reviews or client feedback section, and plan what working together is like instead. Never name a section a placeholder.'

/**
 * The sentence a site plan's turn states about a section that collects
 * answers (AGL-3660): it places the saved form by reference — on the page a
 * visitor opens to get in touch, never on the home page as well (AGL-3899).
 * Told "one form may be placed on several pages", 17 of the 22 newest
 * production homes carried the contact form, 16 of them in their last band,
 * so every site ended the same way.
 */
export const AI_SITE_FORM_SENTENCE =
  "A section that asks visitors for something (contact, inquiry, commissions, booking, sign-up) places the form: put new:<the form's name> or the site's form id in its uses."

/** Where the form goes, said after {@link AI_SITE_FORM_SENTENCE} on a site whose home does not keep it. */
export const AI_SITE_FORM_PAGE_SENTENCE =
  "Place it on the page a visitor opens to get in touch (such as Contact, Book, Visit or Enroll), and nowhere on the home page: the home's call to action is a button to that page."

/** What a site plan is told about its form: where it goes, as {@link aiSiteFormStaysHome} decides. */
export function aiSiteFormSentence(onHome: boolean): string {
  return onHome ? AI_SITE_FORM_SENTENCE : `${AI_SITE_FORM_SENTENCE} ${AI_SITE_FORM_PAGE_SENTENCE}`
}

/**
 * What a site plan is told about repeated items (AGL-3899): as many as the
 * content has. Told nothing, the newest production plans gave 45 of 62 home
 * groups three items, and the pages drew 47 of 55 groups with three.
 */
export const AI_SITE_ITEMS_SENTENCE =
  'Give each section that repeats items as many as its content has, from 2 to 6 (two offers, four steps, five questions, six pieces of work): vary the counts from section to section, never 3 everywhere.'

/** The kinds whose one action is the form on the home page: a landing page and a coming-soon page. */
const AI_SITE_FORM_HOME_KINDS: ReadonlySet<string> = new Set(['landing', 'coming-soon'])

/**
 * A brief that asks for the form on the home page itself, in one sentence:
 * "a sign-up form on the home page", "the homepage should have a contact form".
 */
const HOME_FORM_ASKED =
  /\b(?:home ?page|front page|main page)\b[^.!?\n]{0,60}\bform\b|\bform\b[^.!?\n]{0,60}\b(?:home ?page|front page|main page)\b/i

/**
 * Whether a site start's home keeps its form (AGL-3899): a one-page site, a
 * kind whose one action is that form (a landing or coming-soon page), or a
 * brief that asks for it there. Every other start places the form on the
 * page a visitor opens to get in touch, and its home closes with a call to
 * action that links it (`aiSettlePlanHomeForms`).
 */
export function aiSiteFormStaysHome(job: Partial<Pick<AiJob, 'inputs' | 'brief'>>, freePages?: number): boolean {
  const asked = Number(job.inputs?.['pages'])
  // A Free start's pages are its capped band (`freeSitePages`), else the pages asked for.
  const pages = freePages ?? (Number.isInteger(asked) && asked > 0 ? asked : null)
  if (pages === 1) return true
  const kind = aiSiteKindOfInputs(job.inputs)?.id
  if (kind && AI_SITE_FORM_HOME_KINDS.has(kind)) return true
  return HOME_FORM_ASKED.test(job.brief ?? '')
}

/** The home arc a site start's plan is told (AGL-3899), by its job's seed; `null` for a job with no id. */
export function aiSitePlanHomeArc(job: Partial<Pick<AiJob, '$id' | 'inputs'>>): AiSiteHomeArc | null {
  if (!job.$id) return null
  return aiSiteHomeArc({
    kind: aiSiteKindOfInputs(job.inputs)?.id ?? null,
    seed: aiSiteSeed(aiOriginJobId({ $id: job.$id, inputs: job.inputs ?? {} })),
  })
}

/**
 * The sentence a site plan's turn states where it may create datasets, with
 * how many it may (the live eval of 2026-10-10 planned four past a cap of
 * three it was never told)
 * (AGL-3616): a list of like things is kept as one, named in the sections
 * that list it, and a page of its own per record is that dataset's record
 * template. Only where datasets may be made, so a Free plan's turn, whose
 * length its wall is proven at, is unchanged.
 */
export function aiSiteDatasetSentence(max: number): string {
  return `Keep structured content as a dataset, at most ${max} ${max === 1 ? 'dataset' : 'datasets'}, and only for a list of 4 or more similar items: a menu, a team, services, portfolio pieces, events, questions and answers; never reviews or testimonials. Create the dataset, its fields the items' field names, and put new:<the dataset's name> in the uses of each section that lists them; the platform lists its records there. Where each item deserves a page of its own, plan one page as the dataset's record template. Anything else stays written on its page. ${AI_SITE_FORM_DATASET_SENTENCE}`
}

/**
 * What a paid site plan is told about a form that writes to a dataset
 * (AGL-3616, Zach 2026-10-10): only where the person would want each
 * submission kept as a record, the dataset created with the form's own
 * field names, and never listed, because its records are the people who
 * sent the form.
 */
export const AI_SITE_FORM_DATASET_SENTENCE =
  "Where each submission of the form should also be kept as a record (volunteer sign-ups, RSVPs, inquiries), the form writes to a dataset: create the dataset, its fields the form's field names, and set the form's writesTo to new:<the dataset's name>; that dataset counts toward the same limit and no section lists it. Otherwise writesTo is null."


/**
 * What a site start's home page is held to (AGL-3660): its fewest sections,
 * and on the Free taste the sections the wall fits across the pages, which
 * the home's count is shared out of. The plan's turn and its re-ask read this
 * one figure, so the sentence the model is told is the check it is held to.
 */
export function aiSitePlanHomeRule(
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null,
): { min: number; across: number | null } {
  const cap = capabilities?.freeSitePages
  if (cap === undefined) return { min: aiSiteHomeMinSections({ pages: 1, across: null }), across: null }
  // Dear: a guided start that places a form makes one (AGL-3596).
  const across = aiFreeSiteSectionsWithin(
    { layouts: (inventory?.layouts.length ?? 0) ? 0 : 1, pages: cap, forms: 1, posts: capabilities?.freeSitePosts ?? 0 },
    FREE_AI_TASTE_CREDITS_PER_MONTH,
  )
  return { min: aiSiteHomeMinSections({ pages: cap, across }), across }
}

/**
 * A site plan's thin home, asked about on the FIRST answer only (AGL-3660).
 * The re-ask names the count; an answer that still plans a thinner home is
 * kept, since a home with four sections is a site and a stopped start is
 * none — the same trade a language page makes with its last answer's gaps.
 */
export function aiSiteThinHomeCheck(
  rule: { min: number; across: number | null },
): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  let answers = 0
  return (plan) => {
    answers += 1
    if (answers >= AI_GENERATION_MAX_ATTEMPTS) return []
    return aiSiteThinHomeViolations(plan, rule)
  }
}

/** What a store's plan is told about its Shop page (AGL-3676). */
export const AI_SITE_STORE_SHOP_SENTENCE =
  'Plan a Shop page at /shop: a short title section, then a section named "Product grid" second, where the platform lists the store\'s real products with sort, filters, photos, prices and cart, then at most one or two short sections (care, shipping, gifting help). Never open it with a hero, and never plan the products themselves as cards of your own.'

/** What a paid store's plan is told about the pages the platform adds beside it (AGL-3676). */
export const AI_SITE_STORE_PAGES_SENTENCE =
  "The platform adds this store's account page (sign in, orders, saved items), its cart page, and its Shipping & returns, Privacy policy and Terms of sale pages, and links them in the header and footer; they do not count toward this plan's pages. Plan none of them: spend every page on what the brief is about."

/**
 * What a store's home is composed of (AGL-3676): a storefront's parts, the
 * hero first and the sign-up last, between them in the order its arc gives
 * (AGL-3899).
 */
export const AI_SITE_STORE_HOME_BANDS =
  'a hero that sells first and a "Newsletter sign-up" band last, and between them "Bestsellers" (the platform lists the real products), "Shop by collection" with 3 or 4 items, the brand story, why buy here with 3 or 4 items and "Customer reviews" (the platform shows the store\'s real ones)'

/**
 * A store plan held to a storefront (AGL-3676, `ai-layout-storefront.ts`):
 * on a paid start its home gains the parts a shopper expects that the plan
 * left out — bestsellers, collections, reviews, a newsletter sign-up —
 * while the page has room; on any start its Shop page opens on its grid.
 * Settled, never re-asked: each part has one answer, and the Free wall's
 * home keeps the sections it planned.
 */
export function aiSiteStorefrontPlan<P extends Pick<AiBuildPlan, 'screens'>>(plan: P, options: { paid: boolean }): P {
  const screens = aiStorefrontPlanScreens(plan.screens, {
    paid: options.paid,
    isShopPage: aiLayoutIsShopPage,
    gridSection: aiLayoutShopGridSection,
  })
  return screens.every((screen, index) => screen === plan.screens[index]) ? plan : { ...plan, screens }
}

/** The code a store plan with no Shop page is re-asked under. */
export const AI_SITE_STORE_SHOP_CODE = 'plan-store-shop-page'

/**
 * A store plan of two or more pages with no Shop page (AGL-3676): the page
 * the platform lists the catalog on is the one a shopper looks for. A
 * one-page Free taste lists its products on the home instead.
 */
export function aiSiteStoreShopPageViolations(
  plan: Pick<AiBuildPlan, 'screens'>,
): Array<{ rule: null; code: string; message: string; paths: string[] }> {
  if (plan.screens.length < 2 || plan.screens.some((screen) => aiLayoutIsShopPage(screen))) return []
  return [
    {
      rule: null,
      code: AI_SITE_STORE_SHOP_CODE,
      message:
        'This store has no Shop page. Plan one at /shop, its second section named "Product grid": the platform lists the real products there.',
      paths: ['screens'],
    },
  ]
}

/** A store plan's missing Shop page, asked about on the FIRST answer only, like a thin home. */
export function aiSiteStoreShopCheck(): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  let answers = 0
  return (plan) => {
    answers += 1
    if (answers >= AI_GENERATION_MAX_ATTEMPTS) return []
    return aiSiteStoreShopPageViolations(plan)
  }
}

/**
 * A site plan's section that shows the work without its pieces (AGL-3660),
 * asked about on the FIRST answer only, like a thin home: the re-ask names
 * the section, and an answer that keeps it thin is kept. A site start's plan
 * is given its fewest pieces in code first (`aiSettlePlanGalleries`,
 * AGL-3754), so this is the backstop for a section that settle leaves: one
 * item of a list split into sections.
 */
export function aiSiteEmptyGalleryCheck(): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  let answers = 0
  return (plan) => {
    answers += 1
    if (answers >= AI_GENERATION_MAX_ATTEMPTS) return []
    return aiSiteEmptyGalleryViolations(plan)
  }
}

/**
 * A site plan's page standing in for the blog its start writes (AGL-3660),
 * asked about on the FIRST answer only, like a thin home: the re-ask names
 * the page, and an answer that keeps it is kept — the posts then take the
 * next address the page leaves free, and the header links them all the same.
 */
export function aiSiteBlogStandInCheck(): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  let answers = 0
  return (plan) => {
    answers += 1
    if (answers >= AI_GENERATION_MAX_ATTEMPTS) return []
    return aiSiteBlogStandInViolations(plan)
  }
}

/** The code a site plan in another language with no English photo words is re-asked under. */
export const AI_SITE_PHOTO_WORDS_CODE = 'plan-photo-words'

/**
 * A site plan in another language that gave no English photo words
 * (AGL-3779): its stock photos have nothing in English to be searched by, and
 * two Spanish bakeries' heroes, searched by their kind of site, took a coffee
 * mug. Missing covers null, left out, and words the plan's reader dropped as
 * not plain English ("panadería pasteles"). An English plan, and one whose
 * language is unknown, owes none.
 */
export function aiSitePhotoWordsViolations(plan: Pick<AiBuildPlan, 'language' | 'photoWords'>): AiDoctrineViolation[] {
  if (!aiLayoutSpeaksOtherThanEnglish(plan.language) || plan.photoWords) return []
  return [
    {
      rule: null,
      code: AI_SITE_PHOTO_WORDS_CODE,
      message: `This plan's language is ${plan.language}, so photoWords is required: 2-4 plain English words, the kind of business first, then what it sells (e.g. florist wedding bouquets), never a place or the business name.`,
      paths: ['photoWords'],
    },
  ]
}

/**
 * A site plan's missing English photo words, asked about on the FIRST answer
 * only, like a thin home: an answer that still gives none is kept, and its
 * photos fall back to its business type in English, else its kind of site
 * (`aiStockSourceTerms`), since a start stopped over its photo words would be
 * no site at all.
 */
export function aiSitePhotoWordsCheck(): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  let answers = 0
  return (plan) => {
    answers += 1
    if (answers >= AI_GENERATION_MAX_ATTEMPTS) return []
    return aiSitePhotoWordsViolations(plan)
  }
}

/**
 * What a TEMPLATE job's plan is told its creation's `fields` are (AGL-3143
 * §11): the subject's binding tokens, listed so the planner promises only
 * what the page can fill and the build can be held to it
 * (`aiPlanTemplateTokenViolations`).
 *
 * ⛔ It rides the job's own turn and NOT the `fields` description in the plan
 * tool, which every kind's request caches. Written there it read better and
 * cost 40 tokens of the shared prefix — 2,980 to 3,020 — which is one credit
 * of the Free page's 300-credit wall, taking the room it keeps for a re-asked
 * section from 45 credits to 44 and breaking `ai-job-free-page.spec.ts`. A
 * page job must not pay for a sentence about templates.
 *
 * The list is the tokens a reader sees, never the whole catalog (AGL-3143
 * §16). Offered a slug and the publish timestamp, a live plan promised them,
 * and its build kept the promise the only way a slug can be kept: it printed
 * "entry slug: {{entry.slug}}" on every article.
 */
export function aiPlanTemplateTokenLines(job: Pick<AiJob, 'kind' | 'inputs'>): string[] {
  if (job.kind !== 'template') return []
  const subject = (job.inputs ?? {})['subject']
  const definition =
    typeof subject === 'string'
      ? AI_TEMPLATE_SUBJECT_DEFINITIONS[subject as AiTemplateSubject]
      : undefined
  if (!definition) return []
  return [
    `The template's fields are the binding tokens its page shows a reader, each one of: ${aiTemplateShownTokens(
      definition,
    ).join(', ')}. A link or picture token is shown by the link or picture holding it. Promise only what the page fills.`,
  ]
}

/** A kind that builds only some plans: the creations it makes, and the shapes it refuses. */
export interface AiJobPlanScope extends AiPlanJobScope {
  /** Why a job of the kind cannot build a plan of this shape; `null` when it can. Pure. */
  shapeRefusal: (plan: AiBuildPlan, options?: { freeTaste?: boolean }) => string | null
}

/**
 * The kinds whose confirm door builds only some plans (AGL-3030). A page job
 * builds one screen and a scaffold four to eight; each builds only the
 * creations its list names. A template, layout, component, form or email job
 * builds its own record and what that record places (AGL-3143 §15,
 * `AI_JOB_CREATE_KINDS`), and holds no plan to a shape.
 */
export const AI_JOB_PLAN_SCOPES: Readonly<Partial<Record<AiJobKind, AiJobPlanScope>>> = {
  page: { noun: 'a page job', creates: AI_PAGE_CREATE_KINDS, shapeRefusal: aiPagePlanShapeRefusal },
  // A build from one request (AGL-3616): its operations are judged against
  // the site's registry by the step, which reads it (`aiBuildPlanViolations`).
  build: {
    noun: 'a build',
    creates: AI_BUILD_CREATE_KINDS,
    shapeRefusal: (plan, options) => aiBuildPlanShapeRefusal(plan, { freeTaste: options?.freeTaste }),
  },
  site: { noun: 'a site scaffold', creates: AI_SITE_CREATE_KINDS, shapeRefusal: aiSitePlanShapeRefusal },
  ...Object.fromEntries(
    Object.entries(AI_JOB_CREATE_KINDS).map(([kind, creates]) => [
      kind,
      { noun: AI_JOB_CREATE_NOUNS[kind as AiJobKind] as string, creates, shapeRefusal: () => null },
    ]),
  ),
}

/**
 * What the plan step holds beyond the doctrine's plan rules, as the
 * violations the plan's one re-ask names: the players the plan lists against
 * the brief it answers (AGL-3433), which only this step reads beside the plan,
 * and a kind's shape refusal.
 */
function planViolations(
  scope: AiJobPlanScope | null,
  brief: string,
  freeTaste = false,
  ops: AiBuildOps | null = null,
  home: { min: number; across: number | null } | null = null,
  blog = false,
  site = false,
  store = false,
): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  const thinHome = home && home.min > 0 ? aiSiteThinHomeCheck(home) : null
  const storeShop = store ? aiSiteStoreShopCheck() : null
  const blogStandIn = blog ? aiSiteBlogStandInCheck() : null
  const emptyGallery = site ? aiSiteEmptyGalleryCheck() : null
  const photoWords = site ? aiSitePhotoWordsCheck() : null
  return (plan) => {
    // A build's plan is held to the operations this site has (AGL-3616):
    // an unknown op, arguments its schema refuses, a cycle or a reference
    // nothing makes are re-asked once like every other plan rule.
    const message = ops
      ? aiBuildPlanShapeRefusal(plan, { freeTaste, ops })
      : (scope?.shapeRefusal(plan, { freeTaste }) ?? null)
    return [
      ...aiPlanEmbedBriefViolations(plan, brief),
      ...(message ? [{ rule: null, code: 'plan-job-shape', message }] : []),
      ...(thinHome ? thinHome(plan) : []),
      ...(blogStandIn ? blogStandIn(plan) : []),
      ...(emptyGallery ? emptyGallery(plan) : []),
      ...(storeShop ? storeShop(plan) : []),
      ...(photoWords ? photoWords(plan) : []),
    ]
  }
}

/** The layout a site's pages render in (AGL-3755): its home page's, else its only layout, else none. */
function aiSiteLayoutOf(inventory: AiSiteInventory | null): string | null {
  const home = inventory?.screens.find((screen) => !screen.template && aiPlanSlugKey(screen.slug) === '/')
  if (home?.layoutId) return home.layoutId
  return inventory?.layouts.length === 1 ? (inventory.layouts[0]?.id ?? null) : null
}

/**
 * A site plan's violations with its events' (AGL-3755): its items are only
 * the events it may plan. Every other kind's are as they are.
 */
function aiSiteWithEventItemsCheck(
  violations: (plan: AiBuildPlan) => AiDoctrineViolation[],
  siteEvents: AiSiteEventPlanning | null | undefined,
  ops: AiBuildOps | null = null,
): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  // A build's events left on no page are re-asked once (AGL-3755).
  const unlisted = ops ? aiBuildUnlistedEventsCheck(ops) : null
  const events = siteEvents === undefined ? null : aiSiteEventItemsCheck(siteEvents)
  if (!unlisted && !events) return violations
  return (plan) => [...violations(plan), ...(events ? events(plan) : []), ...(unlisted ? unlisted(plan) : [])]
}

/**
 * The inventory names of every id the plan references, so the proposal reads
 * "the Services layout" rather than an id — kept on the plan because the
 * inventory is not read again when the member opens it.
 */
export function aiPlanLabels(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): Record<string, string> {
  const names = new Map<string, string>()
  for (const rows of [
    inventory?.components,
    inventory?.layouts,
    inventory?.templates,
    inventory?.forms,
    inventory?.datasets,
    inventory?.collections,
    inventory?.screens,
  ]) {
    for (const row of rows ?? []) names.set(row.id, row.name)
  }
  const refs = [
    ...plan.reuse.map((entry) => entry.id),
    ...plan.create.map((entry) => entry.duplicateOf),
    ...plan.screens.flatMap((screen) => [
      screen.layout,
      screen.template,
      screen.duplicateOf,
      ...screen.sections.flatMap((section) => section.uses),
    ]),
  ]
  const labels: Record<string, string> = {}
  for (const ref of refs) {
    if (!ref || isAiPlanNewRef(ref)) continue
    const name = names.get(ref)
    if (name) labels[ref] = name
  }
  return labels
}

/* ------------------------------------------------------------------------ *
 * Reusing an identical brief's plan
 * ------------------------------------------------------------------------ */

/**
 * How long a plan may be reused for (AGL-2937).
 *
 * The window is what makes reuse safe rather than merely cheap. The key
 * already covers everything the request said — the brief, the inputs, the
 * model and the prompt as rendered, site inventory included — so a plan is
 * reused only when nothing the model was shown has changed. What the key
 * cannot see is the world outside the request: a page published, a component
 * renamed after the inventory was read, a member who meant something
 * different the second time. Fifteen minutes is short enough that the answer
 * is still the one the site would give, and long enough to cover what reuse
 * is actually for — the same brief run twice in a sitting, a job resubmitted
 * after a refused reservation, two members starting the same work.
 */
export const AI_PLAN_REUSE_WINDOW_MS = 15 * 60 * 1_000

/** Jobs one lookup reads. More than one can share a key; the newest plan wins. */
export const AI_PLAN_REUSE_CANDIDATES = 5

/** A job whose plan might be reused, as the finder reports it. */
export interface AiJobPlanCandidate {
  jobId: string
  status: AiJobStatus
  plan: AiJobPlan
}

/**
 * The digest a plan is reused by: the whole request, never the answer.
 *
 * It hashes what the model was asked and what it was shown — the job's kind
 * and site, the user turn (which carries the trimmed brief and every scalar
 * input), the model that would answer, every rendered system block including
 * the site inventory, and the tool's schema. Two requests that hash the same
 * would have been sent the same bytes to the same model, so the second can
 * keep the first's answer.
 *
 * The version tag is the escape hatch: anything that changes what a key
 * MEANS, rather than what it covers, bumps it and strands every old key
 * harmlessly, since a key nothing matches simply asks the model.
 */
export function aiJobPlanKey(input: {
  job: Pick<AiJob, 'kind' | 'hostId'>
  prompt: string
  model: string
  system: readonly AiSystemBlock[]
  /** The plan tool the request offers (AGL-3433); the plain one when absent. */
  tool?: AiTool
}): string {
  const digest = createHash('sha256')
  for (const part of [
    'plan.v1',
    input.job.kind,
    input.job.hostId ?? '',
    input.model,
    input.prompt,
    ...input.system.map((block) => block.text),
    JSON.stringify(input.tool ?? AI_BUILD_PLAN_TOOL),
  ]) {
    // Length-prefixed, so two different splits of the same characters cannot
    // collide by running into one another.
    digest.update(`${part.length}:${part}\u0000`)
  }
  return digest.digest('hex')
}

/** A job that could not have produced a reusable plan, whatever its key says. */
const UNREUSABLE: readonly AiJobStatus[] = ['canceled', 'failed']

function planMillis(plan: AiJobPlan): number | null {
  const at = plan.proposedAt as unknown
  if (at instanceof Date) return at.getTime()
  if (at && typeof (at as { toMillis?: unknown }).toMillis === 'function') {
    return (at as { toMillis(): number }).toMillis()
  }
  return null
}

/**
 * The newest plan worth reusing out of what the finder returned: another
 * job's, still proposed or already confirmed, on a job that was neither
 * canceled nor failed, proposed inside the window.
 *
 * A canceled or failed job is excluded even though its plan may be perfectly
 * good: those are the jobs a member walked away from, and handing their plan
 * to the next one would make a rejected answer look like a fresh one.
 */
export function aiReusablePlan(
  candidates: readonly AiJobPlanCandidate[],
  context: { jobId: string; now: Date },
): AiJobPlanCandidate | null {
  const floor = context.now.getTime() - AI_PLAN_REUSE_WINDOW_MS
  let best: AiJobPlanCandidate | null = null
  let bestAt = -1
  for (const candidate of candidates) {
    if (candidate.jobId === context.jobId) continue
    if (UNREUSABLE.includes(candidate.status)) continue
    if (candidate.plan.status !== 'proposed' && candidate.plan.status !== 'confirmed') continue
    const at = planMillis(candidate.plan)
    if (at === null || at < floor || at > context.now.getTime()) continue
    if (at > bestAt) {
      best = candidate
      bestAt = at
    }
  }
  return best
}

export type AiJobPlanFinder = (
  orgId: string,
  key: string,
  firestore?: FirebaseFirestore.Firestore,
) => Promise<AiJobPlanCandidate[]>

/**
 * The finder the step uses in production: an equality on `plan.key` inside
 * the org's own jobs.
 *
 * One equality on one field, with no ordering beside it, so Firestore's
 * automatic single-field index answers it and no composite index is deployed.
 * The window and the statuses are applied in memory instead, which is what
 * keeps it that way.
 */
export const findAiJobsByPlanKey: AiJobPlanFinder = async (orgId, key, firestore) => {
  if (!firestore) return []
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(AI_JOBS_COLLECTION)
    .where('plan.key', '==', key)
    .limit(AI_PLAN_REUSE_CANDIDATES)
    .get()
  return snapshot.docs.flatMap((doc) => {
    const data = doc.data() as { status?: AiJobStatus; plan?: AiJobPlan | null }
    return data.plan
      ? [{ jobId: doc.id, status: data.status ?? 'queued', plan: data.plan }]
      : []
  })
}

/** What a job may create on its site, read for the plan step; `null` for no site. */
export type AiPlanCapabilitiesReader = (input: {
  job: AiJob
  org: Partial<AglynOrgBilling> | null
  firestore: FirebaseFirestore.Firestore
}) => Promise<AiPlanCapabilities | null>

/** The reader the step uses in production: the draft bands' own arithmetic, for the job's site. */
export const readAiJobPlanCapabilities: AiPlanCapabilitiesReader = async ({ job, org, firestore }) => {
  if (!job.hostId) return null
  const capabilities = await readAiPlanCapabilities(firestore, { hostId: job.hostId, org })
  // A site start creates datasets only where the data plugin runs and its
  // writer admits this member now (AGL-3616), and at most a start's few.
  return job.kind === 'site'
    ? aiSitePlanDatasetCapability(capabilities, { firestore, org, now: new Date(), job })
    : capabilities
}

export interface AiJobPlanStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The reuse lookup; specs hand in a fake, and `null` turns reuse off. */
  findPlansByKey?: AiJobPlanFinder | null
  /** What the job may create on its site (AGL-3030); specs and the eval recorder hand in their own. */
  readCapabilities?: AiPlanCapabilitiesReader
  /** The kind's admission, asked of a plan before it is kept; the registry's otherwise. */
  admissionRefusal?: typeof aiJobAdmissionRefusal
  /** A build's operations on its site (AGL-3616); the registry and its gates otherwise. */
  readOps?: AiBuildOpsReader
  /**
   * The site's business profile, status and remembered preferences
   * (AGL-3661); specs and the eval recorder hand in their own, and `null`
   * turns it off.
   */
  readSiteContext?: AiSiteContextReader | null
  /**
   * What a Free workspace has left (AGL-3722), read when a build's plan is
   * kept so its card can say whether it fits; `null` turns it off.
   */
  readFreeCredits?: typeof readFreeAiCreditsLeft | null
  /**
   * What an event-led site start may plan of events (AGL-3755); specs hand in
   * their own, and `null` turns it off.
   */
  readSiteEvents?: typeof readAiSiteEventPlanning | null
  /**
   * How a site start counts the records of each dataset its site sees
   * (AGL-3912), which decides whether its plan may reuse one; specs hand in
   * their own.
   */
  countDatasetRecords?: AiDatasetRecordCounter
  /**
   * The signals of the sites a site start's person likes (AGL-3975); specs
   * hand in recorded pages, and `null` turns it off.
   */
  readInspiration?: AiSiteInspirationReader | null
}

/** What a job's site context is read with (AGL-3661). */
export type AiSiteContextReader = (input: {
  job: AiJob
  firestore: FirebaseFirestore.Firestore
}) => Promise<AiSiteContextInput | null>

/** The reader the step uses in production: fail-soft, org-scoped, `null` for a job with no site. */
export const readAiJobSiteContext: AiSiteContextReader = ({ job, firestore }) =>
  readAiSiteContext(firestore, { orgId: job.orgId, hostId: job.hostId })

/** What a build may plan on its site (AGL-3616). */
export type AiBuildOpsReader = (input: {
  job: AiJob
  org: Partial<AglynOrgBilling> | null
  firestore: FirebaseFirestore.Firestore
  freeTaste: boolean
}) => Promise<AiBuildOps>

/** The reader the step uses in production: the registry, gated for the job's site. */
export const readAiBuildOps: AiBuildOpsReader = async ({ job, org, firestore, freeTaste }) => {
  const host = job.hostId
    ? (((await firestore.collection('hosts').doc(job.hostId).get()).data() ?? null) as Record<string, unknown> | null)
    : null
  return aiBuildOps({ orgId: job.orgId, hostId: job.hostId ?? null, org, host, freeTaste })
}

/**
 * A build plan with the store pages it adds (AGL-3676): where it turns the
 * site into a store and the site can have one — its operations include the
 * commerce plugin's products, which they do only on a plan with commerce and
 * a site Commerce runs on — the account, cart and policy pages neither the
 * plan nor the site already has. Worked out here by code, never by the
 * model, so the plan card shows them before Confirm. Every other plan, and a
 * build that adds none, carries none.
 */
export function aiPlanWithStorePages<T extends AiBuildPlan>(
  kind: AiJob['kind'],
  ops: AiBuildOps | null,
  inventory: Pick<AiSiteInventory, 'screens'> | null,
  plan: T,
): T {
  if (kind !== 'build') return plan
  // A reused plan's store pages were the other job's site's; this one's are worked out again.
  const rest: T = { ...plan }
  delete rest.storePages
  const storePages = aiBuildStorePagesFor(plan, {
    store: Boolean(ops?.has(AI_BUILD_PRODUCT_OP)),
    pages: (inventory?.screens ?? []).map((screen) => ({ id: screen.id, slug: screen.slug, title: screen.name, template: screen.template })),
  })
  return storePages ? { ...rest, storePages } : rest
}

/**
 * A build plan's items with what each can cost (AGL-3616), from its
 * capability, recorded as the plan is kept so the console's estimate and the
 * confirm door read one figure without the registry.
 */
export function aiPlanWithItemCredits<T extends AiBuildPlan>(ops: AiBuildOps | null, plan: T): T {
  if (!ops || !plan.items?.length) return plan
  return {
    ...plan,
    items: plan.items.map((item) => {
      const capability = ops.get(item.op)
      return capability ? { ...item, credits: Math.max(0, Math.floor(capability.estimateCredits(item.args))) } : item
    }),
  }
}

/**
 * A plan with THIS job's inspiration signals (AGL-3975), or with none: a
 * reused plan's were the other job's, and a plan the model answered holds
 * none of its own. The look unit pins them; the plan was told the structure.
 */
export function aiPlanWithInspiration<T extends AiBuildPlan & { inspiration?: AiSiteInspiration }>(
  plan: T,
  inspiration: AiSiteInspiration | null,
): T {
  const rest: T = { ...plan }
  delete rest.inspiration
  return inspiration ? { ...rest, inspiration } : rest
}

export function createAiJobPlanStep(deps: AiJobPlanStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const findPlansByKey =
    deps.findPlansByKey === undefined ? findAiJobsByPlanKey : deps.findPlansByKey
  const readCapabilities = deps.readCapabilities ?? readAiJobPlanCapabilities
  const admissionRefusal = deps.admissionRefusal ?? aiJobAdmissionRefusal
  const readOps = deps.readOps ?? readAiBuildOps
  const readContext = deps.readSiteContext === undefined ? readAiJobSiteContext : deps.readSiteContext
  const readFreeCredits = deps.readFreeCredits === undefined ? readFreeAiCreditsLeft : deps.readFreeCredits
  const readSiteEvents = deps.readSiteEvents === undefined ? readAiSiteEventPlanning : deps.readSiteEvents
  const readInspiration = deps.readInspiration === undefined ? readAiJobSiteInspiration : deps.readInspiration
  return async ({ job, now, signal, firestore, modelFor, org: orgDocument }) => {
    const org = (orgDocument ?? null) as Partial<AglynOrgBilling> | null
    // A site start counts each dataset's records (AGL-3912): it reuses only
    // one whose records are its own to show.
    const readPlanInventory = async () => {
      if (!job.hostId) return null
      const read = await readInventory(job.orgId, job.hostId, { firestore })
      return job.kind === 'site' ? aiSiteInventoryWithRecordCounts(read, job.orgId, deps.countDatasetRecords) : read
    }
    const [inventory, workspace, siteContext] = await Promise.all([
      readPlanInventory(),
      readCapabilities({ job, org, firestore }),
      job.hostId && readContext ? readContext({ job, firestore }) : Promise.resolve(null),
    ])
    // The site's profile, status and memory (AGL-3661), as a per-site cached
    // block after the plan rules. The inventory block already lists what the
    // site holds, so the context carries no index of its own here.
    const instructions = aiInstructionsWithSiteContext(AI_JOB_PLAN_INSTRUCTIONS, siteContext)
    const scope = AI_JOB_PLAN_SCOPES[job.kind] ?? null
    const capabilities = aiSitePlanCapabilities(
      job,
      workspace ? aiPlanCapabilitiesForJob(workspace, scope) : null,
    )
    const freeTaste = capabilities?.freeTaste === true
    // A build's operations, as this site has them (AGL-3616).
    const ops = job.kind === 'build' ? await readOps({ job, org, firestore, freeTaste }) : null
    const site = job.kind === 'site'
    // An event-led start's first events (AGL-3755), only where the build's
    // gate admits the events plugin's operation here and its writer this member.
    // And the sites the person likes, as signals (AGL-3975): read only on a
    // site start that names some, while the release flag is on.
    const [siteEvents, inspiration] = await Promise.all([
      site && readSiteEvents
        ? readSiteEvents({ job, org, firestore, now, readOps: () => readOps({ job, org, firestore, freeTaste }) })
        : Promise.resolve(null),
      site && readInspiration
        ? readInspiration({ job, org, freeTaste, ...(signal ? { signal } : {}) }).catch((error: unknown) => {
            console.warn('ai plan: the sites the person likes could not be read', { orgId: job.orgId, jobId: job.$id, error })
            return null
          })
        : Promise.resolve(null),
    ])
    const itemOps = ops ?? siteEvents?.ops ?? null
    // A kept plan waits for its confirmation; a Free build's card is told what
    // is left, so it says before Confirm whether the build fits (AGL-3722).
    // Net of what THIS plan just spent: the machine meters the step after it
    // returns, so the meters read here do not hold it yet, and a card told
    // the figure from before the plan (101) offered Confirm to a person with
    // 48 left, who met the prompt only after pressing it (2026-10-10).
    const planReview = async (spentUsd = 0): Promise<AiJobReview> => {
      const review: AiJobReview = { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] }
      if (job.kind !== 'build' || !freeTaste || !readFreeCredits) return review
      const credits = await readFreeCredits(firestore, { orgId: job.orgId, org, now, pendingUsd: spentUsd })
      return credits ? { ...review, freeCredits: credits } : review
    }
    // The model switch's answer for this job (AGL-2942): the creator's pick
    // where the plan, the org restriction and the allotment allowlists allow
    // it, and Auto held to those same lists otherwise. Without a resolver the
    // doctrine asks the routing table itself. A Free site plans on its
    // provider's fast tier (AGL-3594), unless the creator picked a model.
    const model = aiSitePlanModel(job, modelFor?.('job.plan'), freeTaste)
    const route = AI_ROUTING_TABLE['job.plan']
    // What this start can build of what the person's sites offer (AGL-3975):
    // a restaurant is never offered the events list an event-led start
    // drafts, or a store's sign-up; and their first site's order, where it
    // gives one, is the home's in place of the seeded arc.
    const inspirationStart: AiSiteInspirationStart = {
      siteKind: aiSiteKindOfInputs(job.inputs)?.id ?? null,
      posts: aiSiteContentPart(job.inputs ?? null, freeTaste) === 'posts',
      sells: aiSiteContentPart(job.inputs ?? null, freeTaste) === 'products',
      events: Boolean(siteEvents),
      customerWords: aiPlanHasCustomerWords({ brief: job.brief, inventory, siteKind: aiSiteKindOfInputs(job.inputs)?.id }),
      figures: aiSiteInspirationBriefHasFigures(job.brief),
    }
    const ownOrder = Boolean(aiSiteInspirationHomeOrder(inspiration, inspirationStart))
    const prompt = [
      aiJobPlanPrompt(job, capabilities, inventory, ops, now, { ownOrder }),
      ...(siteEvents ? aiSiteEventPlanLines(siteEvents, now) : []),
      ...aiSiteInspirationPlanLines(inspiration, { paid: !freeTaste, start: inspirationStart }),
    ].join('\n')

    /**
     * The confirm door's answer for this plan, asked before the plan is kept
     * (AGL-3030): the kind's own admission, handed the plan as the resume
     * door hands it. A refusal fails the job with the door's sentence; a door
     * that could not answer keeps the plan, since the resume door asks again
     * before anything is built.
     *
     * Two answers are about the month's Free credits, not the plan (AGL-3722):
     * - the 409 credits prompt KEEPS the plan. The card is told what is left
     *   (`planReview`) and offers Build what fits / the home page first /
     *   Upgrade, and the confirm door asks with the person's choice. Failing
     *   here instead failed every Free build past its p90 before the card
     *   could offer them — and paged staff with `ai.jobFailed`, as at
     *   2026-10-09 16:38Z (600 credits estimated, 164 left).
     * - the 429 "nothing left" still fails the job with its sentence, but as
     *   the customer's limit, which raises no staff alert.
     *
     * A plan only the person can complete — a tracking change with no pixel
     * ID (AGL-3978) — is KEPT too, and waits in `needs_input` with a field per
     * id, its review beside it: nothing about it failed, and the answer
     * returns it to the plan card. Only an item that names no tag at all,
     * so has no field to fill, still ends with the question.
     */
    const refusalOnKeep = async (plan: AiJobPlan, outcome: AiJobStepOutcome): Promise<AiJobStepOutcome | null> => {
      let refusal: Awaited<ReturnType<typeof aiJobAdmissionRefusal>> = null
      try {
        refusal = await admissionRefusal(job.kind, {
          firestore,
          orgId: job.orgId,
          hostId: job.hostId ?? null,
          inputs: job.inputs ?? {},
          org,
          plan,
          uid: job.createdBy,
        })
      } catch (error) {
        console.error('ai plan admission failed', { orgId: job.orgId, jobId: job.$id, error })
      }
      if (!refusal || refusal.code === AI_CREDITS_CONFIRM_CODE) return null
      const fields = refusal.code === AI_BUILD_NEEDS_INPUT_CODE ? aiBuildPlanInputFields(plan, itemOps) : []
      if (fields.length) {
        return { ...outcome, plan, review: await planReview(outcome.estCostUsd), input: { message: refusal.error, fields } }
      }
      return {
        ...outcome,
        failure: refusal.error,
        ...(refusal.status === 429 ? { customerLimit: true } : {}),
      }
    }

    // Reuse before asking (AGL-2937). The key covers the whole request, so a
    // hit is a request that would have been sent the same bytes to the same
    // model; the window covers what the key cannot see. A reused plan spends
    // nothing, so the machine's spent-nothing branch releases the reservation
    // and meters no credit, and the job still stops for the member to confirm
    // — this job's plan is proposed to this member, whatever the last one did
    // with theirs.
    const resolved = model ?? aiModelForStep('job.plan')
    // A brief that asks for a video is offered the plan's list of players
    // (AGL-3433), and a job that may bind a dataset a record template on
    // each screen (AGL-3475). A site's plan says the language its brief is
    // written in, which its guided start sets the site's language from (AGL-3750).
    const tool = aiBuildPlanToolFor(job.brief, {
      records: Boolean(inventory?.datasets.length) || capabilities?.create.dataset.allowed === true,
      items: job.kind === 'build' || Boolean(siteEvents),
      language: site,
    })
    const key = aiJobPlanKey({
      job,
      prompt,
      model: resolved,
      system: aiDoctrineSystemBlocks(inventory, { instructions }),
      tool,
    })
    const reused = findPlansByKey
      ? aiReusablePlan(await findPlansByKey(job.orgId, key, firestore), {
          jobId: job.$id,
          now,
        })
      : null
    if (reused) {
      // The reused plan's draft ids name the other job's drafts; this job's are its own.
      // Settled again against what the datasets hold now (AGL-3912).
      const kept = site ? aiSettlePlanDatasets(aiSettleSiteForeignDatasets(reused.plan, inventory, capabilities), capabilities) : reused.plan
      const plan: AiJobPlan = aiPlanWithStorePages(job.kind, ops, inventory, aiPlanWithItemCredits(itemOps, aiPlanWithDraftIds(job.kind, {
        ...aiPlanWithInspiration(kept, inspiration),
        status: 'proposed',
        labels: aiPlanLabels(kept, inventory),
        proposedAt: now as unknown as AiJobPlan['proposedAt'],
        confirmedAt: null,
        confirmedBy: null,
        key,
        reusedFrom: reused.jobId,
      })))
      const unspent = aiUnspentOutcome(resolved)
      return (
        (await refusalOnKeep(plan, unspent)) ?? {
          ...unspent,
          plan,
          review: await planReview(),
        }
      )
    }

    const result = await runValidatedGeneration('plan', {
      step: 'job.plan',
      ...(model ? { model } : {}),
      instructions,
      inventory,
      messages: [{ role: 'user', content: prompt }],
      tool,
      // The routing ceiling, lowered on a tier too slow to look records up,
      // answer and ask again inside the least time the step registered; a
      // scaffold's outline is held to its own, far lower ceiling (AGL-3594).
      maxTokens: aiSitePlanMaxTokens(job, resolved, freeTaste),
      // A scaffold plans an outline without thinking (AGL-3594): the thinking
      // was nearly all of the 13,491 tokens a Free site's plan spent.
      ...(site ? { thinking: 'off' as const } : route.thinking ? { thinking: route.thinking } : {}),
      // A paid site's outline asks the effort its live round held at (AGL-3781);
      // a Free one's, on the fast tier, keeps the model's own.
      ...(site && !freeTaste
        ? { effort: AI_PAID_SITE_PLAN_EFFORT }
        : route.effort
          ? { effort: route.effort }
          : {}),
      ...(signal ? { signal } : {}),
      // Most plans continue — a lookup round, a re-ask — and each continuation
      // re-sends the brief and the inventory, so the plan caches its
      // conversation and the next request reads it back (AGL-3809).
      cacheConversation: true,
      capabilities,
      // A build's events are listed on a page (AGL-3755): on the one it makes
      // about them, else on an Events page of its own where there is room.
      // No section is named a placeholder, and a site start plans no section
      // of customer words it has none of (AGL-3887). A site start's plan
      // makes again each dataset it reuses that another site filled (AGL-3912).
      settle: (answered: AiBuildPlan) =>
        aiPlanSaidSettle(job, inventory, site ? aiSitePlanHomeRule(inventory, capabilities).min : 0)(
          ops
            ? aiSettleBuildEventPage(answered, {
                ops,
                siteSlugs: (inventory?.screens ?? []).map((screen) => screen.slug),
                pageLimit: aiBuildPageLimit(freeTaste),
                siteLayout: aiSiteLayoutOf(inventory),
              })
            : site
              ? aiSettleSiteForeignDatasets(answered, inventory, capabilities)
              : answered,
        ),
      // A site start's home places no form another page holds (AGL-3899):
      // its call to action links that page instead.
      ...(site
        ? {
            settleForms: (placed: AiBuildPlan) =>
              aiSettlePlanHomeForms(placed, inventory, { keep: aiSiteFormStaysHome(job, capabilities?.freeSitePages) }),
          }
        : {}),
      extend: aiSiteWithEventItemsCheck(
        planViolations(
          scope,
          job.brief,
          freeTaste,
          ops,
          site ? aiSitePlanHomeRule(inventory, capabilities) : null,
          site && aiSiteContentPart(job.inputs ?? null, freeTaste) === 'posts',
          site,
          site && aiSiteKindOfInputs(job.inputs)?.id === 'store',
        ),
        site ? siteEvents : undefined,
        ops,
      ),
    })
    const spent: AiJobStepOutcome = {
      outputs: [],
      usage: result.usage,
      estCostUsd: result.estCostUsd,
      model: result.model,
      stopReason: result.stopReason,
      ...(result.effort ? { effort: result.effort } : {}),
    }
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') {
      // Refused by our own checks, after the one re-ask (AGL-3594): the member
      // reads a sentence and an action, staff the rules; the machine gives the
      // credits back (`uncredited`), and on the Free taste Try again says when
      // it cannot work. Whether the give-back was made is the job's to say
      // (`refundedCredits`), so this sentence does not promise it.
      const review = aiDoctrineReview(result)
      const retryRefusal = freeTaste
        ? await aiFreePlanRetryRefusal({ job, org, firestore, now, site })
        : null
      return {
        ...spent,
        uncredited: true,
        review: {
          ...review,
          message: aiPlanFailureCopy({
            kind: job.kind,
            codes: result.violations.map((violation) => violation.code),
            refunded: false,
          }),
          detail: review.detail ?? review.message,
          ...(retryRefusal ? { retryRefusal } : {}),
        },
      }
    }
    // A store's plan is a storefront's (AGL-3676): settled before it is kept and priced.
    const answered = site && aiSiteKindOfInputs(job.inputs)?.id === 'store' ? aiSiteStorefrontPlan(result.value, { paid: !freeTaste }) : result.value
    // Each draft the plan decides is named as the plan is kept, before anything is built (AGL-3079).
    const plan: AiJobPlan = aiPlanWithStorePages(job.kind, ops, inventory, aiPlanWithItemCredits(itemOps, aiPlanWithDraftIds(job.kind, {
      ...aiPlanWithInspiration(answered, inspiration),
      status: 'proposed',
      labels: aiPlanLabels(answered, inventory),
      // A Date the Admin SDK stores as a timestamp, like every instant the machine writes.
      proposedAt: now as unknown as AiJobPlan['proposedAt'],
      confirmedAt: null,
      confirmedBy: null,
      key,
    })))
    return (
      (await refusalOnKeep(plan, spent)) ?? {
        ...spent,
        plan,
        review: await planReview(result.estCostUsd),
      }
    )
  }
}

/**
 * A site job's capabilities (AGL-3594, AGL-3660): it changes no theme in its
 * plan — every scaffold designs its look first, in a unit of its own — and on
 * the Free taste its plan holds at most the pages the member asked for within
 * the Free band, which the Free wall then holds it to.
 *
 * A build's pages are written in the layout language (`aiBuildUnitJob`), whose
 * compiler draws a section's repeated items itself, so its plan is not asked
 * for a component for them (`repeatsCompiled`, AGL-3616). It still may plan
 * one, and a section two pages share is still one. Every other job's
 * capabilities pass through.
 */
export function aiSitePlanCapabilities(
  job: Pick<AiJob, 'kind' | 'inputs'>,
  capabilities: AiPlanCapabilities | null,
): AiPlanCapabilities | null {
  if (job.kind === 'build' && capabilities) return { ...capabilities, repeatsCompiled: true }
  if (job.kind !== 'site' || !capabilities) return capabilities
  const create = {
    ...capabilities.create,
    'theme-change': {
      allowed: false,
      left: null,
      reason: 'a site start designs its own look before its pages',
    },
    // A site start builds its look, one layout and one form, never a
    // component (`AI_SITE_CREATE_KINDS`), so a paid workspace's plan draws
    // repeated items in their sections, as a Free one's does. Held to rule 1
    // instead, every paid plan was refused: for the component it left out,
    // or, re-asked, for the one it could not build (AGL-3660).
    component: {
      allowed: false,
      left: null,
      reason: 'a site start draws its repeated items in their sections',
    },
  }
  // At most a start's few datasets, settled in code where a plan names more
  // (AGL-3616); a section that shows the work with its fewest pieces (AGL-3754).
  const site = {
    ...capabilities,
    reusableComponents: false,
    create,
    datasetsMax: AI_SITE_DATASETS_MAX,
    galleryMinItems: AI_SITE_GALLERY_MIN_ITEMS,
  }
  if (!capabilities.freeTaste) return site
  const asked = Number((job.inputs ?? {})['pages'])
  const pages =
    Number.isInteger(asked) && asked >= AI_SITE_FREE_PAGES.min
      ? Math.min(asked, AI_SITE_FREE_PAGES.max)
      : AI_SITE_FREE_PAGES.max
  // A Free blog writes one first post (AGL-3798), which the wall counts.
  const posts = aiSiteContentPart(job.inputs ?? null, true) === 'posts' ? { freeSitePosts: AI_SITE_FREE_POSTS } : {}
  return { ...site, freeSitePages: pages, ...posts }
}

/**
 * The effort a paid site's plan asks (AGL-3781). The live round of 2026-10-14
 * planned the paid site briefs (`ai-job-site-plan-live.spec.ts` with
 * `AGLYN_LIVE_AI_ORG_PLAN=business`) at the model's default and at medium:
 * both planned 11 of 11 with no refusal and no rule broken, and medium took
 * 16 attempts to the default's 22, for $0.129 to $0.164. Scoped to a paid
 * site's plan, which is all that arm planned: the `job.plan` row's effort,
 * which every other plan asks, waits on the golden round, and a Free site's
 * plan on the fast tier was measured at its model's default (every answer a
 * tool_use, 31 of 31) and keeps it.
 */
export const AI_PAID_SITE_PLAN_EFFORT: AiEffort = 'medium'

/**
 * The model a plan runs on (AGL-3594): the resolved one, except a Free site
 * plans on its provider's fast tier — an outline the plan rules hold and
 * re-ask, at a fifth of the balanced tier's output rate. A model the creator
 * picked by name stays theirs.
 */
export function aiSitePlanModel(
  job: Pick<AiJob, 'kind' | 'model'>,
  resolved: string | undefined,
  freeTaste: boolean,
): string | undefined {
  if (job.kind !== 'site' || !freeTaste) return resolved
  const picked = typeof job.model === 'string' ? job.model.trim() : ''
  if (picked && picked !== 'auto') return resolved
  const entry = aiCatalogEntry(resolved ?? aiModelForStep('job.plan'))
  return (entry ? aiDefaultModelFor(entry.provider, 'fast') : undefined) ?? resolved
}

/** The plan's answer ceiling: the step's own, and a scaffold's outline ceiling under it (AGL-3594). */
export function aiSitePlanMaxTokens(
  job: Pick<AiJob, 'kind'>,
  model: string,
  freeTaste: boolean,
): number {
  const ceiling = aiJobPlanMaxTokens(model)
  if (job.kind !== 'site') return ceiling
  return Math.min(ceiling, freeTaste ? AI_SITE_PLAN_MAX_TOKENS.free : AI_SITE_PLAN_MAX_TOKENS.paid)
}

/**
 * Why trying a Free plan again cannot work this month, or `null` (AGL-3594):
 * the owner's Free allowance left, read off the account month the meter
 * writes net of give-backs, against what a plan of this kind costs at its
 * worst. Read before this step is metered, and the machine gives a refused
 * plan's credits back, so the figure read is the figure left. A read that fails
 * leaves the button on: the reservation still refuses at the wall.
 */
async function aiFreePlanRetryRefusal(input: {
  job: AiJob
  org: Partial<AglynOrgBilling> | null
  firestore: FirebaseFirestore.Firestore
  now: Date
  site: boolean
}): Promise<string | null> {
  const account = freeAssistAccount(input.org as AssistMeteredOrg | null)
  if (!account?.accountUid) return null
  try {
    // The meter's month key, `YYYY-MM` in UTC (`assistUsageMonth`).
    const month = input.now.toISOString().slice(0, 7)
    const snapshot = await freeAccountUsageRef(input.firestore, account.accountUid, month).get()
    const spent = assistCreditsFromUsd(
      assistSpendAfterReturnsUsd(snapshot.get('estCostUsd'), snapshot.get(ASSIST_RETURNED_USD_FIELD)),
    )
    return aiPlanRetryRefusal({
      creditsLeft: FREE_AI_TASTE_CREDITS_PER_MONTH - spent,
      planCredits: input.site ? AI_FREE_SITE_WORST_CASE_CREDITS.plan : AI_FREE_PAGE_WORST_CASE_CREDITS.plan,
    })
  } catch (error) {
    console.error('ai plan retry allowance read failed', { orgId: input.job.orgId, jobId: input.job.$id, error })
    return null
  }
}

export const runAiJobPlanStep = createAiJobPlanStep()

/**
 * Registers the plan step every planned kind runs first, with the least time
 * a plan needs; the plugin's console surface calls it.
 */
export function registerAiJobPlan(): void {
  registerAiJobPlanStep(runAiJobPlanStep, { minimumMs: AI_JOB_PLAN_STEP_MINIMUM_MS })
}
