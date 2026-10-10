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

/**
 * WHAT A JOB REALLY COSTS, NEXT TO WHAT IT CAN COST (AGL-3722).
 *
 * Every job's cost used to be quoted at its CEILING: each pass at the
 * `AI_SITE_PASS_CREDITS` (50) a pass is reserved against. A Free Assist
 * build of two pages, a quote form and a layout was quoted 600 credits and
 * refused with 164 left, when builds like it measure about a fifth of that.
 *
 * So a job is now quoted as a RANGE: what it is likely to cost (the sum of
 * the measured medians of what it builds), what it costs nine times in ten
 * (the measured p90s), and its ceiling (the old figure, unchanged). The
 * meter still charges actual use, and the reservation each pass takes is
 * still the ceiling's 50 — only the words and the Free admission move:
 * a Free job is admitted outright when its p90 fits what is left, and asked
 * to be confirmed when it does not.
 *
 * This module is pure: the console, the doors and the specs read one table.
 */

/** One measured cost: the median and the 90th percentile, in credits. */
export interface AiMeasuredCredits {
  median: number
  p90: number
}

/**
 * MEASURED IN PRODUCTION, credits per unit, over every `done` AI job since
 * 2026-10-01 (read 2026-10-09; a whole Free site job came to 148–160):
 *
 *   page item   30 / 40   (a page of about `AI_MEASURED_PAGE_SECTIONS` sections, its listing included)
 *   form        29 / 31
 *   layout      23 / 24   (header and footer, one answer)
 *   theme        4 /  8   (a site start's look)
 *   plan step   21 / 70
 *
 * HOW TO RE-MEASURE: a read-only collection-group read of `aiJobs` in
 * production where `status == 'done'` and `createdAt` is in the window; group
 * each ledger row's (`items[]`) `creditsSpent` by its `op` (the site start's
 * look is the `theme` row), take the plan step's `steps[].creditsSpent` for
 * `plan`, and each job's `creditsSpent` for the whole-site band. Put each
 * group's median and 90th percentile here, and the dates in
 * `AI_MEASURED_AT`. `ai-credit-estimate.spec.ts` holds the table, the page
 * scaling and the measured whole-site band together, so a re-measure that
 * moves one moves the spec with it.
 */
export const AI_MEASURED_UNIT_CREDITS = {
  page: { median: 30, p90: 40 },
  form: { median: 29, p90: 31 },
  layout: { median: 23, p90: 24 },
  theme: { median: 4, p90: 8 },
  plan: { median: 21, p90: 70 },
} as const satisfies Record<string, AiMeasuredCredits>

/** When the table above was read, and from when its jobs ran. */
export const AI_MEASURED_AT = { read: '2026-10-09', since: '2026-10-01' } as const

/** What a whole Free two-page site job measured at, in credits, in the same window. */
export const AI_MEASURED_FREE_SITE_CREDITS = { low: 148, high: 160 } as const

/** The sections the measured page item is about: a page is scaled around it. */
export const AI_MEASURED_PAGE_SECTIONS = 5

/**
 * What a page of this many sections is likely to cost: the measured page
 * scaled by its sections around the ~5-section median — about 6 credits a
 * section, 8 at the p90.
 */
export function aiMeasuredPageCredits(sections: number): AiMeasuredCredits {
  const count = Math.max(1, Math.floor(Number.isFinite(sections) ? sections : AI_MEASURED_PAGE_SECTIONS))
  const { median, p90 } = AI_MEASURED_UNIT_CREDITS.page
  return {
    median: Math.ceil((median * count) / AI_MEASURED_PAGE_SECTIONS),
    p90: Math.ceil((p90 * count) / AI_MEASURED_PAGE_SECTIONS),
  }
}

/**
 * What a page costs when it is written ON ITS OWN — a page an Assist build or
 * a page job writes, rather than one of a site start's pages (AGL-3722).
 *
 * The table's page item is a site start's: its pages are written one after
 * another inside one job, the later ones reading the prompt the first one
 * paid to write, so a 2-section second page measured 19–28. A page written on
 * its own pays that prompt itself and reads the site it lands on, and costs
 * what a site start's FIRST page costs: a 5-section home page measured 39–78
 * (median 40, p90 78), standalone page jobs' writing step 82–105 for a
 * 2-section page, and the Assist build pages of 2026-10-09 22–89 each. Quoting
 * a build's pages at the site start's scaled median told a Free workspace
 * "about 48 credits" for two 4-section pages (AGL-3722, 2026-10-10).
 *
 * So it is priced as a fixed cost — the prompt, the site, the listing — and a
 * cost per section: a 4-section page about 40 (p90 78), a 5-section 46 (p90 90).
 */
export const AI_MEASURED_STANDALONE_PAGE = {
  fixed: { median: 16, p90: 30 },
  perSection: { median: 6, p90: 12 },
} as const satisfies Record<string, AiMeasuredCredits>

