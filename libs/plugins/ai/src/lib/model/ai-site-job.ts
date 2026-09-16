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
  aiPlanCreateFor,
  isAiPlanNewRef,
  type AiBuildPlan,
  type AiBuildPlanCreateKind,
} from './ai-build-plan'

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
  /** How many pages the member asked for. */
  pages: number
  /** The per-site variables an agency batch varies; empty when none was given. */
  businessName: string
  city: string
  brand: string
  /** Whether the scaffold also drafts a welcome email. */
  welcomeEmail: boolean
  /** The batch this job was created under (AGL-2911); `null` for a single site. */
  batchId: string | null
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
  for (const [key, value] of [
    ['businessName', businessName],
    ['city', city],
    ['brand', brand],
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
    pages,
    businessName: businessName as string,
    city: city as string,
    brand: brand as string,
    welcomeEmail: inputs?.['welcomeEmail'] !== false,
    batchId,
  }
}

/** What each creation is called in a sentence, and where a member makes one. */
const CREATION_NOUNS: Record<
  AiBuildPlanCreateKind,
  { noun: string; where: string }
> = {
  component: { noun: 'component', where: 'on the Components page' },
  form: { noun: 'form', where: 'on the Forms page' },
  layout: { noun: 'layout', where: 'on the Layouts page' },
  template: { noun: 'template', where: 'in the Templates library' },
  'theme-change': { noun: 'theme change', where: 'in the Theme section' },
  dataset: { noun: 'dataset', where: 'on the Datasets page' },
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
  // before a plan is kept; one that slipped through still names a creation.
  for (const screen of plan.screens) {
    const refs = [
      screen.layout,
      screen.template,
      ...screen.sections.flatMap((section) => section.uses),
    ]
    for (const ref of refs) {
      if (!isAiPlanNewRef(ref)) continue
      if (!aiPlanCreateFor(plan, ref))
        add('component', ref.slice(ref.indexOf(':') + 1).trim())
    }
  }
  return prerequisites
}

/**
 * Why a scaffold cannot build this plan, in a sentence a member reads when
 * confirming it; `null` when it can.
 */
export function aiSitePlanRefusal(plan: AiBuildPlan): string | null {
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
  const prerequisites = aiSitePlanPrerequisites(plan)
  if (!prerequisites.length) return null
  const parts = prerequisites.map(
    ({ kind, name }) =>
      `the ${CREATION_NOUNS[kind].noun} “${name}” ${CREATION_NOUNS[kind].where}`,
  )
  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `This site needs what the workspace does not have yet. Create ${listed}, then describe the site again.`
}

/**
 * The passes a plan implies: one per section of every screen, one more per
 * screen for its search listing and its draft, and one for each thing the
 * plan creates. What the estimate is counted in.
 */
export function aiPlanPasses(
  plan: AiBuildPlan,
  options: { welcomeEmail?: boolean } = {},
): number {
  const screens = plan.screens.reduce(
    (total, screen) => total + screen.sections.length + 1,
    0,
  )
  const creations = plan.create.filter((entry) =>
    AI_SITE_CREATE_KINDS.includes(entry.kind),
  ).length
  return screens + creations + (options.welcomeEmail ? 1 : 0)
}

/**
 * About what a plan costs to build, in credits. An ESTIMATE: the nominal
 * credits the machine holds per step, times the passes the plan implies.
 * What each pass actually costs is its model's tokens, recorded on the job
 * as it runs.
 */
export function aiPlanCreditEstimate(
  plan: AiBuildPlan,
  options: { welcomeEmail?: boolean } = {},
): number {
  return aiPlanPasses(plan, options) * AI_SITE_PASS_CREDITS
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
