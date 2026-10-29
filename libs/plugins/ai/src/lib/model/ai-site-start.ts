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

import type { ClientBuildIntake } from '@aglyn/aglyn/app-utils/client-build'
import { SITE_STYLE_AUTO } from '@aglyn/aglyn/app-utils/site-styles'
import { weeklyHoursFromText, weeklyHoursToText } from '@aglyn/shared-ui-jsx/utils/weekly-hours'
import {
  AI_SITE_DETAIL_KEYS,
  AI_SITE_NO_DETAILS,
  aiSiteDetailProblem,
  aiSiteDetailsOf,
  type AiSiteDetailKey,
  type AiSiteDetails,
} from './ai-site-details'
import { aiSiteKind, aiSiteKindFor, type AiSiteKind } from './ai-site-kinds'
import {
  AI_SITE_INSPIRATION_INPUT,
  aiSiteInspirationInput,
  aiSiteInspirationLimit,
  aiSiteInspirationRefusal,
  aiSiteInspirationUrl,
} from './ai-site-inspiration'
import {
  AI_SITE_INPUT_MAX_CHARS,
  AI_SITE_SUBMISSIONS,
  aiSitePagesBand,
  type AiSiteJobInputs,
  type AiSiteSubmissions,
} from './ai-site-job'

/**
 * The guided start (AGL-2918): the questions a person answers on a site they
 * have just made, and the site job those answers become.
 *
 * A scaffold already exists — the `site` job plans four to eight pages, a
 * layout, a contact form, a palette and a welcome email, and builds every one
 * of them as a draft. What it had no way in through was a brief: somebody had
 * to know what to write, on a site where nothing has happened yet. So this
 * module is the QUESTIONS, and nothing else: what is asked, what an answer may
 * be, and how a set of answers becomes the brief and the scalar inputs the
 * `site` door already takes.
 *
 * ── Answering is never the way out ───────────────────────────────────────
 *
 * There is no answer here that means "not this". The way past the questions
 * is the `hostFirstRun` zone's own `startBlank`, which is drawn beside them
 * from the first one and creates nothing at all — see the zone in
 * `CONSOLE_WIDGET_SLOTS`. Putting the exit inside the question set would make
 * leaving a thing you answer your way to, and it is not.
 *
 * ── Every answer but the first is optional ───────────────────────────────
 *
 * Only what a site is FOR has no default worth guessing. The audience narrows
 * the copy, the example steers the shape, the page count and the welcome
 * email are defaults a person may change — so a person who types six words
 * and confirms gets a planned site, and the rest of the questions are there
 * for the person who wants to answer them.
 *
 * Pure: shapes, vocabularies and two string builders. No React, no network,
 * and no import of the starter catalog — {@link AI_SITE_START_EXAMPLES} names
 * the starters rather than reading them, so the console does not carry a
 * catalog of node maps to draw five cards. `ai-site-start.spec.ts` holds the
 * two lists to each other.
 */

/** A worked example a person picks to steer what the site should look like. */
export interface AiSiteStartExample {
  /** A `STARTER_TEMPLATES` id, which is a persisted identifier. */
  id: string
  /** The starter as its card names it. */
  label: string
  /** The starter's category, which is how the examples group. */
  category: string
  /** What the example is, in one line a person reads before picking it. */
  blurb: string
}

/**
 * The examples the start offers, in the order they are shown. The platform's
 * own starter sites: a person who has no words for what they want has seen
 * these five shapes before, and picking one says more than a sentence would.
 */
export const AI_SITE_START_EXAMPLES: readonly AiSiteStartExample[] = [
  {
    id: 'business',
    label: 'Business',
    category: 'Business',
    blurb: 'A home page led by what you do, an about page and a contact page',
  },
  {
    id: 'landing',
    label: 'Landing Page',
    category: 'Marketing',
    blurb: 'One page that leads to one action, with the reasons to take it',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    category: 'Personal',
    blurb: 'An introduction, a grid of work and a way to get in touch',
  },
  {
    id: 'physical-shop',
    label: 'Shop (physical products)',
    category: 'Commerce',
    blurb: 'Featured products, a shop to browse, and a cart',
  },
  {
    id: 'digital-shop',
    label: 'Shop (digital products)',
    category: 'Commerce',
    blurb: 'Downloads up front, a shop to browse, and a cart',
  },
]

