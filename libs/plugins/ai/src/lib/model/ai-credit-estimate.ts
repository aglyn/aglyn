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
 * What one pass of a kind with no measurement of its own is likely to cost
 * (a component, an email design, a template, an item another runner
 * builds): a form's, the measured single-answer creation closest to them.
 * A declared stand-in, replaced the day those kinds are measured.
 */
export const AI_MEASURED_PASS_CREDITS: AiMeasuredCredits = AI_MEASURED_UNIT_CREDITS.form

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
