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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { aiLayoutDesignChoices, type AiLayoutDesign } from '../layout-language/ai-layout-design'
import { aiCompileLayoutFrame } from '../layout-language/ai-layout-frame'
import {
  AI_LAYOUT_FRAME_TOOL,
  AI_LAYOUT_LANGUAGE_TEXT,
  aiReadLayoutFrame,
} from '../layout-language/ai-layout-language'
import type {
  AiLayoutPage,
  AiLayoutTargets,
} from '../layout-language/ai-layout-links'
import { aiLayoutCopyCheck } from '../layout-language/ai-layout-gaps'
import { aiLayoutStoredTree } from '../layout-language/ai-layout-store'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import type { AiJob } from '../model/ai-jobs.types'
import {
  aiHomeScreenIds,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import { AI_STEP_TIERS } from '../providers/catalog'
import type { AiGenerationCheck, AiValidatedTree } from '../runtime/ai-doctrine'
import {
  validateAiDoctrineTree,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { aiSiteKindDesignLines } from '../model/ai-site-kinds'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { aiJobStepBudget } from './ai-job-budget'
import { aiJobBriefLine } from './ai-job-generation'
import {
  AI_LAYOUT_SITE_PAGES_MAX,
  aiLayoutIsHomeSlug,
  aiLayoutSitePages,
} from './ai-job-layout-site-pages'
import {
  AI_LAYOUT_FRAME_THINKING_TOKENS,
  aiLayoutPageTargets,
} from './ai-job-page-language'
import { AI_SITE_NAME_TOKEN } from './ai-layout-site-facts'

/**
 * A site's layout built in the compact layout language (AGL-3660): the layout
 * step's pass for a guided start's and a build's layout unit. The model
 * designs the header and the footer — their bands, the call to action, the
 * footer's columns and every word — in one short answer through
 * `submit_frame`, and the compiler writes the layout around what the site
 * owes it: its name as the brand, its pages as the navigation and the phone
 * menu, the Layout Slot, and the footer at the bottom of a short page
 * (`ai-layout-frame.ts`).
 */

/**
 * The most a frame's answer asks for: two sections of a few blocks each (the
 * live runs of 2026-10-07 wrote 442 to 583), and the thinking before them.
 */
export const AI_JOB_LAYOUT_LANGUAGE_TOKENS = 1_200 + AI_LAYOUT_FRAME_THINKING_TOKENS

/** A language layout pass's time, on the tier the layout step is served from. */
export const AI_JOB_LAYOUT_LANGUAGE_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.layout'],
  maxTokens: AI_JOB_LAYOUT_LANGUAGE_TOKENS,
})

/** The generation kind a frame is asked under, which the doctrine scopes. */
export const AI_LAYOUT_FRAME_KIND = 'layout-frame'

/** The language, as the frame door's cached instructions. */
export const AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      AI_LAYOUT_LANGUAGE_TEXT,
      '',
      "Now you design a site's header and footer, each one section of the language, answered with submit_frame.",
      "- header: the platform writes the site's name and its navigation itself. Choose its band and align (start, or center for a centered navigation), and give it at most one button: the call to action every page shows.",
      '- footer: a section like any other, usually a row of two or three columns: a few words about the business, the details the brief gives, and a list of links (items with to). Put no contact detail, opening hours or address in it that the brief does not give, and no gap in square brackets for one.',
    ].join('\n'),
    cacheBreakpoint: true,
  },
]

/** The site's name as the brand: the name the job was given, else the token the site's own name fills. */
export function aiLayoutSiteName(job: Pick<AiJob, 'inputs'>): string {
  const given = job.inputs?.['businessName']
  return typeof given === 'string' && given.trim()
    ? given.trim()
    : AI_SITE_NAME_TOKEN
}

/** The pages a frame's navigation links: the planned pages, else the site's own, in order. */
export function aiLayoutNavPages(
  job: Pick<AiJob, 'inputs'>,
  inventory: AiSiteInventory | null,
): AiLayoutPage[] {
  // The header and the footer link the pages the job was told (AGL-3660),
  // else the site's own, the home page always and first, labelled Home. The
  // model draws neither list, so it cannot drop a page.
  const planned = aiLayoutSitePages(job.inputs)
  const own = (inventory?.screens ?? [])
    .filter((row) => !row.template)
    .map((row) => ({ id: row.id, label: row.name, slug: row.slug }))
  const siteHome = planned.some((page) => aiLayoutIsHomeSlug(page.slug))
    ? []
    : own.filter((page) => aiLayoutIsHomeSlug(page.slug)).slice(0, 1)
  const pages = [...siteHome, ...(planned.length ? planned : own)].filter((page) => page.label.trim())
  const home = pages.find((page) => aiLayoutIsHomeSlug(page.slug))
  return [
    ...(home ? [{ ...home, label: 'Home' }] : []),
    ...pages.filter((page) => page !== home && !aiLayoutIsHomeSlug(page.slug)),
  ].slice(0, AI_LAYOUT_SITE_PAGES_MAX)
}