/**
 * Kinds of site offered beside the first question's box, so answering it can
 * be a tap. They fill the box rather than replacing it: what somebody is
 * building is theirs to say, and a list of eight is a list somebody is not on.
 */
export const AI_SITE_START_TYPES: readonly string[] = [
  'a local service business',
  'a restaurant or cafe',
  'a professional practice',
  'a trades business',
  'a shop',
  'a nonprofit',
  'a personal portfolio',
  'an event',
]

/**
 * What a person answered; the shape the card holds and the brief is built from.
 *
 * Beside the answers each step asks, the business details its "More details"
 * offers (AGL-3979, `AiSiteDetails`): every one optional and `''` until given,
 * the phone number and email on the Details step itself.
 */
export interface AiSiteStartAnswers extends AiSiteDetails {
  /** What kind of site this is. The one answer with no default. */
  siteType: string
  /** Who the site is for; empty when they did not say. */
  audience: string
  /** The example they liked, by {@link AiSiteStartExample.id}; `null` for none. */
  example: string | null
  /**
   * The style card they clicked (AGL-4049): a kind's id, or
   * `SITE_STYLE_AUTO` for "Pick for me"; `null` while they have clicked none.
   * Nothing is chosen for a person, so the Style step does not go forward on
   * `null` ({@link aiSiteStartStyleAnswer} sets this and {@link kind} together).
   */
  style: string | null
  /**
   * The kind of site they picked (AGL-3660), by its `AI_SITE_KINDS` id;
   * `null` for "Pick for me", or before a style is chosen, when the kind
   * their first answer suggests is the one used ({@link aiSiteStartKind}).
   */
  kind: string | null
  /** How many pages to plan. */
  pages: number
  /** Where the contact form's submissions go. */
  submissions: AiSiteSubmissions
  /** Whether the scaffold also drafts a welcome email. */
  welcomeEmail: boolean
  /** The city or town the business is in (AGL-3979); empty when they did not say. */
  city: string
  /** The brand color, as a six-digit hex (AGL-3979); empty for the style's own. */
  brand: string
  /**
   * The sites they like (AGL-3975), as typed, one a field; absent or empty
   * for none. Asked only while `release_ai_site_inspiration` is on.
   */
  inspiration?: string[]
}

/**
 * What the questions start on. Five pages because it is the middle of the
 * band the scaffold builds, a welcome email because the scaffold drafts one
 * unless it is told not to, and the Inbox because it is what every submission
 * does anyway — filing a lead as well is the addition, and an addition is the
 * thing a person should have to choose.
 */
export const AI_SITE_START_ANSWERS: AiSiteStartAnswers = {
  siteType: '',
  audience: '',
  example: null,
  style: null,
  kind: null,
  pages: 5,
  submissions: 'inbox',
  welcomeEmail: true,
  city: '',
  brand: '',
  ...AI_SITE_NO_DETAILS,
}

/**
 * Why the Style step does not go forward before a card is clicked (AGL-4049),
 * and why the review does not plan: nothing is chosen for a person, and
 * "Pick for me" is a card too. The door itself admits a start without one
 * ({@link aiSiteStartRefusal} is what it would refuse), so this is the
 * questions' rule, held by `aiSiteStartStepErrors` and the card.
 */
export const AI_SITE_START_STYLE_REQUIRED = 'Choose a style, or Pick for me.'

/** The answers a person may give beyond the ones each step asks, by key (AGL-3979). */
export type AiSiteStartExtraKey = AiSiteDetailKey | 'city' | 'brand'

/** Every extra, in the order the review lists them. */
export const AI_SITE_START_EXTRA_KEYS: readonly AiSiteStartExtraKey[] = [
  'phone',
  'email',
  'tagline',
  'founded',
  'serviceArea',
  'priceRange',
  'languages',
  'brand',
  'street',
  'city',
  'region',
  'postalCode',
  'country',
  'hours',
  'social',
]

