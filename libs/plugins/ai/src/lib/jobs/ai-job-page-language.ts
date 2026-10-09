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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { isAiPlanNewRef, type AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import {
  aiHomeScreenIds,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import { AI_LAYOUT_POST_ADDRESS_TOKENS, aiCompileLayoutPage } from '../layout-language/ai-layout-compiler'
import { aiLayoutListingAt, aiLayoutListingsOf } from '../layout-language/ai-layout-listings'
import {
  AI_LAYOUT_LANGUAGE_TEXT,
  AI_LAYOUT_PAGE_TOOL,
  aiReadLayoutPage,
  type AiLayoutSection,
  type AiLayoutSettlement,
} from '../layout-language/ai-layout-language'
import type {
  AiLayoutPage,
  AiLayoutTargets,
} from '../layout-language/ai-layout-links'
import { aiLayoutCopyCheck } from '../layout-language/ai-layout-gaps'
import { aiLayoutStoredTree } from '../layout-language/ai-layout-store'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { AI_STEP_TIERS } from '../providers/catalog'
import {
  runValidatedGeneration,
  type AiGenerationCheck,
  type AiGenerationSpend,
  type AiValidatedGeneration,
} from '../runtime/ai-doctrine'
import type { AiUsage } from '../providers/contract'
import {
  validateAiDoctrineTree,
  type AiDoctrineNode,
  type AiDoctrineTreeContext,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { aiSiteKindDesignLines, aiSiteKindOfInputs } from '../model/ai-site-kinds'
import { aiSiteSeed } from '../model/ai-site-look'
import type { AiLayoutDesign } from '../layout-language/ai-layout-design'
import { aiOriginJobId } from './ai-job-draft-ids'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { aiGenerationWorstCaseOnTierMs, aiJobStepBudget } from './ai-job-budget'
import { aiJobBriefLine, aiPlanReferenceLines } from './ai-job-generation'
import { aiLayoutIsHomeSlug, aiLayoutSiteAliases, aiLayoutSitePages } from './ai-job-layout-site-pages'
import { aiLayoutInventedContactViolations } from './ai-layout-site-facts'

/**
 * A page built in the compact layout language (AGL-3660): the page step's
 * pass for a site's page units — a guided start's and a build's — in place of
 * the raw-tree section passes.
 *
 * ONE answer a page: every planned section, in the language, through
 * `submit_page`. The compiler writes the tree, the palette validator stores
 * it as it stores any generated tree, and the doctrine checks the whole page.
 * A section the answer left out or left empty is the one thing a re-ask asks
 * for: the sections that read are kept, and the second answer fills only
 * what is still missing. Then the page step's last pass runs as it always
 * has — the whole page held to the doctrine again, its listing written, the
 * draft reported — so the item ledger, the credits and Try again work exactly
 * as they did.
 */

/** The unit input that says a page or a layout is built in the layout language. */
export const AI_LAYOUT_LANGUAGE_INPUT = 'layoutLanguage'

/** The unit input naming the page of the site that places its form, where it is another page. */
export const AI_LAYOUT_FORM_PAGE_INPUT = 'layoutFormPage'

/** Whether this job builds its page or its layout in the layout language. */
export function aiJobUsesLayoutLanguage(job: Pick<AiJob, 'inputs'>): boolean {
  return job.inputs?.[AI_LAYOUT_LANGUAGE_INPUT] === true
}

/**
 * How the language doors think (AGL-3660): adaptively, at an effort named
 * rather than left to the model's default. Zach, 2026-10-07: quality first —
 * a page and a site's frame are designed, not transcribed, and the caching
 * work pays for the thinking. Medium is where Claude Sonnet 5.5, the balanced
 * default, is tuned to start for multistep design work.
 */
export const AI_LAYOUT_LANGUAGE_THINKING = { thinking: 'adaptive', effort: 'medium' } as const

/**
 * Room for the thinking a page's answer does before it writes, inside the
 * same `max_tokens` as the answer: thinking is drawn from the ceiling first,
 * so a ceiling sized for the answer alone would cut a thoughtful answer off.
 *
 * Bounded by TIME, not by money: the page step's answer, its re-ask and the
 * follow-up must fit the least time a beat gives a step
 * (`AI_JOB_STEP_MAX_MINIMUM_MS`), and `aiJobStepBudget` quietly lowers every
 * ceiling to what fits. 2,000 here, with the follow-up's 500, is the most
 * that fits whole on the balanced tier; at 5,000 the budget cut a page's
 * ceiling to 879 tokens, under the answer itself.
 */
export const AI_LAYOUT_PAGE_THINKING_TOKENS = 2_000

/** The same room for a site's header and footer, whose step has the time for more. */
export const AI_LAYOUT_FRAME_THINKING_TOKENS = 4_000

/**
 * The most one page's answer asks for: the answer and the thinking before it.
 * A section in the language is about 120 to 250 tokens with its copy, so the
 * largest page a plan admits — eight sections — fits in 3,000 with room (the
 * live runs of 2026-10-07 wrote 683 to 1,745); the compiler, not the ceiling,
 * keeps a page small.
 */
export const AI_JOB_PAGE_LANGUAGE_TOKENS = 3_000 + AI_LAYOUT_PAGE_THINKING_TOKENS

/**
 * The most one section of a page is written in, its copy included: the top of
 * the 120 to 250 tokens a section runs to. The Free site wall prices each
 * planned section at it (AGL-3660).
 */
export const AI_LAYOUT_SECTION_MOST_TOKENS = 250

/**
 * The time a language page pass needs: its lookup rounds, its answer and its
 * re-ask at `AI_JOB_PAGE_LANGUAGE_TOKENS` on the tier the page step is served
 * from, with the step's reads and writes.
 */
/** The most the follow-up asking only for the sections an answer left out may run to, its thinking included. */
export const AI_JOB_PAGE_LANGUAGE_FOLLOW_UP_TOKENS = 1_500 + 500

export const AI_JOB_PAGE_LANGUAGE_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.page'],
  maxTokens: AI_JOB_PAGE_LANGUAGE_TOKENS,
  // The follow-up for sections an answer left out is one more generation.
  ownReadsMs: aiGenerationWorstCaseOnTierMs({
    tier: AI_STEP_TIERS['job.page'],
    maxTokens: AI_JOB_PAGE_LANGUAGE_FOLLOW_UP_TOKENS,
  }),
})

/** The doctrine scope the language doors are told: values the compiler checks itself. */
export const AI_LAYOUT_PAGE_KIND = 'layout-page'

/** The language, as the page door's cached instructions. */
export const AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      AI_LAYOUT_LANGUAGE_TEXT,
      '',
      'Answer with submit_page: the whole page, one entry in sections for each planned section, in order.',
    ].join('\n'),
    cacheBreakpoint: true,
  },
]

