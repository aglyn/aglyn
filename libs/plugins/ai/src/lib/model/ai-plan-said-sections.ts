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
 * A plan's sections of what customers say (AGL-3887).
 *
 * A job never writes a review, a testimonial or a quote for people who did
 * not say it (rule 14, `AI_SITE_CONTEXT_RULE`). So a section planned to show
 * them, on a site that has none, has nothing true to hold, and the build
 * fills it with the only honest thing left: a promise of words to come. The
 * live Whitmore Lane Family Law start (beta.262, 2026-10-16) planned "Client
 * feedback placeholder" on its home page and shipped "We are building this
 * space for the words of families we have worked with" over a stock photo.
 *
 * A site start's plan is settled in code before it is kept, never re-asked
 * (a re-ask costs the person credits for a plan that has one answer): such a
 * section becomes a band about what working together is like, as a
 * photographer's start of the same day planned its "Kind words" as "What
 * working together is like" (Relaxed / Prepared / Personal). Where the page
 * already has that band, the section goes, if the page keeps its fewest
 * sections without it.
 *
 * Kept as planned where the customer words are real: a store, whose
 * platform shows its shoppers' reviews; a site with a dataset of them; a
 * brief that asks for them or quotes them.
 *
 * Every plan, whatever its kind, names no section "placeholder": a section's
 * name is what its build is asked to write, and a name that says it is a
 * stand-in is written as one. Nor does it name a gap (AGL-4092): an Assist
 * build's About plan of 2026-10-28 named "Who we are: …, with [year
 * founded] and [team story]" and "Contact details: [email], [phone], …", and
 * its plan card printed them. A fact in square brackets, "to be added" and
 * "TBD" are taken out of a name, with the words that joined them to it.
 *
 * Pure: plans in, plans out.
 */

import type { AiBuildPlan, AiBuildPlanScreen, AiBuildPlanSection } from './ai-build-plan'
import type { AiSiteInventory } from './ai-site-inventory'

/** Who a section of customer words quotes. */
const SAYERS =
  '(?:clients?|customers?|patients?|guests?|famil(?:y|ies)|parents?|students?|readers?|members?|couples?|homeowners?|buyers?|shoppers?|diners?|people|others)'

/**
 * The words a section of what customers say is named by. "Review" alone is
 * not one of them: a law firm's "Free case review" or an accountant's "Plan
 * review" is a service, not a quote.
 */
const SAID_SECTION = new RegExp(
  [
    '\\btestimonials?\\b',
    '\\bkind words\\b',
    '\\bsocial proof\\b',
    '\\bcustomer love\\b',
    '\\bendorsements?\\b',
    '\\bin their (?:own )?words\\b',
    '\\bword of mouth\\b',
    '\\bsuccess stories\\b',
    `\\b${SAYERS}['’]?s?['’]? (?:feedback|reviews?|stories|voices|words|praise|say(?:s|ing)?)\\b`,
    `\\bwhat (?:our |my |real )?(?:\\w+ )?${SAYERS} (?:say|are saying|think|tell us)\\b`,
    '\\b(?:star|5-star|five-star|google|yelp|online|verified) (?:reviews?|ratings?)\\b',
    '\\bratings? (?:and|&) reviews?\\b',
    '\\breviews? (?:and|&) (?:ratings?|testimonials?)\\b',
    '^\\s*(?:reviews|feedback)\\s*$',
  ].join('|'),
  'i',
)

/** A dataset's name that says it holds what customers said. */
const SAID_RECORDS = /\b(?:reviews|testimonials?|kind words|endorsements?)\b/i