/** What a page of this many sections written on its own is likely to cost. */
export function aiMeasuredStandalonePageCredits(sections: number): AiMeasuredCredits {
  const count = Math.max(1, Math.floor(Number.isFinite(sections) ? sections : AI_MEASURED_PAGE_SECTIONS))
  const { fixed, perSection } = AI_MEASURED_STANDALONE_PAGE
  return {
    median: fixed.median + perSection.median * count,
    p90: fixed.p90 + perSection.p90 * count,
  }
}

/**
 * What a creation costs when it is written ON ITS OWN (AGL-3722), where it
 * measured apart from a site start's: an Assist build's layout came to 24–28
 * (2026-10-09/10), against a site start's 23/24 written in its warm prompt.
 * A form measured the same either way (25–30 on its own, 29/31 in a site
 * start), so it keeps the table's figure.
 */
export const AI_MEASURED_STANDALONE_CREATION_CREDITS = {
  layout: { median: 26, p90: 30 },
} as const satisfies Record<string, AiMeasuredCredits>

/**
 * What one pass of a kind with no measurement of its own is likely to cost
 * (a component, an email design, a template, an item another runner
 * builds), written on its own: a component job's writing step measured
 * 52–65, a form job's 37, a layout job's 63, and the Assist build of
 * 2026-10-09 a welcome email at 46 and a products step at 60. Until
 * 2026-10-10 this was a site start's form (29/31), which is written inside a
 * site job's warm prompt and is the cheapest single answer there is.
 */
export const AI_MEASURED_PASS_CREDITS: AiMeasuredCredits = { median: 50, p90: 65 }

/** A job's cost as it is quoted: likely, nine times in ten, and at its worst. */
export interface AiCreditRange {
  /** The sum of the measured medians: what the job is likely to spend. */
  likely: number
  /** The sum of the measured p90s: what a Free job is admitted on. */
  p90: number
  /** Every pass at its reserve: what it can spend at most. */
  ceiling: number
}

export const AI_CREDIT_RANGE_ZERO: AiCreditRange = { likely: 0, p90: 0, ceiling: 0 }

/** Two ranges added. */
export function aiCreditRangeAdd(a: AiCreditRange, b: AiCreditRange): AiCreditRange {
  return { likely: a.likely + b.likely, p90: a.p90 + b.p90, ceiling: a.ceiling + b.ceiling }
}

/** A measured cost as a range with its own ceiling, the likely and p90 never above it. */
export function aiCreditRangeOf(measured: AiMeasuredCredits, ceiling: number): AiCreditRange {
  const top = Math.max(0, Math.ceil(ceiling))
  return { likely: Math.min(measured.median, top), p90: Math.min(measured.p90, top), ceiling: top }
}

/** A range whose likely and p90 are each at least the last, and at most the ceiling. */
export function aiCreditRangeOrdered(range: AiCreditRange): AiCreditRange {
  const ceiling = Math.max(0, Math.ceil(range.ceiling))
  const likely = Math.min(Math.max(0, Math.ceil(range.likely)), ceiling)
  const p90 = Math.min(Math.max(likely, Math.ceil(range.p90)), ceiling)
  return { likely, p90, ceiling }
}

const n = (value: number) => value.toLocaleString('en-US')

/**
 * The range as every surface quotes it: "About 106 credits (up to 650)".
 * A job whose likely figure is its ceiling says one number.
 */
export function aiCreditRangeText(range: AiCreditRange): string {
  if (range.likely >= range.ceiling) return `About ${n(range.ceiling)} credits`
  return `About ${n(range.likely)} credits (up to ${n(range.ceiling)})`
}

/**
 * Whether a Free job of this range needs the person's go-ahead before it
 * starts (AGL-3722): its p90 is more than what is left. A job whose p90
 * fits starts with no prompt; one that does not starts only when confirmed,
 * builds as much as what is left pays for, and pauses with Resume.
 */
export function aiCreditsNeedConfirm(range: Pick<AiCreditRange, 'p90'>, left: number): boolean {
  return Number.isFinite(left) && range.p90 > Math.max(0, Math.floor(left))
}

/** The smaller first build a Free job that does not fit is offered (AGL-3722). */
export interface AiCreditsSmaller {
  /** "Build the home page first". */
  label: string
  likely: number
  p90: number
  ceiling: number
}

/**
 * What a Free job that does not fit what is left says before it starts, and
 * the choices it offers: build what fits, a smaller first build, or Upgrade.
 * The door that refuses an unconfirmed start answers with it (status 409,
 * `code: AI_CREDITS_CONFIRM_CODE`), and the plan card and the guided start
 * draw it from the same figures.
 */
export interface AiCreditsPrompt extends AiCreditRange {
  left: number
  resetsOn: string
  smaller: AiCreditsSmaller | null
}