/** The page of a site plan that places its form: the form the plan creates, or one the site has. */
export function aiLayoutFormPageOfPlan(
  plan: Pick<AiJobPlan, 'create' | 'screens'>,
  formIds: readonly string[] = [],
): string | null {
  const created = new Set(
    plan.create
      .filter((entry) => entry.kind === 'form')
      .map((entry) => `new:${entry.name}`.toLowerCase()),
  )
  const forms = new Set(formIds)
  const screen = plan.screens.find((entry) =>
    entry.sections.some((section) =>
      section.uses.some((ref) =>
        isAiPlanNewRef(ref) ? created.has(ref.toLowerCase()) : forms.has(ref),
      ),
    ),
  )
  return typeof screen?.id === 'string' ? screen.id : null
}

/** Every word the job was given, which a page's contact details are held to. */
export function aiLayoutFacts(job: Pick<AiJob, 'brief' | 'inputs'>): string {
  const values = Object.values(job.inputs ?? {}).filter(
    (value): value is string => typeof value === 'string',
  )
  return [job.brief, ...values].join('\n')
}

/** What a page's links resolve against: the site's pages, built and planned, its forms and components. */
export function aiLayoutPageTargets(input: {
  job: Pick<AiJob, 'brief' | 'inputs'>
  inventory: AiSiteInventory | null
  own: ReadonlyArray<string | null | undefined>
}): AiLayoutTargets {
  const { job, inventory } = input
  const own = input.own.filter((id): id is string => !!id)
  const planned = aiLayoutSitePages(job.inputs)
  const pages: AiLayoutPage[] = [
    ...planned,
    // Planned pages merged into the blog (AGL-3676): a link to one goes to the blog.
    ...aiLayoutSiteAliases(job.inputs).filter((alias) => !planned.some((page) => page.id === alias.id)),
    ...(inventory?.screens ?? [])
      .filter(
        (row) => !row.template && !planned.some((page) => page.id === row.id),
      )
      .map((row) => ({ id: row.id, label: row.name, slug: row.slug })),
  ]
  const formPage = job.inputs?.[AI_LAYOUT_FORM_PAGE_INPUT]
  return {
    pageId: own[0] ?? null,
    pages: pages.filter((page) => !own.includes(page.id)),
    homeIds: aiHomeScreenIds(inventory),
    forms: (inventory?.forms ?? []).map((form) => ({
      id: form.id,
      name: form.name,
    })),
    formPageId:
      typeof formPage === 'string' && !own.includes(formPage) ? formPage : null,
    components: (inventory?.components ?? []).map((component) => ({
      id: component.id,
      name: component.name,
      props: component.props,
    })),
    facts: aiLayoutFacts(job),
    // The site's catalog and blog, and the sections that list them (AGL-3676).
    listings: aiLayoutListingsOf(job.inputs),
  }
}

