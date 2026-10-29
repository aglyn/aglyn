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

import { AI_SITE_INPUT_MAX_CHARS, AI_SITE_SUBMISSIONS, aiSitePagesBand } from './ai-site-job'
import {
  AI_SITE_START_STYLE_REQUIRED,
  aiSiteStartExtraProblem,
  aiSiteStartInspirationRefusal,
  type AiSiteStartAnswers,
  type AiSiteStartExtraKey,
} from './ai-site-start'

/**
 * The guided start's steps (AGL-3898): the same questions `ai-site-start.ts`
 * asks, one decision to a step, so a person answers one thing at a time and
 * the funnel can say which one they stopped at.
 *
 * Splitting the questions changes nothing they become. Every step writes the
 * same {@link AiSiteStartAnswers} the single form did, and only the review's
 * "Plan my site" turns them into the job's brief and inputs, through the same
 * `aiSiteStartBrief` / `aiSiteStartInputs`. Two answers are required: what
 * kind of site it is, and a style card clicked (AGL-4049; "Pick for me" is
 * one), since nothing is chosen for a person.
 *
 * Pure: ids, titles, which answers each step holds, and each step's reasons
 * not to go forward, worded as `aiSiteStartRefusal` words them.
 */

/** A step of the guided start, in order. `choose` is the starter-or-AI choice the questions follow. */
export const AI_SITE_START_STEPS = ['choose', 'kind', 'audience', 'style', 'details', 'review'] as const

export type AiSiteStartStep = (typeof AI_SITE_START_STEPS)[number]

/** Each step's short name, as the progress indicator shows it. */
export const AI_SITE_START_STEP_LABELS: Readonly<Record<AiSiteStartStep, string>> = {
  choose: 'Start',
  kind: 'Your site',
  audience: 'Audience',
  style: 'Style',
  details: 'Details',
  review: 'Review',
}

/** An answer a step asks for, by its key on {@link AiSiteStartAnswers}. */
export type AiSiteStartField =
  | 'siteType'
  | 'audience'
  | 'style'
  | 'kind'
  | 'inspiration'
  | 'pages'
  | 'submissions'
  | 'welcomeEmail'
  | AiSiteStartExtraKey

/**
 * The extras each step's "More details" offers (AGL-3979), in the order it
 * draws them. The phone number and the email are on the Details step itself,
 * above where messages go: they are the two a new site most needs.
 */
export const AI_SITE_START_MORE_FIELDS: Readonly<Record<AiSiteStartStep, readonly AiSiteStartExtraKey[]>> = {
  choose: [],
  kind: ['tagline', 'founded'],
  audience: ['serviceArea', 'priceRange', 'languages'],
  style: ['brand'],
  details: ['street', 'city', 'region', 'postalCode', 'country', 'hours', 'social'],
  review: [],
}

/** The answers each step holds, its "More details" last. */
export const AI_SITE_START_STEP_FIELDS: Readonly<Record<AiSiteStartStep, readonly AiSiteStartField[]>> = {
  choose: [],
  kind: ['siteType', ...AI_SITE_START_MORE_FIELDS.kind],
  audience: ['audience', ...AI_SITE_START_MORE_FIELDS.audience],
  // The sites they like sit under the style cards (AGL-3975), when asked.
  style: ['style', 'kind', 'inspiration', ...AI_SITE_START_MORE_FIELDS.style],
  details: ['phone', 'email', 'submissions', 'pages', 'welcomeEmail', ...AI_SITE_START_MORE_FIELDS.details],
  review: [],
}

/** Why an answer cannot go forward, as a closed code the funnel can count. */
export type AiSiteStartErrorCode = 'required' | 'too_long' | 'out_of_range' | 'invalid'

/** One answer's reason not to go forward: the sentence beside the field, and its code. */
export interface AiSiteStartFieldError {
  message: string
  code: AiSiteStartErrorCode
}

/** The step's place, from 0. */
export function aiSiteStartStepIndex(step: AiSiteStartStep): number {
  return AI_SITE_START_STEPS.indexOf(step)
}