/** The `code` a door answers an unconfirmed Free start with. */
export const AI_CREDITS_CONFIRM_CODE = 'credits-confirm'

/** "Build what fits": the go-ahead for a Free job past what is left. */
export const AI_CREDITS_BUILD_WHAT_FITS = 'Build what fits'

/** The smaller first build's button: "Build the home page first (about 64 credits)". */
export function aiCreditsSmallerText(smaller: Pick<AiCreditsSmaller, 'label' | 'likely'>): string {
  return `${smaller.label} (about ${n(smaller.likely)} credits)`
}

/** Which way on a prompt offers, in the order it offers them. */
export type AiCreditsChoiceKey = 'fits' | 'smaller' | 'upgrade'

/** One way on, as its option button reads it: a short label and the figure under it (AGL-3722). */
export interface AiCreditsChoice {
  key: AiCreditsChoiceKey
  label: string
  detail: string
  /** The one choice drawn as the primary button. */
  recommended: boolean
}

const credit = (count: number) => `${n(count)} ${count === 1 ? 'credit' : 'credits'}`

/**
 * The prompt's ways on, as its three option buttons read them (Zach,
 * 2026-10-10: "more appealing and consistent"): build what fits, the smaller
 * first build when there is one, and Upgrade when it can be offered — each a
 * short sentence-case label with its figure under it. The smaller build is
 * the recommended one when its p90 fits what is left, since it then finishes;
 * otherwise building what fits is.
 */
export function aiCreditsChoices(
  prompt: Pick<AiCreditsPrompt, 'left' | 'smaller'>,
  offers: { smaller: boolean; upgrade: boolean },
): AiCreditsChoice[] {
  const left = Math.max(0, Math.floor(prompt.left))
  const smaller = offers.smaller ? prompt.smaller : null
  const smallerFits = smaller !== null && smaller.p90 <= left
  const choices: AiCreditsChoice[] = [
    {
      key: 'fits',
      label: AI_CREDITS_BUILD_WHAT_FITS,
      detail: `Uses your ${credit(left)} left, then pauses`,
      recommended: !smallerFits,
    },
  ]
  if (smaller) {
    choices.push({
      key: 'smaller',
      label: smaller.label,
      detail: smallerFits ? `About ${credit(smaller.likely)}, fits what you have left` : `About ${credit(smaller.likely)}`,
      recommended: smallerFits,
    })
  }
  if (offers.upgrade) choices.push({ key: 'upgrade', label: 'Upgrade', detail: 'Get more credits', recommended: false })
  return choices
}

/** A reset day as a person reads it: "November 1". */
function resetLabel(resetsOn: string): string {
  const at = new Date(`${resetsOn}T00:00:00.000Z`)
  return Number.isFinite(at.getTime())
    ? at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    : 'the first of next month'
}

/**
 * The plain sentence (Zach, 2026-10-09): "This build is about N credits (up
 * to M). You have L left, so it will build as much as it can and pause when
 * your credits run out. You can upgrade or resume when they renew."
 */
export function aiCreditsPromptText(prompt: AiCreditsPrompt, noun: 'build' | 'site' = 'build'): string {
  const size =
    prompt.likely >= prompt.ceiling
      ? `about ${n(prompt.ceiling)} credits`
      : `about ${n(prompt.likely)} credits (up to ${n(prompt.ceiling)})`
  const left = Math.max(0, Math.floor(prompt.left))
  return (
    `This ${noun} is ${size}. You have ${n(left)} left, so it will build as much as it can and pause ` +
    `when your credits run out. You can upgrade or resume when they renew on ${resetLabel(prompt.resetsOn)}.`
  )
}

/**
 * The record a confirmed Free start keeps (AGL-3722): who said go, when,
 * what was left then and the range they were shown.
 */
export interface AiJobCreditsConfirmation extends AiCreditRange {
  by: string
  at: Date | string
  left: number
}

/** The confirmation a door keeps on the job for the prompt the person confirmed, or `null` when there was none. */
export function aiCreditsConfirmation(
  prompt: AiCreditsPrompt | null,
  by: string,
  at: Date,
): AiJobCreditsConfirmation | null {
  if (!prompt) return null
  return { by, at, left: prompt.left, likely: prompt.likely, p90: prompt.p90, ceiling: prompt.ceiling }
}

/** The prompt a range needs against what is left, or `null` when it fits. */
export function aiCreditsPromptFor(
  range: AiCreditRange,
  credits: { left: number; resetsOn: string } | null | undefined,
  smaller: AiCreditsSmaller | null = null,
): AiCreditsPrompt | null {
  if (!credits || !aiCreditsNeedConfirm(range, credits.left)) return null
  return { ...range, left: Math.max(0, Math.floor(credits.left)), resetsOn: credits.resetsOn, smaller }
}