/**
 * The page check's context with what a section listing the blog's posts
 * binds (AGL-3676): each post's card links its post and shows its cover by
 * the tokens the page fills per post, which a page's store admits whole only
 * where a listing places them.
 */
export function aiLayoutListingContext(
  context: AiDoctrineTreeContext,
  targets: AiLayoutTargets,
): AiDoctrineTreeContext {
  const listsPosts = (targets.listings ?? []).some(
    (listing) => listing.kind === 'posts' && listing.placements.some((placement) => placement.screenId === targets.pageId),
  )
  if (!listsPosts) return context
  return { ...context, bindingTokens: [...new Set([...(context.bindingTokens ?? []), ...AI_LAYOUT_POST_ADDRESS_TOKENS])] }
}

/** The page's user turn: the page, the brief, the plan, its sections and where its links may go. */
export function aiLayoutPagePrompt(input: {
  job: Pick<AiJob, 'brief' | 'inputs' | '$id'>
  plan: AiJobPlan
  screen: AiBuildPlanScreen
  targets: AiLayoutTargets
  reusableComponents: boolean
  /** The sections a re-ask still needs, by plan index; absent on the first ask. */
  missing?: readonly number[]
}): string {
  const { job, plan, screen, targets } = input
  const sections = screen.sections.map((section, index) => {
    const places = section.uses.length
      ? `; places ${section.uses.join(', ')}`
      : ''
    // A section the site's records fill (AGL-3676): the platform places them,
    // so the design writes the words around them and no group for them.
    const listed = aiLayoutListingAt(targets.listings ?? [], targets.pageId, index)
    if (listed) {
      return `${index + 1}. "${section.name}"${places}; the platform lists ${listed.listing.name}'s ${listed.listing.kind} here itself, with their photos and links: write only its heading and a line about them, and no cards, list or images for them`
    }
    const items = section.items ? `; shows ${section.items} items` : ''
    return `${index + 1}. "${section.name}"${places}${items}`
  })
  // A page merged into the blog is not offered: the blog is, by its own entry.
  const pages = targets.pages.filter((page) => !page.standsInFor).map((page) => `${page.label} (page:${page.id})`)
  const components = targets.components.map(
    (component) =>
      `${component.name} (${component.id}; props ${Object.keys(component.props).join(', ') || 'none'})`,
  )
  return [
    `Page: "${screen.title}" at ${screen.slug}`,
    aiJobBriefLine(job),
    // The kind of site the person picked sets how its pages are arranged (AGL-3660).
    ...aiSiteKindDesignLines(job.inputs),
    ...aiPlanReferenceLines(plan),
    `Sections to design, in order:`,
    ...sections,
    pages.length
      ? `Other pages of this site: ${pages.join(', ')}.`
      : 'This site has no other page to link.',
    targets.forms.length
      ? `The site's form: ${targets.forms.map((form) => `${form.name} (${form.id})`).join(', ')}.`
      : 'The site has no saved form: place none.',
    ...(components.length
      ? [`Components this page may place: ${components.join('; ')}.`]
      : []),
    input.reusableComponents
      ? 'Where a section repeats an item, place the component its plan line names with cards whose to is that component.'
      : 'This site keeps no reusable components: draw repeated items as cards, steps, stats or a list.',
    // A per-job word, so two identical briefs are designed apart.
    `Design seed: ${job.$id.slice(-6)}.`,
  ].join('\n')
}

/**
 * The site a page is designed for (AGL-3660): the kind its job names, the
 * seed its look was drawn with — the same for every page of the site, so the
 * site reads as one design — and whether the page is its home. `null` for a
 * job that names no kind of site, which compiles the compiler's first way.
 */
