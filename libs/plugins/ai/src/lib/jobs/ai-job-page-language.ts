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
import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from '@aglyn/shared-util-tools/untrusted-text'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { isAiPlanNewRef, type AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import {
  aiHomeScreenIds,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import { AI_LAYOUT_POST_ADDRESS_TOKENS, aiCompileLayoutPage } from '../layout-language/ai-layout-compiler'
import { aiSiteMotionStyle, aiWithSiteMotion, type AiSiteMotionStyle } from '../layout-language/ai-layout-motion'
import { aiLayoutListingAt, aiLayoutListingsOf, aiLayoutRecordHref, type AiLayoutListing } from '../layout-language/ai-layout-listings'
import {
  AI_LAYOUT_ARRANGE_TOOL,
  AI_LAYOUT_LANGUAGE_TEXT,
  AI_LAYOUT_PAGE_TOOL,
  aiReadLayoutArrangement,
  aiReadLayoutPage,
  type AiLayoutSection,
  type AiLayoutSettlement,
} from '../layout-language/ai-layout-language'
import type {
  AiLayoutPage,
  AiLayoutTargets,
} from '../layout-language/ai-layout-links'
import { aiLayoutCopyCheck, aiLayoutWithoutSections } from '../layout-language/ai-layout-gaps'
import { aiLayoutPromisedCopyViolations, aiLayoutPromisedSections } from '../layout-language/ai-layout-promised-copy'
import { aiLayoutStoredTree } from '../layout-language/ai-layout-store'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { AI_STEP_TIERS } from '../providers/catalog'
import { aiCacheWriteHourSum } from '../providers/cache-write-hour'
import {
  aiDoctrineNeedsInputMessage,
  runValidatedGeneration,
  type AiGenerationCheck,
  type AiGenerationSpend,
  type AiValidatedGeneration,
} from '../runtime/ai-doctrine'
import type { AiUsage } from '../providers/contract'
import {
  aiSettleMechanicalRules,
  aiSettleUnrelatedScreenLinks,
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
import { aiSiteContactOf } from '../model/ai-site-details'
import {
  AI_SITE_IMPORT_ARRANGE_MAX_CHARS,
  aiCompileImportedDocument,
  aiSiteImportArrangeText,
  aiSiteImportDocLines,
  aiSiteImportDocumentOf,
  type AiSiteImportDocument,
} from './ai-site-import-document'

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

/**
 * The unit input carrying the motion of the site a build adds to (AGL-3949):
 * its stored look's kind, seed and motion style (`aiLayoutSiteMotionOf`).
 */
export const AI_LAYOUT_SITE_MOTION_INPUT = 'siteMotion'

/** The site a page's entrance motion is drawn for: its kind, seed and, where its look chose one, motion style. */
export interface AiLayoutSiteMotion {
  kind?: string
  seed: number
  motion?: AiSiteMotionStyle
}

/**
 * The motion a site's stored look names (`hosts/{id}.siteStyle`, or the
 * `AI_LAYOUT_SITE_MOTION_INPUT` read from it), read defensively: `null` for a
 * site whose look stored no seed, which a build then draws from its own job.
 */
export function aiLayoutSiteMotionOf(value: unknown): AiLayoutSiteMotion | null {
  if (!value || typeof value !== 'object') return null
  const style = value as Record<string, unknown>
  const seed = style['seed']
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null
  const kind = typeof style['kind'] === 'string' && style['kind'] ? style['kind'] : null
  const motion = aiSiteMotionStyle(style['motion'])
  return { ...(kind ? { kind } : {}), seed: seed >>> 0, ...(motion ? { motion } : {}) }
}

/** Whether this job builds its page or its layout in the layout language. */
export function aiJobUsesLayoutLanguage(job: Pick<AiJob, 'inputs'>): boolean {
  return job.inputs?.[AI_LAYOUT_LANGUAGE_INPUT] === true
}

/**
 * How the language doors think (AGL-3660): adaptively, at an effort named
 * rather than left to the model's default — a page and a site's frame are
 * designed, not transcribed.
 *
 * Low since AGL-3781. The live round of 2026-10-14 built the layout-language
 * briefs (`ai-job-layout-language-live.spec.ts`) at medium and at low: low
 * built 39 of 39 pages and 13 of 13 frames, 64 of 65 answers held their rules
 * on the first ask, and none was cut off at its ceiling. The ceilings keep
 * the thinking room sized at medium (`AI_LAYOUT_PAGE_THINKING_TOKENS`,
 * `AI_LAYOUT_FRAME_THINKING_TOKENS`), so a page that thinks longer still fits.
 */
export const AI_LAYOUT_LANGUAGE_THINKING = { thinking: 'adaptive', effort: 'low' } as const

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

/**
 * The page of a site plan that places its form: the form the plan creates, or
 * one the site has. Home only when no other page places it (AGL-3805).
 *
 * Every call to action that asks a visitor to get in touch goes here — the
 * header's button on every page, the footer's, a page's own — so a page whose
 * purpose is the form outranks the home page that closes on a copy of it. A
 * plan lists Home first, and a home page that ends "visit us or order" places
 * the form too: the first page placing it was Home, and a Spanish bakery's
 * header "Pide tu pastel" and footer "Contáctanos" (beta.253, job eg4maZMGtN)
 * linked the home page on every page, itself included, while /pasteles and
 * /visitanos held the form. Eight of the 21 newest AI-built sites linked their
 * header's call to action home the same way, six of them with such a page.
 */
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
  const placing = plan.screens.filter(
    (entry) =>
      typeof entry.id === 'string' &&
      entry.sections.some((section) =>
        section.uses.some((ref) =>
          isAiPlanNewRef(ref) ? created.has(ref.toLowerCase()) : forms.has(ref),
        ),
      ),
  )
  const screen = placing.find((entry) => !aiLayoutIsHomeSlug(entry.slug)) ?? placing[0]
  return screen?.id ?? null
}

/**
 * Every word the job was given, which a page's contact details are held to:
 * the brief, its scalar inputs, and the text of a page brought in from the
 * owner's own site (AGL-3976), whose phone and address are the owner's.
 */
export function aiLayoutFacts(job: Pick<AiJob, 'brief' | 'inputs'>): string {
  const values = Object.values(job.inputs ?? {}).filter(
    (value): value is string => typeof value === 'string',
  )
  const imported = aiLayoutImportedPageOf(job.inputs)?.text ?? ''
  return [job.brief, ...values, ...(imported ? [imported] : [])].join('\n')
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
    // The phone and email the person gave, which links call and write to (AGL-3979).
    contact: aiSiteContactOf(job.inputs),
    // The site's catalog and blog, and the sections that list them (AGL-3676),
    // and its datasets (AGL-3616).
    listings: aiLayoutListingsWithDatasets(aiLayoutListingsOf(job.inputs), inventory),
  }
}

/**
 * A page's listings with each dataset's held to the site's inventory
 * (AGL-3616): a records listing is kept only where the site has the dataset —
 * the tree check admits a repeat over no other, and a card left repeating
 * over nothing would show its `{{item.*}}` — and one that names no fields
 * takes the inventory's, in the dataset's order. Its cards link the record
 * pages the plan makes, else those the site already serves (AGL-3747).
 */
export function aiLayoutListingsWithDatasets(
  listings: readonly AiLayoutListing[],
  inventory: Pick<AiSiteInventory, 'datasets'> | null,
): AiLayoutListing[] {
  return listings.flatMap((listing) => {
    if (listing.kind !== 'records') return [listing]
    const row = inventory?.datasets.find((dataset) => dataset.id === listing.datasetId)
    if (!row) return []
    // The photo field is the card's picture, never its words (AGL-3616).
    const imageField = listing.imageField ?? row.imageField
    // The address is the card's link to its record's page, never its words (AGL-3727).
    const addressField = listing.addressField ?? row.addressField
    // A record page the site already serves for the dataset (AGL-3747), where
    // the plan makes none of its own.
    const recordBase = listing.recordBase ?? row.recordBase
    const fields = (
      listing.fields?.length
        ? listing.fields
        : row.fields.map((name, index) => ({ id: row.fieldIds?.[index] || name, name, type: 'text' }))
    ).filter((field) => field.id !== imageField && field.id !== addressField)
    return fields.length
      ? [
          {
            ...listing,
            fields,
            ...(imageField ? { imageField } : {}),
            ...(recordBase && addressField ? { recordBase, addressField } : {}),
          },
        ]
      : []
  })
}

/**
 * The page check's context with what a section listing the blog's posts
 * binds (AGL-3676): each post's card links its post and shows its cover by
 * the tokens the page fills per post, which a page's store admits whole only
 * where a listing places them. A dataset's card shows its record's photo
 * the same way (AGL-3616), by `{{item.<photo field>}}`. And the page that
 * places the site's form, which a call to action asking a visitor to get in
 * touch links even when it is home (AGL-3729).
 */
export function aiLayoutListingContext(
  context: AiDoctrineTreeContext,
  targets: AiLayoutTargets,
): AiDoctrineTreeContext {
  if (targets.formPageId) context = { ...context, formScreenIds: [targets.formPageId] }
  const here = (targets.listings ?? []).filter((listing) =>
    listing.placements.some((placement) => placement.screenId === targets.pageId),
  )
  const tokens = [
    ...(here.some((listing) => listing.kind === 'posts') ? AI_LAYOUT_POST_ADDRESS_TOKENS : []),
    ...here.flatMap((listing) => (listing.kind === 'records' && listing.imageField ? [`{{item.${listing.imageField}}}`] : [])),
    // Each card's link to its record's own page (AGL-3727), admitted whole.
    ...here.flatMap((listing) => {
      const href = aiLayoutRecordHref(listing)
      return href ? [href] : []
    }),
  ]
  if (!tokens.length) return context
  return { ...context, bindingTokens: [...new Set([...(context.bindingTokens ?? []), ...tokens])] }
}

/** The most of the text of the page a planned page starts from that its prompt shows: about 1,000 tokens (AGL-3832). */
export const AI_LAYOUT_START_PAGE_MAX_CHARS = 4_000

/** The site's page a planned page starts from (its plan's `duplicateOf`), by its name and its words. */
export interface AiLayoutStartPage {
  label: string
  text: string
}

/**
 * The page a planned page starts from, as its prompt shows it (AGL-3832): its
 * words, never its tree. A page in the layout language is written whole, so
 * a copy of the page would be replaced by the answer, and what the copy was
 * for — what the site already says there — reaches the page only through
 * the model. Empty when the page has no words to show.
 */
export function aiLayoutStartPageLines(start: AiLayoutStartPage | null | undefined): string[] {
  const text = start?.text.trim() ?? ''
  if (!start || !text) return []
  const shown = text.length > AI_LAYOUT_START_PAGE_MAX_CHARS ? `${text.slice(0, AI_LAYOUT_START_PAGE_MAX_CHARS).trimEnd()} …` : text
  return [
    `This page starts from the site's page "${start.label}": keep its facts, names and details wherever a section below covers them, and design every section anew. Its text:`,
    shown,
  ]
}

/**
 * The unit input carrying a page a site import brings in (AGL-3976): its
 * address on the owner's own website and its text as that site shows it. It
 * reaches the model only fenced as untrusted data, under
 * `UNTRUSTED_TEXT_RULE`, and only on a job the import step derives — a
 * member's own job carries none, because the create door's inputs are
 * scalars and this is an object.
 */
export const AI_LAYOUT_IMPORTED_PAGE_INPUT = 'importedPage'

/** A page brought in, as the import step hands it to the page step. */
export interface AiLayoutImportedPage {
  /** Where the page is on the owner's website. */
  url: string
  /** Its title, headings and text in order, as the crawler extracted them. */
  text: string
}

/** The most characters of an imported page's text a prompt shows. */
export const AI_LAYOUT_IMPORTED_PAGE_MAX_CHARS = 6_000

/** The imported page a job's inputs carry, read defensively; `null` on every other job. */
export function aiLayoutImportedPageOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiLayoutImportedPage | null {
  const raw = inputs?.[AI_LAYOUT_IMPORTED_PAGE_INPUT]
  if (!raw || typeof raw !== 'object') return null
  const { url, text } = raw as Record<string, unknown>
  if (typeof url !== 'string' || typeof text !== 'string' || !text.trim()) return null
  return { url: url.slice(0, 2048), text }
}

/**
 * What a page brought in from the owner's site is told (AGL-3976): rewrite
 * it into the planned sections, keeping its facts, and the text itself,
 * fenced. The fence and the system block's rule are what keep the page's own
 * words — "ignore your instructions" on a hostile page — data.
 */
export function aiLayoutImportedPageLines(page: AiLayoutImportedPage | null): string[] {
  if (!page) return []
  return [
    'This page is the site owner\'s own page, brought in from their current website. Rewrite its content into the sections below, in its own language: keep its facts, names, prices, hours, services and details wherever a section covers them, and leave a gap in square brackets for a fact it does not give rather than invent one. Leave out cookie notices, sign-in, carts, the old site\'s own tools and anything about the website builder it was made with. Draw no form, embed or script of its own, and design every section anew. Its text, as that site shows it:',
    fenceUntrustedText(`The owner's page ${page.url}`, page.text, { maxChars: AI_LAYOUT_IMPORTED_PAGE_MAX_CHARS }),
  ]
}

/**
 * The page door's system blocks for this job: the language's cached
 * instructions, and for a page brought in from the owner's site the rule
 * that fenced text is data (AGL-3976), a static block of its own so every
 * imported page shares one cached prefix and no other page's changes.
 */
export function aiJobPageLanguageInstructions(job: Pick<AiJob, 'inputs'>): readonly AiSystemBlock[] {
  return aiLayoutImportedPageOf(job.inputs)
    ? [...AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS, { text: UNTRUSTED_TEXT_RULE }]
    : AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS
}

/**
 * What a page is told about the site's form (AGL-3899). A page whose plan
 * places the form, or a site whose form has no page of its own, is told the
 * form; any other page is told where the form lives and that its call to
 * action links there. Told "The site's form: …" on every page, two of the
 * newest production homes drew the form on their own, beside the Contact
 * page that held it.
 */
export function aiLayoutFormLine(screen: Pick<AiBuildPlanScreen, 'sections'>, targets: AiLayoutTargets): string {
  if (!targets.forms.length) return 'The site has no saved form: place none.'
  const ids = new Set(targets.forms.map((form) => form.id))
  const placed = screen.sections.some((section) => section.uses.some((ref) => ids.has(ref)))
  const page = targets.formPageId ? targets.pages.find((entry) => entry.id === targets.formPageId) : undefined
  if (placed || !page) return `The site's form: ${targets.forms.map((form) => `${form.name} (${form.id})`).join(', ')}.`
  return `The site's form is on the ${page.label} page (page:${page.id}): place no form on this page, and make a call to action that asks visitors to get in touch a button to that page.`
}

/** The page's user turn: the page, the brief, the plan, its sections and where its links may go. */
export function aiLayoutPagePrompt(input: {
  job: Pick<AiJob, 'brief' | 'inputs' | '$id'>
  plan: AiJobPlan
  screen: AiBuildPlanScreen
  targets: AiLayoutTargets
  reusableComponents: boolean
  /** The site's page the plan starts this page from, read off the site (AGL-3832). */
  startsFrom?: AiLayoutStartPage | null
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
    if (listed?.listing.kind === 'tracks') {
      // A music site's player (AGL-3716): placed empty, for the owner's own uploads.
      return `${index + 1}. "${section.name}"${places}; the platform places a music player here for the artist's own tracks, which they add themselves: write only its heading and a line inviting visitors to listen, and no cards, list, images or links for songs`
    }
    if (listed?.listing.kind === 'events') {
      // The site's own dated events (AGL-3755), listed by the platform with their dates.
      const names = listed.listing.records.length ? ` (${listed.listing.records.map((name) => `"${name}"`).join(', ')})` : ''
      return `${index + 1}. "${section.name}"${places}; the platform lists the site's upcoming events here${names} with their dates, places and photos: write only its heading and a line inviting visitors to come, and no cards, dates, list or links for events`
    }
    if (listed?.listing.kind === 'reviews') {
      // A store's own reviews (AGL-3676): shoppers write them; none is ever written here.
      return `${index + 1}. "${section.name}"${places}; the platform shows the store's real customer reviews here with their star ratings, once shoppers leave them: write only its heading, and no quotes, names, ratings or cards`
    }
    if (listed?.listing.kind === 'signup') {
      // A store's newsletter field (AGL-3676), placed by the platform.
      return `${index + 1}. "${section.name}"${places}; the platform places the newsletter sign-up field here: write its heading and one line on what subscribers hear about, from the brief, and no form, button or offer the brief does not make`
    }
    if (listed?.listing.kind === 'records') {
      // One of the site's datasets (AGL-3616), repeated by the platform over its records.
      // A section named for one group lists that group's records alone (AGL-3921).
      const shown = listed.filter?.records.length ? listed.filter.records : listed.listing.records
      const names = shown.length ? ` (${shown.slice(0, 6).map((name) => `“${name}”`).join(', ')})` : ''
      return `${index + 1}. "${section.name}"${places}; the platform lists the records of the dataset “${listed.listing.name}”${names} here itself, one card each: write only its heading and a line about them, and no cards, list or images for them`
    }
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
    ...aiLayoutStartPageLines(input.startsFrom),
    // A page brought in from the owner's own site (AGL-3976), fenced.
    ...aiLayoutImportedPageLines(aiLayoutImportedPageOf(job.inputs)),
    `Sections to design, in order:`,
    ...sections,
    pages.length
      ? `Other pages of this site: ${pages.join(', ')}.`
      : 'This site has no other page to link.',
    aiLayoutFormLine(screen, targets),
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

/**
 * The site a page's entrance motion is drawn for (AGL-3838): its design where
 * the job names a kind of site, else the job's own seed, which moves in the
 * standard mood — so every page of one site moves alike. The motion style its
 * look chose rides along (AGL-3941); a job whose look chose none — one from
 * before the look did, a replay of one, a job with no look — moves in its
 * kind's mood. A unit a build makes on an existing site carries the site's
 * stored motion instead (`AI_LAYOUT_SITE_MOTION_INPUT`, AGL-3949), so a page
 * added later moves the way the site's own pages do.
 */
export function aiLayoutMotionSiteOf(
  job: Pick<AiJob, '$id' | 'inputs'>,
  slug: string,
): AiLayoutSiteMotion {
  const style = job.inputs?.['siteStyle'] as Record<string, unknown> | undefined
  if (!style) {
    const stored = aiLayoutSiteMotionOf(job.inputs?.[AI_LAYOUT_SITE_MOTION_INPUT])
    if (stored) return stored
  }
  const motion = aiSiteMotionStyle(style?.['motion'])
  const { kind, seed } = aiLayoutDesignOf(job, slug) ?? { seed: aiSiteSeed(aiOriginJobId(job)) }
  return { ...(kind ? { kind } : {}), seed, ...(motion ? { motion } : {}) }
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
  /** The site's language, which the compiler's own words are written in (AGL-3760); absent, English. */
  language?: string
  /** The site the page's entrance motion is drawn for (`aiLayoutMotionSiteOf`); absent, its design. */
  motion?: AiLayoutSiteMotion
  /** Whether copy may promise what is coming (a coming-soon site, AGL-3887); absent, it may not. */
  promisesAllowed?: boolean
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

/** The plan indices of the sections that show fewer of their planned items than they must (AGL-3660). */
export function aiLayoutShortItemSections(
  screen: Pick<AiBuildPlanScreen, 'sections'>,
  items: readonly number[],
  quotesOnly: readonly number[] = [],
): number[] {
  return screen.sections.flatMap((section, index) => {
    if (quotesOnly.includes(index)) return []
    const least = leastItems(section.items)
    return least && (items[index] ?? 0) < least ? [index] : []
  })
}

/**
 * What a page built in the layout language says about the planned sections
 * it was published without (AGL-3771): each one the last answer could not
 * fill, or left with only its heading once its gaps were taken out, rather
 * than the page refused. `null` when every section is shown.
 */
export function aiLayoutLeftOutNote(
  screen: Pick<AiBuildPlanScreen, 'sections'>,
  sectionIds: readonly string[],
  nodes: Readonly<Record<string, unknown>>,
): string | null {
  const names = screen.sections.flatMap((section, index) =>
    index > 0 && sectionIds[index] && !(sectionIds[index] in nodes) ? [`“${section.name}”`] : [],
  )
  if (!names.length) return null
  return names.length === 1
    ? `Left out: the section ${names[0]}, which could not be built well enough to publish. Add it in the Besigner when you are ready.`
    : `Left out: the sections ${names.join(', ')}, which could not be built well enough to publish. Add them in the Besigner when you are ready.`
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
  /** Sections the page no longer shows (AGL-3771), which ask for nothing. */
  emptied: readonly number[] = [],
): AiDoctrineViolation[] {
  const short = aiLayoutShortItemSections(screen, items, quotesOnly)
  return screen.sections.flatMap((section, index): AiDoctrineViolation[] => {
    if (!short.includes(index) || emptied.includes(index)) return []
    const shown = items[index] ?? 0
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
 * Rule 1's repeats said as the layout language fixes them (AGL-3988). Its
 * own words ask for "one reusable component with props", which a page
 * answer cannot make: the beta.270 Sugar Hollow Galleries page was re-asked
 * with them and node ids it never wrote, broke the rule the same way, and
 * was refused. Each repeat now names the sections it sits in and how the
 * language says like blocks once: one group, an item each.
 */
export function aiLayoutRepeatsSaidInTheLanguage(
  violations: readonly AiDoctrineViolation[],
  nodes: Readonly<Record<string, { nodes?: string[] }>>,
  sectionIds: readonly string[],
  sections: ReadonlyArray<{ name: string }>,
): AiDoctrineViolation[] {
  const parentOf = new Map<string, string>()
  for (const [id, node] of Object.entries(nodes)) for (const child of node?.nodes ?? []) parentOf.set(child, id)
  const sectionOf = (id: string): number => {
    for (let at: string | undefined = id; at !== undefined; at = parentOf.get(at)) {
      const index = sectionIds.indexOf(at)
      if (index >= 0) return index
    }
    return -1
  }
  return violations.map((violation) => {
    if (violation.code !== 'repeated-subtree') return violation
    const where = [...new Set((violation.nodeIds ?? []).map(sectionOf).filter((index) => index >= 0))]
      .sort((a, b) => a - b)
      .map((index) => `section ${index + 1} ("${sections[index]?.name ?? ''}")`)
    return {
      ...violation,
      detail: `${where.length ? `In ${where.join(' and ')}: ` : ''}write like blocks once, as one cards, steps or list block with an item for each (its title, its words and where it goes), never the same blocks repeated in several columns or groups.`,
    }
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
        ...(input.language ? { language: input.language } : {}),
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
    const dropped = [...copy.dropped]
    // An attribute a rule has one answer for is settled, not asked of the model again (AGL-3660),
    // and a link sent home for nothing is sent to the form or left out (AGL-3729).
    // And on the last answer, a link that goes nowhere, as the check below reads it (AGL-4076).
    let nodes = aiSettleUnrelatedScreenLinks(
      aiSettleMechanicalRules(
        { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: copy.nodes as unknown as Record<string, AiDoctrineNode> },
        'page',
        last
          ? {
              ...context,
              scrollTargetIds: input.sectionIds,
              ownScreenIds: input.targets.pageId ? [input.targets.pageId] : [],
            }
          : undefined,
      ),
      'page',
      { ...context, ownScreenIds: input.targets.pageId ? [input.targets.pageId] : [] },
    ).nodes as unknown as typeof copy.nodes
    // Each section's items as they are stored, after anything the gaps took out.
    const items = aiLayoutShownItems(compiled.itemIds, stored.storedIds, nodes as unknown as Record<string, unknown>)
    // The last answer's sections that still show none of their planned items
    // are taken out rather than the whole page refused (AGL-3771): a site
    // start's home refused for one such section published a site with
    // nothing at its address. The page's first section heads it, and is
    // never taken out.
    const emptied = last
      ? aiLayoutShortItemSections(input.screen, items, compiled.quotesOnly).filter((index) => index > 0 && !!input.sectionIds[index])
      : []
    if (emptied.length) {
      const without = aiLayoutWithoutSections(
        nodes,
        CANVAS_ROOT_ELEMENT_ID,
        emptied.map((index) => ({
          id: input.sectionIds[index],
          name: input.screen.sections[index].name,
          why: `planned with ${input.screen.sections[index].items} items and showing ${items[index] || 'none'}`,
        })),
      )
      nodes = without.nodes as typeof nodes
      dropped.push(...without.dropped)
    }
    // A section that promises its content later — "We are building this
    // space" — is asked for again, and the last answer's is taken out, the
    // page's first section aside (AGL-3887). A coming-soon site's is its point.
    const promised = input.promisesAllowed ? [] : aiLayoutPromisedSections(nodes, input.sectionIds)
    const promisedOut = last ? promised.filter(({ index }) => index > 0) : []
    if (promisedOut.length) {
      const without = aiLayoutWithoutSections(
        nodes,
        CANVAS_ROOT_ELEMENT_ID,
        promisedOut.map(({ index }) => ({
          id: input.sectionIds[index],
          name: input.screen.sections[index].name,
          why: 'which promised content that is not there',
        })),
      )
      nodes = without.nodes as typeof nodes
      dropped.push(...without.dropped)
    }
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
    // A street address or opening hours the job was never given is invented
    // (rule 14, AGL-3596), the same check a layout is held to; a phone number
    // or an email the compiler already writes as its gap.
    const violations: AiDoctrineViolation[] = [
      ...aiLayoutRepeatsSaidInTheLanguage(report.violations, nodes as unknown as Record<string, { nodes?: string[] }>, input.sectionIds, input.screen.sections),
      ...copy.violations,
      ...aiLayoutEmptyItemSections(input.screen, items, compiled.quotesOnly, emptied),
      ...(last ? [] : aiLayoutPromisedCopyViolations(input.screen, promised)),
      ...aiLayoutInventedContactViolations(
        { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: nodes as unknown as Record<string, AiDoctrineNode> },
        input.targets.facts,
      ),
    ]
    return {
      value: violations.length
        ? null
        : {
            // Entrance motion is the site's, decided here in code and never
            // asked of the model (AGL-3838): written once the page has passed,
            // so no check above reads a prop the palette does not list.
            nodes: aiWithSiteMotion(nodes, input.motion ?? input.design ?? { seed: 0 }, { sectionIds: input.sectionIds }),
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
  /** The site's page the plan starts this page from (AGL-3832). */
  startsFrom?: AiLayoutStartPage | null
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
    ...aiCacheWriteHourSum(first.usage, second.usage),
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
  // A page brought in from the owner's own site is never written (AGL-4084).
  const imported = aiSiteImportDocumentOf(input.job.inputs)
  if (imported) return aiRunImportedPage(input, imported)
  const kept: Array<AiLayoutSection | null> = input.screen.sections.map(() => null)
  const observe = input.observe ?? ((check) => check)
  const base = aiLayoutPagePrompt({
    job: input.job,
    plan: input.plan,
    screen: input.screen,
    targets: input.targets,
    reusableComponents: input.reusableComponents,
    startsFrom: input.startsFrom ?? null,
  })
  const ask = (content: string, maxTokens: number, only?: readonly number[]) =>
    runValidatedGeneration<AiLayoutPageBuilt>(AI_LAYOUT_PAGE_KIND, {
      step: 'job.page',
      model: input.model,
      instructions: aiJobPageLanguageInstructions(input.job),
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
          motion: aiLayoutMotionSiteOf(input.job, input.screen.slug),
          ...(only ? { only } : {}),
          ...(input.plan.language ? { language: input.plan.language } : {}),
          promisesAllowed: aiSiteKindOfInputs(input.job.inputs)?.id === 'coming-soon',
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

/*------------------------------------------
 * A page brought in: copied, or arranged (AGL-4084)
 *-----------------------------------------*/

/**
 * What an arranged page's answer is told (AGL-4084), cached: the page's words
 * are the source's and fixed, and the answer only lays them out. The tool has
 * no field for a word of copy, so a rewording has nowhere to go.
 */
export const AI_LAYOUT_ARRANGE_TEXT = [
  "You arrange a page brought in from its owner's own website. Arrange; keep every line as written; add nothing; reword nothing. Its words are fixed: every line of the page is shown numbered, and the platform places each line you name exactly as its source wrote it, in the site's theme. You never write a word of copy.",
  '',
  'Answer with submit_arrangement: one entry in sections for each section of the page, in order. A section has:',
  '- band: plain (the page background), soft (a light band) or dark. Vary the bands down the page so neighboring sections read apart, and keep dark to one or two sections a page.',
  '- cols: [] for one column, or relative column widths for a row, such as [1, 1] or [7, 5]; at most 4.',
  '- align: start or center.',
  '- blocks: top to bottom. A block has kind, col (-1 to span the section, or the column of the row it sits in, 0 first), from (the numbers of the lines it shows, in order), style (primary, secondary or quiet for a button, none otherwise) and items.',
  '',
  'Block kinds: heading, eyebrow, lede, text and note show their lines one under another; list shows each of its lines as an item; cards, steps, stats and faq show items, each item\'s from its title line first and then its text lines (from is then []); button is a line that is a link; image is a line that is a picture.',
  "Every line goes in exactly one block of its own section. Name no line twice and no line of another section. A line you leave out is still shown, at the end of its section, so leave none out on purpose. The page's first section opens with its heading line.",
].join('\n')

/** The arranged page's cached instructions, and the rule that fenced text is data. */
export const AI_JOB_PAGE_ARRANGE_INSTRUCTIONS: readonly AiSystemBlock[] = [
  { text: AI_LAYOUT_ARRANGE_TEXT, cacheBreakpoint: true },
  { text: UNTRUSTED_TEXT_RULE },
]

/** An arranged page's user turn: the page, the kind of site it is, and its numbered lines, fenced. */
export function aiLayoutArrangePrompt(input: {
  job: Pick<AiJob, 'inputs' | '$id'>
  screen: Pick<AiBuildPlanScreen, 'title' | 'slug' | 'sections'>
  doc: Pick<AiSiteImportDocument, 'blocks' | 'title' | 'url'>
}): string {
  const { sections } = aiSiteImportDocLines(input.doc.blocks, input.doc.title)
  return [
    `Page: "${input.screen.title}" at ${input.screen.slug}`,
    ...aiSiteKindDesignLines(input.job.inputs),
    `Its ${sections.length === 1 ? 'one section' : `${sections.length} sections`}, each with its numbered lines:`,
    fenceUntrustedText(`The owner's page ${input.doc.url}`, aiSiteImportArrangeText(input.doc), { maxChars: AI_SITE_IMPORT_ARRANGE_MAX_CHARS }),
    `Design seed: ${input.job.$id.slice(-6)}.`,
  ].join('\n')
}

/**
 * The check a page brought in is held to (AGL-4084): the arrangement read
 * (or none, for a page copied as it is), the source's lines substituted
 * into it, the page stored and checked whole as a page of the owner's own
 * words. Nothing in an answer can change a word.
 */
export function aiImportedPageCheck(
  input: Pick<AiLayoutPageCheckInput, 'screen' | 'sectionIds' | 'targets' | 'context' | 'motion' | 'design'> & { doc: AiSiteImportDocument },
): (answer: Record<string, unknown> | null) => { value: AiLayoutPageBuilt | null; violations: AiDoctrineViolation[] } {
  const context = { ...aiLayoutListingContext(input.context, input.targets), ownWords: true }
  return (answer) => {
    const arrangement = answer && input.doc.build === 'arranged' ? aiReadLayoutArrangement(answer, input.sectionIds.length) : null
    const compiled = aiCompileImportedDocument({ doc: input.doc, sectionIds: input.sectionIds, pages: input.targets.pages, arrangement })
    const stored = aiLayoutStoredTree(compiled.tree, 'screen', context, input.sectionIds)
    if (stored.ok === false) {
      console.error('ai imported page: a compiled page did not store', { error: stored.error })
      return {
        value: null,
        violations: [{ rule: null, code: 'layout-compile', message: 'This page could not be built. Try again.', detail: stored.error }],
      }
    }
    const report = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: stored.nodes }, 'page', {
      ...context,
      scrollTargetIds: input.sectionIds,
      repeatsCompiled: true,
    })
    if (report.violations.length) return { value: null, violations: report.violations }
    return {
      value: {
        nodes: aiWithSiteMotion(stored.nodes, input.motion ?? input.design ?? { seed: 0 }, { sectionIds: input.sectionIds }),
        load: report.load,
        settled: [],
        dropped: [],
        items: input.sectionIds.map(() => 0),
      },
      violations: [],
    }
  }
}

/** The most an arrangement answer runs to: a few hundred tokens of line numbers, inside a page's ceiling. */
export const AI_LAYOUT_ARRANGE_KIND = AI_LAYOUT_PAGE_KIND

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/**
 * A page brought in (AGL-4084). Copied as it is: compiled by code, no model
 * at all, nothing spent. Arranged: one answer on the page step's tier that
 * lays the numbered lines out, every word still the source's.
 */
async function aiRunImportedPage(input: AiLayoutPageRunInput, doc: AiSiteImportDocument): Promise<AiValidatedGeneration<AiLayoutPageBuilt>> {
  const check = aiImportedPageCheck({
    screen: input.screen,
    sectionIds: input.sectionIds,
    targets: input.targets,
    context: input.context,
    design: aiLayoutDesignOf(input.job, input.screen.slug),
    motion: aiLayoutMotionSiteOf(input.job, input.screen.slug),
    doc,
  })
  if (doc.build === 'copied') {
    const spend = { attempts: 0, usage: NO_USAGE, estCostUsd: 0, model: input.model, stopReason: null, effort: null }
    const result = check(null)
    return result.value
      ? { ...spend, status: 'ok', value: result.value }
      : { ...spend, status: 'needs_input', violations: result.violations, message: aiDoctrineNeedsInputMessage(result.violations), answer: null }
  }
  const observe = input.observe ?? ((inner) => inner)
  return runValidatedGeneration<AiLayoutPageBuilt>(AI_LAYOUT_ARRANGE_KIND, {
    step: 'job.page',
    model: input.model,
    instructions: AI_JOB_PAGE_ARRANGE_INSTRUCTIONS,
    // The lines are the whole question: no lookup of the site is offered.
    inventory: null,
    messages: [{ role: 'user', content: aiLayoutArrangePrompt({ job: input.job, screen: input.screen, doc }) }],
    tool: AI_LAYOUT_ARRANGE_TOOL,
    maxTokens: AI_JOB_PAGE_LANGUAGE_BUDGET.maxTokens(input.model),
    cutOff: { noun: 'page', smaller: 'Use fewer blocks: give each block more of its lines.' },
    ...AI_LAYOUT_LANGUAGE_THINKING,
    check: observe((answer) => check(answer)),
    ...(input.signal ? { signal: input.signal } : {}),
  })
}
