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

import {
  AI_BUILD_PLAN_CREATION_NOUNS,
  aiPlanUndeclaredRefs,
  type AiBuildPlan,
  type AiBuildPlanCreateKind,
} from './ai-build-plan'
import { AI_PAGE_CREATE_KINDS } from './ai-page-job'

/**
 * What a site scaffold is (AGL-2911): the inputs a `site` job is admitted
 * with, the plans a scaffold can build, and what one is estimated to cost
 * before it starts.
 *
 * A scaffold is the one job kind that builds a whole site rather than one
 * record: a plan of four to eight screens, the layout they render inside,
 * the contact form they place, a palette suggestion, and — where the email
 * step is loaded — a welcome email. It builds each of those through the job
 * kind that already owns it, so this module describes what a scaffold may
 * ask for and refuses the rest at confirmation, before a credit is spent,
 * naming what to make first.
 *
 * ── The estimate is the guard rail ───────────────────────────────────────
 *
 * A scaffold is tens of model calls, where every other kind is a few, so the
 * member reads what it will cost before they confirm the plan that spends
 * it. The figure is the machine's own nominal credits per step multiplied by
 * the passes the plan implies — an estimate, and said to be one wherever it
 * is shown.
 *
 * This module imports nothing at runtime, so the doors, the step, the batch
 * card and the plan proposal read one vocabulary.
 */

/** How many pages a scaffold builds: enough to be a site, few enough to read. */
export const AI_SITE_PAGES = { min: 4, max: 8 } as const

/**
 * The most sections one scaffolded page may hold. The plan model allows more
 * for a page job, which builds one page; a scaffold builds eight, and each
 * section is a pass of its own.
 */
export const AI_SITE_MAX_SECTIONS = 8

/**
 * Sections a page is assumed to hold before a plan names them, for the
 * estimate a member reads when they ask for a scaffold. A declared
 * assumption, not a measurement: the plan's own section counts replace it
 * the moment the plan exists.
 */
export const AI_SITE_NOMINAL_SECTIONS = 5

/**
 * The credits one pass is held against: the machine's
 * `AI_JOB_STEP_RESERVE_CREDITS`, declared here so the estimate stays a pure
 * number the console computes without the Admin SDK. `ai-site-job.spec.ts`
 * holds the two equal.
 */
export const AI_SITE_PASS_CREDITS = 50

/** The longest a scaffold's scalar inputs may run; they are names, not copy. */
export const AI_SITE_INPUT_MAX_CHARS = 120

/** The sites one agency batch may generate for in one request. */
export const AI_SITE_BATCH_MAX = 25

/**
 * The sites a plan must hold before the org Sites page offers the batch at
 * all: the Agency and Advanced bands, which the plan's `hostLimit` is what
 * distinguishes.
 */
export const AI_SITE_BATCH_MIN_HOST_LIMIT = 25

export interface AiSiteJobInputs {
  /** What the business is, in a few words: the brief's subject. */
  businessType: string
  /**
   * Who the site is for, in a few words (AGL-2918); empty when nobody said.
   * The plan step puts it in front of the model on a line of its own, as it
   * does every other scalar here, so it narrows the pages a plan proposes
   * without a prompt of its own.
   */
  audience: string
  /**
   * The starter site whose shape the person liked (AGL-2918), by its
   * `STARTER_TEMPLATES` id; empty when they picked none.
   *
   * A hint carried as the id rather than the starter, because an id is what
   * the guided start's list, this door and the plan's line all agree on
   * without any of them loading a catalog of node maps. Unrecognized ids are
   * admitted for the same reason an unrecognized business type is: it is a
   * few words in a brief, not a lookup.
   */
  starter: string
  /** How many pages the member asked for. */
  pages: number
  /** The per-site variables an agency batch varies; empty when none was given. */
  businessName: string
  city: string
  brand: string
  /** Whether the scaffold also drafts a welcome email. */
  welcomeEmail: boolean
  /**
   * Where the contact form's submissions go (AGL-2918); `null` where nobody
   * said, which is every job created before the question existed and every
   * door that does not ask it.
   *
   * The one setting a new site owner actually needs made, and the one thing
   * about a contact form a model cannot know: whether a submission is a note
   * to read or a lead to chase is a decision about how the business runs. So
   * an answer BINDS the form step rather than hinting to it, and `null`
   * leaves the model's own proposal standing, exactly as it stood before.
   */
  submissions: AiSiteSubmissions | null
  /** The batch this job was created under (AGL-2911); `null` for a single site. */
  batchId: string | null
}

/**
 * Where a site's contact form sends what a visitor writes.
 *
 * Two, not three. The form step's own vocabulary has a third — a mailing
 * list — which it can only answer with a note, because the stored routing has
 * no place for a list; offering it as a question would be asking somebody to
 * pick an outcome the platform then explains it cannot store.
 */
export const AI_SITE_SUBMISSIONS = ['inbox', 'lead'] as const

export type AiSiteSubmissions = (typeof AI_SITE_SUBMISSIONS)[number]