/** What is wrong with one extra, worded for beside its field; `null` when it may be used. */
export function aiSiteStartExtraProblem(
  key: AiSiteStartExtraKey,
  value: string,
): { code: 'too_long' | 'invalid'; message: string } | null {
  if (key === 'city' || key === 'brand') {
    return value.trim().length > AI_SITE_INPUT_MAX_CHARS
      ? { code: 'too_long', message: `Keep this under ${AI_SITE_INPUT_MAX_CHARS} characters.` }
      : null
  }
  return aiSiteDetailProblem(key, value)
}

/** The extras a person gave, in the review's order: what "More details" was used for. */
export function aiSiteStartExtrasGiven(answers: AiSiteStartAnswers): AiSiteStartExtraKey[] {
  return AI_SITE_START_EXTRA_KEYS.filter((key) => (answers[key] ?? '').trim() !== '')
}

/**
 * A style card clicked (AGL-4049), as the answers hold it: the card's id as
 * the style, and the kind it names — none for "Pick for me", which leaves the
 * kind to what the site is and who it is for.
 */
export function aiSiteStartStyleAnswer(id: string): Pick<AiSiteStartAnswers, 'style' | 'kind'> {
  return { style: id, kind: id === SITE_STYLE_AUTO ? null : (aiSiteKind(id)?.id ?? null) }
}

/** The kind of site the answers pick, else the one what the site is and who it is for suggest. */
export function aiSiteStartKind(
  answers: Pick<AiSiteStartAnswers, 'kind' | 'siteType'> & Partial<Pick<AiSiteStartAnswers, 'audience'>>,
): AiSiteKind {
  return aiSiteKind(answers.kind) ?? aiSiteKindFor(answers.siteType, answers.audience ?? '')
}

/** The example an answer names, or `null` when it names none this list knows. */
export function aiSiteStartExample(
  answers: AiSiteStartAnswers,
): AiSiteStartExample | null {
  if (!answers.example) return null
  return AI_SITE_START_EXAMPLES.find((entry) => entry.id === answers.example) ?? null
}

/**
 * Why these answers cannot start a site, in a sentence a person reads; `null`
 * when they can. The door's own parser is what actually admits the job — this
 * is what the card says before it asks for one.
 */
export function aiSiteStartRefusal(
  answers: AiSiteStartAnswers,
  options: { freeTaste?: boolean } = {},
): string | null {
  // The workspace's own band (AGL-3594): one or two pages on the Free taste.
  const band = aiSitePagesBand(options.freeTaste)
  const siteType = answers.siteType.trim()
  if (!siteType) return 'Say what kind of site this is.'
  if (siteType.length > AI_SITE_INPUT_MAX_CHARS) {
    return `Keep what kind of site this is under ${AI_SITE_INPUT_MAX_CHARS} characters.`
  }
  if (answers.audience.trim().length > AI_SITE_INPUT_MAX_CHARS) {
    return `Keep who the site is for under ${AI_SITE_INPUT_MAX_CHARS} characters.`
  }
  if (!Number.isInteger(answers.pages) || answers.pages < band.min || answers.pages > band.max) {
    return `A site is planned with ${band.min} to ${band.max} pages.`
  }
  if (answers.example !== null && !aiSiteStartExample(answers)) {
    return 'Pick one of the examples, or none of them.'
  }
  if (!(AI_SITE_SUBMISSIONS as readonly string[]).includes(answers.submissions)) {
    return 'Say where the contact form’s submissions go.'
  }
  for (const key of AI_SITE_START_EXTRA_KEYS) {
    const problem = aiSiteStartExtraProblem(key, answers[key] ?? '')
    if (problem) return problem.message
  }
  return aiSiteStartInspirationRefusal(answers, options)
}

/** The sites they typed, without the empty fields. */
export function aiSiteStartInspirationTyped(answers: Pick<AiSiteStartAnswers, 'inspiration'>): string[] {
  return (answers.inspiration ?? []).map((entry) => entry.trim()).filter(Boolean)
}