/** The home page the brand links: the planned home, else the site's. */
export function aiLayoutHomeId(
  pages: readonly AiLayoutPage[],
  inventory: AiSiteInventory | null,
): string | null {
  const planned = pages.find((page) => aiLayoutIsHomeSlug(page.slug))
  return planned?.id ?? aiHomeScreenIds(inventory)[0] ?? null
}

/** The frame's user turn: the site, its brief, its pages and its form. */
export function aiLayoutFramePrompt(input: {
  job: Pick<AiJob, 'brief' | '$id'> & Partial<Pick<AiJob, 'inputs'>>
  siteName: string
  pages: readonly AiLayoutPage[]
  targets: AiLayoutTargets
}): string {
  const { job, pages, targets } = input
  return [
    `Site: ${input.siteName === AI_SITE_NAME_TOKEN ? 'the business the brief describes' : `"${input.siteName}"`}`,
    aiJobBriefLine(job),
    ...aiSiteKindDesignLines(job.inputs),
    pages.length
      ? `Its pages, which the navigation links: ${pages.map((page) => `${page.label} (page:${page.id})`).join(', ')}.`
      : 'It has no pages yet.',
    targets.forms.length || targets.formPageId
      ? 'A call to action that asks a visitor to get in touch goes to form.'
      : 'The site has no form yet.',
    `Design seed: ${job.$id.slice(-6)}.`,
  ].join('\n')
}

/** A validated language layout. */
export interface AiLayoutFrameBuilt {
  rootId: string
  nodes: NodesMap
  load: AiLoadEstimate | null
  /** What the last answer's gaps took out of the frame (`ai-layout-gaps.ts`). */
  dropped: string[]
}

/** The check a frame answer is held to: read, compiled, stored and checked as a layout, with the layout door's own checks. */
export function aiLayoutFrameCheck(input: {
  /** The header arrangement the site's look chose (AGL-3660); the answer's otherwise. */
  headerAlign?: 'start' | 'center'
  siteName: string
  homeId: string | null
  pages: readonly AiLayoutPage[]
  targets: AiLayoutTargets
  extend: (tree: AiValidatedTree) => AiDoctrineViolation[]
  /** The site's design (`aiLayoutDesignOf`), whose pages' closing band the footer sits under. */
  design?: AiLayoutDesign | null
}): AiGenerationCheck<AiLayoutFrameBuilt> {
  let answers = 0
  return (answer) => {
    // The last answer a generation takes has its gaps taken out rather than asked about again.
    answers += 1
    const last = answers >= AI_GENERATION_MAX_ATTEMPTS
    const frame = aiReadLayoutFrame(answer)
    if (input.headerAlign && frame.header) frame.header.align = input.headerAlign
    const compiled = aiCompileLayoutFrame(
      frame,
      {
        siteName: input.siteName,
        homeId: input.homeId,
        navPages: input.pages,
        closesDark: input.design ? aiLayoutDesignChoices(input.design).coverClose : false,
      },
      input.targets,
    )
    const context = {
      screenIds: [
        ...new Set([
          ...input.targets.pages.map((page) => page.id),
          ...input.pages.map((page) => page.id),
          ...(input.homeId ? [input.homeId] : []),
        ]),
      ],
      formIds: input.targets.forms.map((form) => form.id),
      homeScreenIds: input.targets.homeIds,
      codeBuilt: true,
    }
    const stored = aiLayoutStoredTree(compiled.tree, 'layout', context)
    if (stored.ok === false) {
      console.error('ai layout frame: a compiled layout did not store', {
        error: stored.error,
      })
      return {
        value: null,
        violations: [
          {
            rule: null,
            code: 'layout-compile',
            message: 'This layout could not be built. Try again.',
            detail: stored.error,
          },
        ],
      }
    }
    // No gap and no internal reference in the words of a frame every published page shows.
    const navPages = [...input.targets.pages, ...input.pages]
    const copy = aiLayoutCopyCheck(
      stored.nodes,
      stored.rootId,
      {
        pages: navPages,
        ids: [...navPages.map((page) => page.id), ...input.targets.forms.map((form) => form.id)],
      },
      last,
    )
    const { nodes, dropped } = copy
    const report = validateAiDoctrineTree(
      { rootId: stored.rootId, nodes },
      'layout',
      context,
    )
    const violations = [
      ...report.violations,
      ...copy.violations,
      ...input.extend({
        rootId: stored.rootId,
        nodes,
        repairs: [],
        sourceIds: {},
        score: report.score as AiValidatedTree['score'],
        load: report.load,
      }),
    ]
    return {
      value: violations.length
        ? null
        : { rootId: stored.rootId, nodes, load: report.load, dropped },
      violations,
    }
  }
}

/** What a frame's links resolve against: the site's pages and its form, as a page's do. */
export function aiLayoutFrameTargets(
  job: Pick<AiJob, 'brief' | 'inputs'>,
  inventory: AiSiteInventory | null,
): AiLayoutTargets {
  return aiLayoutPageTargets({ job, inventory, own: [] })
}