/** Where a job's inputs say submissions go, or `null` where they do not say. */
export function aiSiteSubmissions(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiSiteSubmissions | null {
  const value = inputs?.['submissions']
  return (AI_SITE_SUBMISSIONS as readonly unknown[]).includes(value)
    ? (value as AiSiteSubmissions)
    : null
}

const ID_CHARS = /^[A-Za-z0-9_-]{1,64}$/

/** A scaffold's inputs, or the sentence the door refuses them with. */
export function parseAiSiteJobInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiSiteJobInputs | string {
  const text = (key: string): string | null => {
    const value = inputs?.[key]
    if (value === undefined || value === null || value === '') return ''
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > AI_SITE_INPUT_MAX_CHARS ? null : trimmed
  }
  const businessType = text('businessType')
  if (businessType === null) {
    return `businessType must be text under ${AI_SITE_INPUT_MAX_CHARS} characters`
  }
  if (!businessType) return 'Say what kind of business the site is for'
  const businessName = text('businessName')
  const city = text('city')
  const brand = text('brand')
  const audience = text('audience')
  const starter = text('starter')
  for (const [key, value] of [
    ['businessName', businessName],
    ['city', city],
    ['brand', brand],
    ['audience', audience],
    ['starter', starter],
  ] as const) {
    if (value === null)
      return `${key} must be text under ${AI_SITE_INPUT_MAX_CHARS} characters`
  }
  const rawPages = inputs?.['pages']
  const pages =
    typeof rawPages === 'number' ? rawPages : Number(rawPages ?? NaN)
  if (
    !Number.isInteger(pages) ||
    pages < AI_SITE_PAGES.min ||
    pages > AI_SITE_PAGES.max
  ) {
    return `pages must be a whole number from ${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max}`
  }
  // Where submissions go is admitted only as one of the two the form step
  // can actually bind; anything else is nobody having said, and the model
  // proposes as it always did rather than the door refusing the whole job.
  const submissions = aiSiteSubmissions(inputs)
  const rawBatch = inputs?.['batchId']
  const batchId =
    rawBatch === undefined || rawBatch === null || rawBatch === ''
      ? null
      : typeof rawBatch === 'string' && ID_CHARS.test(rawBatch)
        ? rawBatch
        : undefined
  if (batchId === undefined) return 'batchId is not a batch id'
  return {
    businessType,
    audience: audience as string,
    starter: starter as string,
    pages,
    businessName: businessName as string,
    city: city as string,
    brand: brand as string,
    welcomeEmail: inputs?.['welcomeEmail'] !== false,
    submissions,
    batchId,
  }
}

/**
 * What the site itself is, as a step that is NOT the scaffold reads it off a
 * job's inputs (AGL-2918).
 *
 * A scaffold delegates unit by unit under a job derived from its own — a page
 * job, a form job — and the derived job carries the scaffold's inputs. So the
 * two answers that describe the site rather than one record of it are
 * readable by every delegated step, and a step that wants them does not have
 * to know it was delegated to.
 *
 * Lenient where {@link parseAiSiteJobInputs} is strict, because it reads the
 * inputs of jobs that are not scaffolds: a page job started from the Screens
 * page has no `businessType` and no `pages`, and that is not an error here —
 * it is a site nobody described, and the answer is two empty strings.
 */
export interface AiSiteWords {
  /** What kind of site it is; empty when the job's inputs do not say. */
  about: string
  /** Who it is for; empty when the job's inputs do not say. */
  audience: string
}

/** Whether either half of {@link AiSiteWords} says anything. */
export function aiSiteWordsSaidAnything(words: AiSiteWords): boolean {
  return Boolean(words.about || words.audience)
}

/** What a job's inputs say the site is, read defensively and trimmed to the input ceiling. */
export function aiSiteWords(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiSiteWords {
  const read = (key: string): string => {
    const value = inputs?.[key]
    if (typeof value !== 'string') return ''
    return value.replace(/\s+/g, ' ').trim().slice(0, AI_SITE_INPUT_MAX_CHARS).trim()
  }
  return { about: read('businessType'), audience: read('audience') }
}

/**
 * What a scaffold builds for itself: the layout its pages render inside, the
 * form they place, and the palette suggestion a member applies in the Theme
 * section. Anything else a plan asks to create is a job of its own.
 */
export const AI_SITE_CREATE_KINDS: readonly AiBuildPlanCreateKind[] = [
  'layout',
  'form',
  'theme-change',
]

/** The creations a scaffold cannot build, in the order the plan lists them, each named once. */
export function aiSitePlanPrerequisites(
  plan: AiBuildPlan,
): Array<{ kind: AiBuildPlanCreateKind; name: string }> {
  const seen = new Set<string>()
  const prerequisites: Array<{ kind: AiBuildPlanCreateKind; name: string }> = []
  const add = (kind: AiBuildPlanCreateKind, name: string) => {
    const key = `${kind}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    prerequisites.push({ kind, name })
  }
  for (const entry of plan.create) {
    if (!AI_SITE_CREATE_KINDS.includes(entry.kind)) add(entry.kind, entry.name)
  }
  // A reference the create list does not carry is refused by the plan rules
  // before a plan is kept: rule 2 for a screen's layout, rule 7 for anything
  // else (`plan-creation-undeclared`, AGL-3040). A plan confirmed before that
  // rule existed can still carry one. It is named as a component: the
  // reference carries no kind, and the refusal must say where one is made.
  for (const { name } of aiPlanUndeclaredRefs(plan)) add('component', name)
  return prerequisites
}

/**
 * Why a scaffold cannot build a plan of this SHAPE — the page band, a page's
 * sections, its addresses, its navigation — in a sentence a member reads;
 * `null` when the shape is one it builds. The plan step holds a plan to it
 * with a re-ask (AGL-3030), and the doors hold a confirmed plan to it again
 * through `aiSitePlanRefusal`.
 */
export function aiSitePlanShapeRefusal(plan: AiBuildPlan): string | null {
  const { screens } = plan
  if (
    screens.length < AI_SITE_PAGES.min ||
    screens.length > AI_SITE_PAGES.max
  ) {
    return `This plan builds ${screens.length} ${screens.length === 1 ? 'page' : 'pages'}, and a site scaffold builds ${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max}. Describe the site again.`
  }
  const slugs = new Set<string>()
  for (const screen of screens) {
    if (!screen.sections.length) {
      return `The page “${screen.title}” has no sections to build. Describe the site again.`
    }
    if (screen.sections.length > AI_SITE_MAX_SECTIONS) {
      return `The page “${screen.title}” has ${screen.sections.length} sections, and a scaffolded page holds ${AI_SITE_MAX_SECTIONS}. Describe the site again.`
    }
    const slug = screen.slug.trim().toLowerCase()
    if (slugs.has(slug)) {
      return `Two pages in this plan share the address ${screen.slug}. Describe the site again.`
    }
    slugs.add(slug)
  }
  if (!screens.some((screen) => screen.nav)) {
    return 'No page in this plan is in the site navigation. Describe the site again.'
  }
  return null
}

/**
 * Why a scaffold cannot build this plan, in a sentence a member reads when
 * confirming it; `null` when it can.
 */
export function aiSitePlanRefusal(plan: AiBuildPlan): string | null {
  const shape = aiSitePlanShapeRefusal(plan)
  if (shape) return shape
  const prerequisites = aiSitePlanPrerequisites(plan)
  if (!prerequisites.length) return null
  const parts = prerequisites.map(
    ({ kind, name }) =>
      `the ${AI_BUILD_PLAN_CREATION_NOUNS[kind].noun} “${name}” ${AI_BUILD_PLAN_CREATION_NOUNS[kind].where}`,
  )
  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `This site needs what the workspace does not have yet. Create ${listed}, then describe the site again.`
}

/** What the estimate counts a plan in: whether a welcome email follows, and the creations the job builds. */
export interface AiPlanPassOptions {
  welcomeEmail?: boolean
  /** The creation kinds the job builds itself; a scaffold's when absent. */
  creates?: readonly AiBuildPlanCreateKind[]
}

/**
 * The passes a plan implies: one per section of every screen, one more per
 * screen for its search listing and its draft, and one for each thing the
 * plan creates that the job builds. What the estimate is counted in.
 */
export function aiPlanPasses(plan: AiBuildPlan, options: AiPlanPassOptions = {}): number {
  const screens = plan.screens.reduce(
    (total, screen) => total + screen.sections.length + 1,
    0,
  )
  const creates = options.creates ?? AI_SITE_CREATE_KINDS
  const creations = plan.create.filter((entry) => creates.includes(entry.kind)).length
  return screens + creations + (options.welcomeEmail ? 1 : 0)
}

/**
 * About what a plan costs to build, in credits. An ESTIMATE: the nominal
 * credits the machine holds per step, times the passes the plan implies.
 * What each pass actually costs is its model's tokens, recorded on the job
 * as it runs.
 */
export function aiPlanCreditEstimate(plan: AiBuildPlan, options: AiPlanPassOptions = {}): number {
  return aiPlanPasses(plan, options) * AI_SITE_PASS_CREDITS
}

/**
 * About what a job of this kind costs to build from its plan (AGL-3031): a
 * page job counts the layout, forms and components it builds before its
 * page, and every other kind counts what a scaffold would. The figure the
 * proposal shows beside Confirm, and the hold a confirmation takes.
 */
export function aiJobPlanCreditEstimate(kind: string, plan: AiBuildPlan): number {
  return aiPlanCreditEstimate(plan, kind === 'page' ? { creates: AI_PAGE_CREATE_KINDS } : {})
}

/**
 * About what a scaffold of this many pages costs, before a plan names its
 * sections: the same arithmetic on the nominal section count, plus the plan
 * step that proposes it. Shown where a member asks for a scaffold.
 */
export function aiSiteCreditEstimate(
  pages: number,
  options: { welcomeEmail?: boolean } = {},
): number {
  const screens = Math.max(0, Math.floor(pages))
  const passes =
    1 +
    screens * (AI_SITE_NOMINAL_SECTIONS + 1) +
    2 +
    (options.welcomeEmail ? 1 : 0)
  return passes * AI_SITE_PASS_CREDITS
}