/** Why the sites they like cannot go forward, as the door would refuse them; `null` when they can. */
export function aiSiteStartInspirationRefusal(
  answers: Pick<AiSiteStartAnswers, 'inspiration'>,
  options: { freeTaste?: boolean } = {},
): string | null {
  const typed = aiSiteStartInspirationTyped(answers)
  if (typed.some((entry) => !aiSiteInspirationUrl(entry))) {
    return 'Give each site you like as its https address, like https://example.com.'
  }
  return aiSiteInspirationRefusal(typed, options.freeTaste)
}

/**
 * The answers as the brief the `site` job is created with: the plan step reads
 * it as the person's own words, so it says what they said and asks for nothing
 * they did not.
 */
export function aiSiteStartBrief(answers: AiSiteStartAnswers): string {
  const siteType = answers.siteType.trim()
  const audience = answers.audience.trim()
  const example = aiSiteStartExample(answers)
  const sentences = [
    `A ${answers.pages}-page website for ${siteType}.`,
  ]
  if (audience) sentences.push(`It is for ${audience}.`)
  if (example) {
    sentences.push(
      `Follow the shape of the ${example.label} starter: ${example.blurb.toLowerCase()}.`,
    )
  }
  // The kind they picked, or the one their answer suggests (AGL-3660).
  sentences.push(`Make it a ${aiSiteStartKind(answers).label.toLowerCase()} site.`)
  // The form on the page a visitor opens to get in touch, never every page's
  // last band (AGL-3899): "on the page that asks to be contacted" read as
  // the home's closing band on 16 of the 22 newest production starts.
  sentences.push(
    answers.pages === 1
      ? 'Plan the page around what a visitor comes to do, with a contact form on it.'
      : 'Plan a page for each thing a visitor comes to do, with the contact form on the page a visitor opens to get in touch.',
  )
  if (audience) {
    // Said of the FORM as well as of the copy: who fills a form in is what
    // decides which fields it asks for, and a brief that named the audience
    // once, in a sentence about the pages, left the form to guess.
    sentences.push(`Ask the contact form for what ${audience} would be asked for.`)
  }
  return sentences.join(' ')
}

/**
 * The answers as the `site` job's scalar inputs. Read by the door's
 * {@link parseAiSiteJobInputs}, and put in front of the model one per line by
 * the plan step, which is how the audience and the example reach the plan
 * without a prompt of their own.
 *
 * The per-site variables an agency batch fills — the business name, the city,
 * the brand — are left empty here: the questions never ask them. The name is
 * the site's own, and the create door fills it from the site
 * (`aiJobAdmittedInputs`, AGL-3596) when the job is started — a job that
 * reached the model with no name had the model invent one for its header and
 * footer.
 */
export function aiSiteStartInputs(
  answers: AiSiteStartAnswers,
): Omit<AiSiteJobInputs, 'batchId' | 'inspiration' | AiSiteDetailKey> & Partial<AiSiteDetails> & { inspiration?: string } {
  const example = aiSiteStartExample(answers)
  const kind = aiSiteStartKind(answers)
  // The details are sent only where given (AGL-3979): the plan step lists
  // every scalar input on a line of its own, and a start without them is
  // asked exactly what it was asked before.
  const details: Partial<AiSiteDetails> = {}
  for (const key of AI_SITE_DETAIL_KEYS) {
    const value = (answers[key] ?? '').trim()
    if (value) details[key] = value
  }
  // The sites they like travel only when there are some (AGL-3975), so a
  // start without them asks for exactly what it always did.
  const inspiration = aiSiteInspirationInput(aiSiteStartInspirationTyped(answers))
  return {
    businessType: answers.siteType.trim(),
    audience: answers.audience.trim(),
    starter: example?.id ?? kind.starter,
    siteKind: kind.id,
    pages: answers.pages,
    businessName: '',
    city: (answers.city ?? '').trim(),
    brand: (answers.brand ?? '').trim(),
    submissions: answers.submissions,
    welcomeEmail: answers.welcomeEmail,
    ...details,
    ...(inspiration ? { [AI_SITE_INSPIRATION_INPUT]: inspiration } : {}),
  }
}

