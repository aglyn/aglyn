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
  AI_SITE_INPUT_MAX_CHARS,
  AI_SITE_PAGES,
  type AiSiteJobInputs,
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

/** What a person answered; the shape the card holds and the brief is built from. */
export interface AiSiteStartAnswers {
  /** What kind of site this is. The one answer with no default. */
  siteType: string
  /** Who the site is for; empty when they did not say. */
  audience: string
  /** The example they liked, by {@link AiSiteStartExample.id}; `null` for none. */
  example: string | null
  /** How many pages to plan. */
  pages: number
  /** Whether the scaffold also drafts a welcome email. */
  welcomeEmail: boolean
}

/**
 * What the questions start on. Five pages because it is the middle of the
 * band the scaffold builds, and a welcome email because the scaffold drafts
 * one unless it is told not to.
 */
export const AI_SITE_START_ANSWERS: AiSiteStartAnswers = {
  siteType: '',
  audience: '',
  example: null,
  pages: 5,
  welcomeEmail: true,
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
export function aiSiteStartRefusal(answers: AiSiteStartAnswers): string | null {
  const siteType = answers.siteType.trim()
  if (!siteType) return 'Say what kind of site this is.'
  if (siteType.length > AI_SITE_INPUT_MAX_CHARS) {
    return `Keep what kind of site this is under ${AI_SITE_INPUT_MAX_CHARS} characters.`
  }
  if (answers.audience.trim().length > AI_SITE_INPUT_MAX_CHARS) {
    return `Keep who the site is for under ${AI_SITE_INPUT_MAX_CHARS} characters.`
  }
  if (
    !Number.isInteger(answers.pages) ||
    answers.pages < AI_SITE_PAGES.min ||
    answers.pages > AI_SITE_PAGES.max
  ) {
    return `A site is planned with ${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max} pages.`
  }
  if (answers.example !== null && !aiSiteStartExample(answers)) {
    return 'Pick one of the examples, or none of them.'
  }
  return null
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
  sentences.push(
    'Plan a page for each thing a visitor comes to do, and a contact form on the page that asks to be contacted.',
  )
  return sentences.join(' ')
}

/**
 * The answers as the `site` job's scalar inputs. Read by the door's
 * {@link parseAiSiteJobInputs}, and put in front of the model one per line by
 * the plan step, which is how the audience and the example reach the plan
 * without a prompt of their own.
 *
 * The per-site variables an agency batch fills — the business name, the city,
 * the brand — are left empty: this is one person's own site, and its name is
 * on the site already.
 */
export function aiSiteStartInputs(
  answers: AiSiteStartAnswers,
): Omit<AiSiteJobInputs, 'batchId'> {
  const example = aiSiteStartExample(answers)
  return {
    businessType: answers.siteType.trim(),
    audience: answers.audience.trim(),
    starter: example?.id ?? '',
    pages: answers.pages,
    businessName: '',
    city: '',
    brand: '',
    welcomeEmail: answers.welcomeEmail,
  }
}