/** A quotation with its speaker: “…” — Name, the way a brief gives a real testimonial. */
const ATTRIBUTED_QUOTE = /[“"][^”"]{12,}[”"]\s*[—–-]+\s*\p{L}/u

/** A section already about working together: its approach, its process, what to expect. */
const APPROACH =
  /\b(?:what (?:working|it(?:['’]s| is) like)|working (?:together|with (?:us|me|our team))|how (?:we|i|it) work|our (?:approach|process)|the process|approach|process|what to expect)\b/i

/** The word a stand-in is named by, with any brackets, parentheses or dash it is set off by. */
const PLACEHOLDER_WORD = /\s*[[(]?\s*[-–—:]?\s*\bplace ?holders?\b\s*[\])]?/gi

/** What a section of customer words on a site that has none is planned as instead. */
export const AI_PLAN_SAID_SECTION_NAME = 'What working with us is like'

/** The points that band makes (the photographer's three: Relaxed, Prepared, Personal). */
export const AI_PLAN_SAID_SECTION_ITEMS = 3

/** The fewest sections any page other than the home keeps after a section goes. */
const PAGE_MIN_SECTIONS = 2

/** Whether a planned section's name says it shows what customers say. */
export function aiPlanSectionSaysCustomerWords(name: string): boolean {
  return SAID_SECTION.test(aiPlanSectionNameWithoutPlaceholder(name))
}

/** A fact a plan left in square brackets, as the doctrine's validators read one (`BRACKETED_FACT`): "[year founded]". */
const BRACKETED_GAP = /\[[^[\]{}\n]{1,80}\]/g

/** A gap's own words, "to be added" or "TBD", with any parentheses or dash they are set off by. */
const GAP_WORDS =
  /\s*[(]?\s*[-–—:]?\s*\b(?:(?:details?|dates?|info|information|names?)\s+)?(?:to be (?:added|confirmed|announced|determined|decided)|tbd|tba)\b\s*[)]?/gi

/** Where a bracketed gap stood while the words around it are tidied. */
const GAP = '\uE000'

/** Words that join a gap to a list: a comma, "and", "or". */
const LIST_JOIN = '\\s*(?:,|;|&|/|\\band\\b|\\bor\\b)(?:\\s*(?:\\band\\b|\\bor\\b))?\\s*'

/** A run of gaps listed together: "[year founded] and [team story]", "[email], [phone]". */
const GAP_RUN = new RegExp(`${GAP}(?:${LIST_JOIN}${GAP})+`, 'g')

/** A gap that opens a name or a list after a colon, and the comma after it: "Contact details: [email], …". */
const LEADING_GAP = new RegExp(`(^|:\\s*)${GAP}(?:\\s*,\\s*(?:(?:and|or)\\s+)?)?`, 'g')

/** A gap and the words that joined it to the name: ", with [year founded]", ", and [age and class requirements]". */
const JOINED_GAP = new RegExp(
  `\\s*,?\\s*(?:\\b(?:and|or|with|including|plus|such as|like|in|since|on|at|from|by)\\b\\s*|&\\s*)*${GAP}`,
  'gi',
)

/** Whether a name says it is a stand-in, or holds a gap (AGL-3887, AGL-4092). */
const HOLDS_GAP = /\bplace ?holders?\b|\[[^[\]{}\n]{1,80}\]|\bto be (?:added|confirmed|announced|determined|decided)\b|\b(?:tbd|tba)\b/i

/**
 * A section's name with the word "placeholder" (AGL-3887) and every gap
 * (AGL-4092) taken out, with the words that joined them: "Who we are: a
 * team, with [year founded] and [team story]" is "Who we are: a team". The
 * name unchanged where it had none; "Section" where nothing is left.
 */
export function aiPlanSectionNameWithoutPlaceholder(name: string): string {
  if (!HOLDS_GAP.test(name)) return name
  const cleaned = name
    .replace(PLACEHOLDER_WORD, ' ')
    .replace(GAP_WORDS, ' ')
    .replace(BRACKETED_GAP, GAP)
    .replace(GAP_RUN, GAP)
    .replace(LEADING_GAP, '$1')
    .replace(JOINED_GAP, '')
    .split(GAP)
    .join('')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:,;]+|[\s\-–—:,;]+$/g, '')
    .trim()
  return cleaned || 'Section'
}

/**
 * Whether the site, or the person asking, has customer words that are real
 * (AGL-3887): a store's shoppers' reviews, which its platform shows; a
 * dataset of them the site keeps; a brief that names them or quotes one with
 * its speaker.
 */
export function aiPlanHasCustomerWords(input: {
  brief?: string | null
  inventory?: Pick<AiSiteInventory, 'datasets'> | null
  siteKind?: string | null
}): boolean {
  if (input.siteKind === 'store') return true
  if ((input.inventory?.datasets ?? []).some((dataset) => SAID_RECORDS.test(dataset.name))) return true
  const brief = input.brief ?? ''
  return SAID_SECTION.test(brief) || ATTRIBUTED_QUOTE.test(brief)
}

/** Every section's name with the word "placeholder" (AGL-3887) and every gap (AGL-4092) taken out, the plan unchanged where none had one. */
export function aiSettlePlanPlaceholderNames<P extends Pick<AiBuildPlan, 'screens'>>(plan: P): P {
  let changed = false
  const screens = plan.screens.map((screen) => {
    let touched = false
    const sections = screen.sections.map((section) => {
      const name = aiPlanSectionNameWithoutPlaceholder(section.name)
      if (name === section.name) return section
      touched = true
      return { ...section, name }
    })
    if (!touched) return screen
    changed = true
    return { ...screen, sections }
  })
  return changed ? { ...plan, screens } : plan
}

/**
 * A site start's plan with no section of customer words it cannot fill
 * (AGL-3887). Where `hasCustomerWords` is false, each such section past a
 * page's first is planned as {@link AI_PLAN_SAID_SECTION_NAME} with its
 * points; where the page already has that band, it is taken out instead
 * while the page keeps its fewest sections (`homeMin` on the home page, two
 * on any other), and planned as the band all the same where it cannot be.
 * The plan is returned unchanged where nothing moved.
 */
export function aiSettlePlanSaidSections<P extends Pick<AiBuildPlan, 'screens'>>(
  plan: P,
  options: { hasCustomerWords: boolean; homeMin: number },
): P {
  if (options.hasCustomerWords) return plan
  let changed = false
  const screens = plan.screens.map((screen) => {
    const next = settleScreen(screen, options.homeMin)
    if (next !== screen) changed = true
    return next
  })
  return changed ? { ...plan, screens } : plan
}

function isHome(screen: Pick<AiBuildPlanScreen, 'slug'>): boolean {
  return screen.slug.trim().replace(/^\/+|\/+$/g, '') === ''
}

function settleScreen<S extends Pick<AiBuildPlanScreen, 'slug' | 'sections'>>(screen: S, homeMin: number): S {
  const said = screen.sections.flatMap((section, index) =>
    index > 0 && aiPlanSectionSaysCustomerWords(section.name) ? [index] : [],
  )
  if (!said.length) return screen
  const floor = isHome(screen) ? Math.max(homeMin, PAGE_MIN_SECTIONS) : PAGE_MIN_SECTIONS
  let approach = screen.sections.some((section, index) => !said.includes(index) && APPROACH.test(section.name))
  let count = screen.sections.length
  const sections: AiBuildPlanSection[] = []
  screen.sections.forEach((section, index) => {
    if (!said.includes(index)) {
      sections.push(section)
      return
    }
    if (approach && count - 1 >= floor) {
      count -= 1
      return
    }
    approach = true
    sections.push({
      ...section,
      name: AI_PLAN_SAID_SECTION_NAME,
      items: Math.max(section.items, AI_PLAN_SAID_SECTION_ITEMS),
    })
  })
  return { ...screen, sections }
}