/** The site inputs a guided start's answers become, by name: what a summary carries back (AGL-3596). */
export const AI_SITE_START_INPUT_KEYS = [
  'businessType',
  'audience',
  'starter',
  'siteKind',
  'pages',
  'businessName',
  'city',
  'brand',
  'submissions',
  'welcomeEmail',
  ...AI_SITE_DETAIL_KEYS,
  AI_SITE_INSPIRATION_INPUT,
] as const

/** A site job's scalar inputs, and nothing else its inputs carry; `null` when it has none. */
export function aiSiteStartInputsOf(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, unknown> | null {
  if (!inputs) return null
  const kept: Record<string, unknown> = {}
  for (const key of AI_SITE_START_INPUT_KEYS) {
    const value = inputs[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') kept[key] = value
  }
  return Object.keys(kept).length ? kept : null
}

/**
 * A failed start's answers, back as the questions hold them (AGL-3596), so
 * Try again reopens the guided start filled in for the person to adjust:
 * the inverse of {@link aiSiteStartInputs}. Read defensively — an answer the
 * questions no longer offer goes back to its default — and held to the
 * workspace's page band. `null` when the inputs say no kind of site at all.
 */
export function aiSiteStartAnswersFromInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
  options: { freeTaste?: boolean } = {},
): AiSiteStartAnswers | null {
  const text = (key: string) => (typeof inputs?.[key] === 'string' ? (inputs[key] as string).trim() : '')
  const siteType = text('businessType')
  if (!siteType) return null
  const band = aiSitePagesBand(options.freeTaste)
  const pages = typeof inputs?.['pages'] === 'number' ? Math.round(inputs['pages'] as number) : AI_SITE_START_ANSWERS.pages
  const starter = text('starter')
  const submissions = text('submissions')
  return {
    siteType,
    audience: text('audience'),
    example: AI_SITE_START_EXAMPLES.some((entry) => entry.id === starter) ? starter : null,
    // A start that ran had its style chosen: its kind, or "Pick for me".
    ...aiSiteStartStyleAnswer(aiSiteKind(text('siteKind'))?.id ?? SITE_STYLE_AUTO),
    pages: Math.min(band.max, Math.max(band.min, pages)),
    submissions: (AI_SITE_SUBMISSIONS as readonly string[]).includes(submissions)
      ? (submissions as AiSiteSubmissions)
      : AI_SITE_START_ANSWERS.submissions,
    welcomeEmail: options.freeTaste ? false : inputs?.['welcomeEmail'] !== false,
    city: text('city'),
    brand: text('brand'),
    ...(Object.fromEntries(AI_SITE_DETAIL_KEYS.map((key) => [key, text(key)])) as unknown as AiSiteDetails),
    // The sites they liked come back as typed, within the workspace's limit (AGL-3975).
    ...(text(AI_SITE_INSPIRATION_INPUT)
      ? { inspiration: text(AI_SITE_INSPIRATION_INPUT).split(/\s+/).filter(Boolean).slice(0, aiSiteInspirationLimit(options.freeTaste)) }
      : {}),
  }
}

// ── An AI starter's answers (AGL-4049) ──────────────────────────────────────

/** A brand color as the questions hold one: six hex digits. */
const STARTER_BRAND_HEX = /^#[0-9a-f]{6}$/i

const isAnswersRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * The questions' answers an AI starter fills in (AGL-4049), from the answers
 * its listing carries: what "Choose your starter" hands the start when a
 * person picks one. Every answer stays the person's to change.
 *
 * Read from the keys a starter writes (`first-party-starters.mjs`, and a
 * publisher's AI starter in the same shape):
 *
 *  - `kind` → the style chosen, and the kind it names. The person chose it by
 *    picking the starter, so it arrives chosen; a kind this deployment does
 *    not know chooses nothing, and the Style step asks as ever.
 *  - `brandColors.primary` → the brand color, when it is a color.
 *  - `pages`, when it is a whole number → how many pages to plan, held to the
 *    workspace's band. A description of the pages is the kind's own guidance,
 *    which the kind already carries to the plan.
 *  - `brief` → what the site is for, as typed on the first question.
 *
 * Anything else a starter carries is left out — `style`'s finer tokens and
 * `fonts` included: the questions ask neither, and the kind's look and the
 * brand color are what carry a starter's look into the job. Every other
 * answer starts where the questions start, so a starter never answers for
 * the person what it does not say. Anything that is not a set of answers
 * reads as none.
 */
export function aiSiteStartAnswersFromStarter(
  answers: Readonly<Record<string, unknown>> | null | undefined,
  options: { freeTaste?: boolean } = {},
): AiSiteStartAnswers {
  if (!isAnswersRecord(answers)) return { ...AI_SITE_START_ANSWERS }
  const band = aiSitePagesBand(options.freeTaste)
  const kind = aiSiteKind(typeof answers['kind'] === 'string' ? answers['kind'] : null)
  const colors = isAnswersRecord(answers['brandColors']) ? answers['brandColors'] : {}
  const primary = typeof colors['primary'] === 'string' ? colors['primary'].trim() : ''
  const pages = answers['pages']
  const brief = typeof answers['brief'] === 'string' ? answers['brief'] : ''
  return {
    ...AI_SITE_START_ANSWERS,
    siteType: bounded(brief, AI_SITE_INPUT_MAX_CHARS),
    ...(kind ? aiSiteStartStyleAnswer(kind.id) : {}),
    pages:
      typeof pages === 'number' && Number.isInteger(pages)
        ? Math.min(band.max, Math.max(band.min, pages))
        : Math.min(band.max, Math.max(band.min, AI_SITE_START_ANSWERS.pages)),
    brand: STARTER_BRAND_HEX.test(primary) ? primary.toLowerCase() : '',
  }
}

// ── A build staff run for a client (AGL-3958) ───────────────────────────────

/** Shortens an answer to what a scalar input admits, on a word where it can. */
function bounded(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).trim()
}

/** A time with am or pm: "9am", "5:30 pm", "12 a.m.". */
const TWELVE_HOUR_TIME = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])/gi