export function aiLayoutDesignOf(job: Pick<AiJob, '$id' | 'inputs'>, slug: string): AiLayoutDesign | null {
  const kind = aiSiteKindOfInputs(job.inputs)
  if (!kind) return null
  const style = job.inputs?.['siteStyle'] as Record<string, unknown> | undefined
  const seed = typeof style?.['seed'] === 'number' && Number.isFinite(style['seed']) ? (style['seed'] as number) >>> 0 : aiSiteSeed(aiOriginJobId(job))
  return { kind: kind.id, seed, home: aiLayoutIsHomeSlug(slug) }
}

/** A validated language page, stored as the page keeps it. */
export interface AiLayoutPageBuilt {
  nodes: NodesMap
  load: AiLoadEstimate | null
  settled: AiLayoutSettlement[]
  /** What the last answer's gaps took out of the page (`ai-layout-gaps.ts`). */
  dropped: string[]
  /** How many repeated items each plan section shows, as built (AGL-3660). */
  items: number[]
}

export interface AiLayoutPageCheckInput {
  screen: AiBuildPlanScreen
  sectionIds: readonly string[]
  targets: AiLayoutTargets
  context: AiDoctrineTreeContext
  reusableComponents: boolean
  /**
   * What earlier answers gave, by plan index, shared between the page's
   * generations: a follow-up asking only for missing sections fills the rest.
   */
  kept?: Array<AiLayoutSection | null>
  /** The plan indices this answer's sections fill, in order; absent, every section. */
  only?: readonly number[]
  /** The site the page is drawn for (`aiLayoutDesignOf`); absent, the compiler's first design. */
  design?: AiLayoutDesign | null
}

/**
 * The follow-up turn for the sections a page's answer left out (AGL-3660):
 * the page as before, told which sections it already has, and asked for only
 * the missing ones, in order — the one part of a page asked for again.
 */
export function aiLayoutMissingSectionsPrompt(input: {
  base: string
  screen: AiBuildPlanScreen
  missing: readonly number[]
}): string {
  const names = input.missing.map((index) => `${index + 1}. "${input.screen.sections[index].name}"`)
  return [
    input.base,
    '',
    `The other sections of this page are already designed. Design ONLY these, in this order, one entry in sections each: ${names.join('; ')}. Give each at least one block.`,
  ].join('\n')
}

/** The plan indices a page still lacks, after the answers so far. */
export function aiLayoutMissingSections(kept: ReadonlyArray<AiLayoutSection | null>): number[] {
  return kept.flatMap((section, index) => (section ? [] : [index]))
}

/** The violation a planned section the answer gave nothing usable for is named by. */
export const AI_LAYOUT_SECTION_MISSING_CODE = 'layout-section-missing'

/** The code a section planned with items that shows none is refused under (AGL-3660). */
export const AI_LAYOUT_SECTION_EMPTY_CODE = 'layout-section-no-items'

/** How many of a section's planned items it must show: one for a short list, two for anything longer. */
const leastItems = (planned: number) => (planned >= 3 ? 2 : planned >= 1 ? 1 : 0)

/**
 * How many repeated items each section shows once stored (AGL-3660): the
 * elements the compiler drew for them, under the ids they are stored by,
 * that are still in the page after anything later took words out.
 */
export function aiLayoutShownItems(
  itemIds: readonly (readonly string[])[],
  storedIds: Readonly<Record<string, string>>,
  nodes: Readonly<Record<string, unknown>>,
): number[] {
  return itemIds.map((ids) => ids.filter((id) => storedIds[id] !== undefined && storedIds[id] in nodes).length)
}

/**
 * The sections a page planned with repeated items — cards, steps, a list —
 * that show none, or too few, once the page is built (AGL-3660). A heading
 * and an intro over nothing is a section a visitor reads as broken, so it is
 * asked for again.
 */
export function aiLayoutEmptyItemSections(
  screen: Pick<AiBuildPlanScreen, 'sections'>,
  items: readonly number[],
  /** Sections whose only items were customer quotes, which no answer may give (AGL-3676). */
  quotesOnly: readonly number[] = [],
): AiDoctrineViolation[] {
  return screen.sections.flatMap((section, index): AiDoctrineViolation[] => {
    if (quotesOnly.includes(index)) return []
    const least = leastItems(section.items)
    if (!least) return []
    const shown = items[index] ?? 0
    if (shown >= least) return []
    return [
      {
        rule: null,
        code: AI_LAYOUT_SECTION_EMPTY_CODE,
        message: `Section ${index + 1} ("${section.name}") is planned with ${section.items} items and shows ${shown || 'none'}.`,
        detail: `Give section ${index + 1} one cards, steps, stats, list or faq block holding its ${section.items} items, each with a title and its words.`,
      },
    ]
  })
}