/** The step after this one, or `null` after the review. */
export function aiSiteStartNextStep(step: AiSiteStartStep): AiSiteStartStep | null {
  return AI_SITE_START_STEPS[aiSiteStartStepIndex(step) + 1] ?? null
}

/** The step before this one, or `null` before the choice. */
export function aiSiteStartPreviousStep(step: AiSiteStartStep): AiSiteStartStep | null {
  const index = aiSiteStartStepIndex(step)
  return index > 0 ? (AI_SITE_START_STEPS[index - 1] ?? null) : null
}

/** Every answer's reason not to go forward, by field, with nothing for an answer that may. */
export function aiSiteStartFieldErrors(
  answers: AiSiteStartAnswers,
  options: { freeTaste?: boolean } = {},
): Partial<Record<AiSiteStartField, AiSiteStartFieldError>> {
  const errors: Partial<Record<AiSiteStartField, AiSiteStartFieldError>> = {}
  const siteType = answers.siteType.trim()
  if (!siteType) errors.siteType = { message: 'Say what kind of site this is.', code: 'required' }
  else if (siteType.length > AI_SITE_INPUT_MAX_CHARS) {
    errors.siteType = { message: `Keep what kind of site this is under ${AI_SITE_INPUT_MAX_CHARS} characters.`, code: 'too_long' }
  }
  if (answers.audience.trim().length > AI_SITE_INPUT_MAX_CHARS) {
    errors.audience = { message: `Keep who the site is for under ${AI_SITE_INPUT_MAX_CHARS} characters.`, code: 'too_long' }
  }
  // Nothing is chosen for a person (AGL-4049): a card, "Pick for me" included.
  if (answers.style === null) errors.style = { message: AI_SITE_START_STYLE_REQUIRED, code: 'required' }
  const band = aiSitePagesBand(options.freeTaste)
  if (!Number.isInteger(answers.pages) || answers.pages < band.min || answers.pages > band.max) {
    errors.pages = { message: `A site is planned with ${band.min} to ${band.max} pages.`, code: 'out_of_range' }
  }
  if (!(AI_SITE_SUBMISSIONS as readonly string[]).includes(answers.submissions)) {
    errors.submissions = { message: 'Say where the contact form’s submissions go.', code: 'invalid' }
  }
  const inspiration = aiSiteStartInspirationRefusal(answers, options)
  if (inspiration) errors.inspiration = { message: inspiration, code: 'invalid' }
  // Every extra is optional; one given is held to its own rule (AGL-3979).
  for (const field of Object.values(AI_SITE_START_STEP_FIELDS).flat()) {
    if (field in errors) continue
    const problem = isExtra(field) ? aiSiteStartExtraProblem(field, answers[field] ?? '') : null
    if (problem) errors[field] = problem
  }
  return errors
}

const CORE_FIELDS: ReadonlySet<AiSiteStartField> = new Set([
  'siteType',
  'audience',
  'style',
  'kind',
  'inspiration',
  'pages',
  'submissions',
  'welcomeEmail',
])

function isExtra(field: AiSiteStartField): field is AiSiteStartExtraKey {
  return !CORE_FIELDS.has(field)
}

/** One step's reasons not to go forward, in the order its fields are drawn; empty when it may. */
export function aiSiteStartStepErrors(
  step: AiSiteStartStep,
  answers: AiSiteStartAnswers,
  options: { freeTaste?: boolean } = {},
): Array<{ field: AiSiteStartField } & AiSiteStartFieldError> {
  const errors = aiSiteStartFieldErrors(answers, options)
  return AI_SITE_START_STEP_FIELDS[step].flatMap((field) => {
    const error = errors[field]
    return error ? [{ field, ...error }] : []
  })
}

/** The first step holding an answer that cannot go forward, for a review that was reached with one; `null` for none. */
export function aiSiteStartFirstInvalidStep(
  answers: AiSiteStartAnswers,
  options: { freeTaste?: boolean } = {},
): AiSiteStartStep | null {
  return AI_SITE_START_STEPS.find((step) => aiSiteStartStepErrors(step, answers, options).length > 0) ?? null
}