/**
 * The hours an owner gave, in the shape the Details step's hours picker
 * writes (`Tu-Sa 09:00-17:00`, one set of days a line), so the plan reads
 * them as it reads hours picked there. A time with am or pm is the time it
 * names, "to" joins a range as a dash does, and days with their hours may be
 * set apart by a comma, a semicolon or a line. Whatever still does not read
 * as hours — "8–5", "Sat by appointment" — is left out rather than guessed at.
 */
function clientBuildHours(hours: string): string {
  const lines = hours
    .replace(TWELVE_HOUR_TIME, (time, hour: string, minutes: string | undefined, half: string) => {
      const h = Number(hour)
      if (h < 1 || h > 12) return time
      const clock = (h % 12) + (half.toLowerCase() === 'p' ? 12 : 0)
      return `${String(clock).padStart(2, '0')}:${minutes ?? '00'}`
    })
    .replace(/\s+to\s+/gi, '-')
    .replace(/(\d{1,2}:\d{2})\s*,\s*/g, '$1\n')
    .replace(/;/g, '\n')
  const week = weeklyHoursFromText(lines).hours
  return week.some((day) => day.length) ? weeklyHoursToText(week) : ''
}

/**
 * The towns an intake serves, one a line, as the Details step's "Areas you
 * serve" holds them: "Austin, Round Rock and Pflugerville" is three.
 */