/**
 * The check a language page answer is held to: each planned section read,
 * the page compiled, stored and checked whole. Sections that read are kept
 * across the re-ask, so the second answer is asked only for what was missing,
 * and a section it sends again that already read is not taken twice.
 */
export function aiLayoutPageCheck(
  input: AiLayoutPageCheckInput,
): AiGenerationCheck<AiLayoutPageBuilt> {
  const kept: Array<AiLayoutSection | null> = input.kept ?? input.screen.sections.map(() => null)
  const fills = input.only ?? input.screen.sections.map((_, index) => index)
  const context = aiLayoutListingContext(input.context, input.targets)
  let answers = 0
  return (answer) => {
    // The last answer a generation takes has its gaps taken out rather than asked about again.
    answers += 1
    const last = answers >= AI_GENERATION_MAX_ATTEMPTS
    const reading = aiReadLayoutPage(
      answer,
      fills.length,
      fills.map((index) => input.screen.sections[index]),
    )
    reading.sections.forEach((section, position) => {
      // A section the answer gives is taken as given; one it leaves out keeps
      // what an earlier answer gave, so a re-ask may send only what was missing.
      if (section) kept[fills[position]] = section
    })
    const missing = kept.flatMap((section, index) => (section ? [] : [index]))
    if (missing.length) {
      const names = missing.map(
        (index) => `${index + 1} ("${input.screen.sections[index].name}")`,
      )
      return {
        value: null,
        violations: [
          {
            rule: null,
            code: AI_LAYOUT_SECTION_MISSING_CODE,
            message: `The page left out section ${names.join(', ')}.`,
            detail: `Answer again with every section in order; the sections you already designed are kept, so only ${names.join(', ')} ${missing.length === 1 ? 'needs' : 'need'} its design. Give each at least one block.`,
          },
        ],
      }
    }
    const compiled = aiCompileLayoutPage(
      kept as AiLayoutSection[],
      { title: input.screen.title, sections: input.screen.sections },
      input.targets,
      {
        reusableComponents: input.reusableComponents,
        sectionIds: input.sectionIds,
        ...(input.design ? { design: input.design } : {}),
      },
    )
    const stored = aiLayoutStoredTree(
      compiled.tree,
      'screen',
      context,
      input.sectionIds,
    )
    if (stored.ok === false) {
      // The compiler writes only palette trees, which the property spec holds;
      // a refusal here is the platform's, and is reported as one.
      console.error('ai layout page: a compiled page did not store', {
        error: stored.error,
      })
      return {
        value: null,
        violations: [
          {
            rule: null,
            code: 'layout-compile',
            message: 'This page could not be built. Try again.',
            detail: stored.error,
          },
        ],
      }
    }
    // No gap and no internal reference in the words of a page that is published as built.
    const copy = aiLayoutCopyCheck(
      stored.nodes,
      CANVAS_ROOT_ELEMENT_ID,
      {
        pages: input.targets.pages,
        ids: [
          ...input.targets.pages.map((page) => page.id),
          ...input.targets.forms.map((form) => form.id),
          ...input.targets.components.map((component) => component.id),
          ...input.sectionIds,
          ...(input.targets.pageId ? [input.targets.pageId] : []),
        ],
      },
      last,
    )
    const { nodes, dropped } = copy
    const report = validateAiDoctrineTree(
      { rootId: CANVAS_ROOT_ELEMENT_ID, nodes },
      'page',
      {
        ...context,
        scrollTargetIds: input.sectionIds,
        // The layout language draws its own picture cards (AGL-3660).
        repeatsCompiled: true,
      },
    )
    // Each section's items as they are stored, after anything the gaps took out.
    const items = aiLayoutShownItems(compiled.itemIds, stored.storedIds, nodes as unknown as Record<string, unknown>)
    // A street address or opening hours the job was never given is invented
    // (rule 14, AGL-3596), the same check a layout is held to; a phone number
    // or an email the compiler already writes as its gap.
    const violations: AiDoctrineViolation[] = [
      ...report.violations,
      ...copy.violations,
      ...aiLayoutEmptyItemSections(input.screen, items, compiled.quotesOnly),
      ...aiLayoutInventedContactViolations(
        { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: nodes as unknown as Record<string, AiDoctrineNode> },
        input.targets.facts,
      ),
    ]
    return {
      value: violations.length
        ? null
        : {
            nodes,
            load: report.load,
            settled: [...reading.settled, ...compiled.settled],
            dropped,
            items,
          },
      violations,
    }
  }
}

