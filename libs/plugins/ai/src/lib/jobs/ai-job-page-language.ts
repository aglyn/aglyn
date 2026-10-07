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
import { aiCompileLayoutPage } from '../layout-language/ai-layout-compiler'
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
import { aiLayoutStoredTree } from '../layout-language/ai-layout-store'
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
  type AiDoctrineTreeContext,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { aiGenerationWorstCaseOnTierMs, aiJobStepBudget } from './ai-job-budget'
import { aiJobBriefLine, aiPlanReferenceLines } from './ai-job-generation'
import { aiLayoutSitePages } from './ai-job-layout-site-pages'

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
 * The most one page's answer asks for. A section in the language is about
 * 120 to 250 tokens with its copy, so the largest page a plan admits — eight
 * sections — fits with room; the compiler, not the ceiling, keeps a page small.
 */
export const AI_JOB_PAGE_LANGUAGE_TOKENS = 3_000

/**
 * The time a language page pass needs: its lookup rounds, its answer and its
 * re-ask at `AI_JOB_PAGE_LANGUAGE_TOKENS` on the tier the page step is served
 * from, with the step's reads and writes.
 */
/** The most the follow-up asking only for the sections an answer left out may run to. */
export const AI_JOB_PAGE_LANGUAGE_FOLLOW_UP_TOKENS = 1_500

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
  }
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
    const items = section.items ? `; shows ${section.items} items` : ''
    return `${index + 1}. "${section.name}"${places}${items}`
  })
  const pages = targets.pages.map((page) => `${page.label} (page:${page.id})`)
  const components = targets.components.map(
    (component) =>
      `${component.name} (${component.id}; props ${Object.keys(component.props).join(', ') || 'none'})`,
  )
  return [
    `Page: "${screen.title}" at ${screen.slug}`,
    aiJobBriefLine(job),
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

/** A validated language page, stored as the page keeps it. */
export interface AiLayoutPageBuilt {
  nodes: NodesMap
  load: AiLoadEstimate | null
  settled: AiLayoutSettlement[]
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
  return (answer) => {
    const reading = aiReadLayoutPage(answer, fills.length)
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
      },
    )
    const stored = aiLayoutStoredTree(
      compiled.tree,
      'screen',
      input.context,
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
    const report = validateAiDoctrineTree(
      { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: stored.nodes },
      'page',
      {
        ...input.context,
        scrollTargetIds: input.sectionIds,
      },
    )
    const violations: AiDoctrineViolation[] = report.violations
    return {
      value: violations.length
        ? null
        : {
            nodes: stored.nodes,
            load: report.load,
            settled: [...reading.settled, ...compiled.settled],
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
      thinking: 'off',
      check: observe(
        aiLayoutPageCheck({
          screen: input.screen,
          sectionIds: input.sectionIds,
          targets: input.targets,
          context: input.context,
          reusableComponents: input.reusableComponents,
          kept,
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