function clientBuildServiceArea(towns: string): string {
  return towns
    .split(/\r?\n|[,;]|\s+(?:and|&)\s+/i)
    .map((town) => town.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * The questions' answers for a site staff are building for a client: what
 * the business does is the kind of site, and the details the intake holds
 * fill the Details step's own fields (AGL-3979, AGL-3995): the phone, the
 * email, the towns as the areas it serves and the hours, each held to that
 * detail's own rule, so one the Details step would refuse is left empty
 * there. Every other answer keeps its default, which the review shows to
 * change. The intake, a refused detail included, also reaches the job
 * through {@link aiSiteStartClientInputs} and {@link aiSiteStartClientBrief}.
 */
export function aiSiteStartAnswersFromClientBuild(intake: ClientBuildIntake): AiSiteStartAnswers {
  const details = aiSiteDetailsOf({
    phone: intake.phone,
    email: intake.email,
    serviceArea: clientBuildServiceArea(intake.towns),
    hours: clientBuildHours(intake.hours),
  })
  return {
    ...AI_SITE_START_ANSWERS,
    siteType: bounded(intake.whatTheyDo, AI_SITE_INPUT_MAX_CHARS),
    // The site exists already and the intake answered for it: what the
    // business does picks its style, as "Pick for me" does, and staff change
    // it on the review like any answer.
    ...aiSiteStartStyleAnswer(SITE_STYLE_AUTO),
    phone: details.phone,
    email: details.email,
    serviceArea: details.serviceArea,
    hours: details.hours,
  }
}

/**
 * The per-site inputs the intake fills, which the guided start's own
 * questions leave empty: the business's name for the header and footer, and
 * the towns it serves as its place.
 *
 * The towns are the place only while no address is given. The Entity reads
 * `city` as the address's own locality wherever there is a street or a
 * postal code (`aiSiteEntity`), so once the answers carry either, `city` is
 * the city the Details step was given with that address, never the towns
 * (AGL-3995). The intake asks no address, so today that is the Details step's
 * own, typed on the review; the towns still reach the site as the areas it
 * serves.
 */
export function aiSiteStartClientInputs(
  intake: ClientBuildIntake,
  answers?: Pick<AiSiteStartAnswers, 'street' | 'postalCode' | 'city'> | null,
): Pick<AiSiteJobInputs, 'businessName' | 'city'> {
  const addressed = Boolean(answers?.street.trim() || answers?.postalCode.trim())
  return {
    businessName: bounded(intake.businessName, AI_SITE_INPUT_MAX_CHARS),
    city: bounded(addressed ? (answers?.city ?? '') : intake.towns, AI_SITE_INPUT_MAX_CHARS),
  }
}

/**
 * The intake as sentences added to the brief: how to reach the business and
 * when it is open, which the site should say where a visitor looks for them,
 * and the owner's own words, quoted, which the copy should sound like. Empty
 * answers say nothing.
 */
export function aiSiteStartClientBrief(intake: ClientBuildIntake): string {
  const name = intake.businessName.trim()
  const towns = intake.towns.trim()
  const phone = intake.phone.trim()
  const email = intake.email.trim()
  const hours = intake.hours.trim()
  const words = intake.ownerWords.trim().replace(/\s+/g, ' ')
  const sentences: string[] = []
  if (name) sentences.push(`The business is called ${name}.`)
  if (towns) sentences.push(`It serves ${towns}.`)
  const contact = [phone ? `call ${phone}` : '', email ? `email ${email}` : ''].filter(Boolean)
  if (contact.length) {
    sentences.push(`Visitors reach it to ${contact.join(' or ')}; say so wherever the site tells them how to get in touch.`)
  }
  if (hours) sentences.push(`Its hours are ${hours}.`)
  if (words) sentences.push(`In the owner's own words: "${words}" Write the copy so it sounds like them.`)
  return sentences.join(' ')
}

/**
 * What the review says the client build adds beyond its own rows, so staff
 * see the intake is used without it being asked again: the business's name
 * and the owner's own words, which no row shows. The phone, email, towns and
 * hours are the review's Details rows already (AGL-3995), so the note does
 * not say them twice: "Also from the client's details: Harbor Plumbing and
 * the owner's own words."
 */
export function aiSiteStartClientNote(intake: ClientBuildIntake): string {
  const parts = [intake.businessName.trim(), intake.ownerWords.trim() ? "the owner's own words" : ''].filter(Boolean)
  if (!parts.length) return 'Built from the client’s details.'
  return `Also from the client’s details: ${parts.join(' and ')}.`
}