export interface AiLayoutPageRunInput {
  job: Pick<AiJob, 'brief' | 'inputs' | '$id'>
  plan: AiJobPlan
  screen: AiBuildPlanScreen
  sectionIds: readonly string[]
  targets: AiLayoutTargets
  context: AiDoctrineTreeContext
  reusableComponents: boolean
  inventory: AiSiteInventory | null
  model: string
  signal?: AbortSignal
  /** Wraps the check, for an eval that records each answer it reads. */
  observe?: (check: AiGenerationCheck<AiLayoutPageBuilt>) => AiGenerationCheck<AiLayoutPageBuilt>
}

/** Two generations' spend as one: every call is billed. */
function spentTogether(first: AiGenerationSpend, second: AiGenerationSpend): AiGenerationSpend {
  const usage: AiUsage = {
    inputTokens: first.usage.inputTokens + second.usage.inputTokens,
    outputTokens: first.usage.outputTokens + second.usage.outputTokens,
    cacheReadTokens: first.usage.cacheReadTokens + second.usage.cacheReadTokens,
    cacheWriteTokens: first.usage.cacheWriteTokens + second.usage.cacheWriteTokens,
  }
  return {
    attempts: first.attempts + second.attempts,
    usage,
    estCostUsd: Math.round((first.estCostUsd + second.estCostUsd) * 1_000_000) / 1_000_000,
    model: second.model,
    stopReason: second.stopReason,
    effort: second.effort,
  }
}

/**
 * A whole page in the layout language: one answer for every section, and,
 * where that answer and its re-ask still left a section out, one follow-up
 * asking for only those (AGL-3660). The sections that read are kept between
 * them, so the page is compiled whole once every section is designed.
 */
export async function aiRunLayoutPage(input: AiLayoutPageRunInput): Promise<AiValidatedGeneration<AiLayoutPageBuilt>> {
  const kept: Array<AiLayoutSection | null> = input.screen.sections.map(() => null)
  const observe = input.observe ?? ((check) => check)
  const base = aiLayoutPagePrompt({
    job: input.job,
    plan: input.plan,
    screen: input.screen,
    targets: input.targets,
    reusableComponents: input.reusableComponents,
  })
  const ask = (content: string, maxTokens: number, only?: readonly number[]) =>
    runValidatedGeneration<AiLayoutPageBuilt>(AI_LAYOUT_PAGE_KIND, {
      step: 'job.page',
      model: input.model,
      instructions: AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS,
      inventory: input.inventory,
      messages: [{ role: 'user', content }],
      tool: AI_LAYOUT_PAGE_TOOL,
      maxTokens,
      cutOff: { noun: 'page', smaller: 'Write shorter copy, and fewer items in each group.' },
      ...AI_LAYOUT_LANGUAGE_THINKING,
      check: observe(
        aiLayoutPageCheck({
          screen: input.screen,
          sectionIds: input.sectionIds,
          targets: input.targets,
          context: input.context,
          reusableComponents: input.reusableComponents,
          kept,
          design: aiLayoutDesignOf(input.job, input.screen.slug),
          ...(only ? { only } : {}),
        }),
      ),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  const first = await ask(base, AI_JOB_PAGE_LANGUAGE_BUDGET.maxTokens(input.model))
  const missing = aiLayoutMissingSections(kept)
  if (
    first.status !== 'needs_input' ||
    !missing.length ||
    !first.violations.every((violation) => violation.code === AI_LAYOUT_SECTION_MISSING_CODE)
  ) {
    return first
  }
  const second = await ask(
    aiLayoutMissingSectionsPrompt({ base, screen: input.screen, missing }),
    Math.min(AI_JOB_PAGE_LANGUAGE_FOLLOW_UP_TOKENS, AI_JOB_PAGE_LANGUAGE_BUDGET.maxTokens(input.model)),
    missing,
  )
  return { ...second, ...spentTogether(first, second) }
}
