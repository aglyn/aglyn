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
 * A site start's HOME ARC (AGL-3899): which sections its home page tells
 * its story with, and in what order, chosen in code by the job's seed among
 * the arcs that suit the site's kind.
 *
 * Why. Told one outline for every home ("a hero, then services, about or why
 * us, … a closing call to action last"), the 22 newest production starts of
 * 2026-10-16 were 16 times hero → offer → about → proof → closing call to
 * action, and 19 of them ended on a call to action. Zach: "almost every AI
 * site seems to look the same … they all have the same sections". A theme
 * that varies on a fixed outline still reads as one site.
 *
 * So each kind has a few arcs, each a different way a designer would tell
 * that business's story — the work first, the story first, the steps first,
 * a close on the questions people ask, a gallery of the place, a menu or a
 * services list where the kind has one — and the seed picks one. The plan's
 * turn names it in one line; the model still names, writes and designs every
 * section, and the plan rules hold it as they hold any plan.
 *
 * Every arc is a hero and four sections: the home's fewest
 * (`AI_SITE_HOME_MIN_SECTIONS`), which the Free wall pays for beside the
 * other page, and which a paid plan adds to where the brief gives more. A
 * store's arcs are its storefront's parts (`AI_SITE_STORE_HOME_BANDS`) in
 * three orders, the newsletter sign-up always last, as the storefront settle
 * keeps it (`aiStorefrontPlanScreens`). No
 * arc promises what a new site has not got: figures, prices, listings and
 * shows are "only as the brief gives them", and none plans what customers
 * say (AGL-3887).
 *
 * Pure data and one reader, safe for the console to import.
 */

/** What a section of an arc is for: what the variety specs compare arcs by. */
export type AiSiteHomeRole =
  | 'offer'
  | 'work'
  | 'story'
  | 'steps'
  | 'approach'
  | 'why'
  | 'faq'
  | 'gallery'
  | 'menu'
  | 'people'
  | 'area'
  | 'facts'
  | 'listen'
  | 'writing'
  | 'topics'
  | 'cta'
  | 'products'
  | 'collections'
  | 'reviews'
  | 'signup'

/** One section of an arc: its role, and the words the plan is told. */
export interface AiSiteHomeArcSection {
  role: AiSiteHomeRole
  words: string
}

/** A home arc: an id the job records, and the sections after the hero, in order. */
export interface AiSiteHomeArc {
  id: string
  sections: readonly AiSiteHomeArcSection[]
}

const s = (role: AiSiteHomeRole, words: string): AiSiteHomeArcSection => ({ role, words })

// The parts arcs share, in the plan's words.
const CTA = s('cta', 'a call to action')
const FAQ = s('faq', 'the questions people ask, answered')
const APPROACH = s('approach', 'what working together is like')

/** The arcs each kind's home may follow; a kind not listed follows `business`'s. */
const ARCS: Readonly<Record<string, readonly AiSiteHomeArc[]>> = {
  business: [
    { id: 'offer-first', sections: [s('offer', 'the services'), s('why', 'why choose it'), s('steps', 'how it works, as steps'), CTA] },
    { id: 'story-first', sections: [s('story', 'the story behind the business'), s('offer', 'the services'), APPROACH, CTA] },
    { id: 'steps-first', sections: [s('steps', 'how it works, as steps'), s('offer', 'the services'), APPROACH, FAQ] },
    { id: 'work-first', sections: [s('work', 'the work or results in pictures'), s('offer', 'the services'), s('why', 'why choose it'), FAQ] },
  ],
  trades: [
    { id: 'offer-first', sections: [s('offer', 'the services'), s('area', 'the area served'), s('why', 'why customers can trust it, only as the brief gives it'), CTA] },
    { id: 'trust-first', sections: [s('why', 'why customers can trust it, only as the brief gives it'), s('offer', 'the services'), s('steps', 'how a job goes, as steps'), FAQ] },
    { id: 'work-first', sections: [s('work', 'recent work in pictures'), s('offer', 'the services'), s('area', 'the area served'), CTA] },
    { id: 'steps-first', sections: [s('steps', 'how a job goes, as steps'), s('offer', 'the services'), FAQ, CTA] },
  ],
  professional: [
    { id: 'offer-first', sections: [s('offer', 'the practice areas'), s('steps', 'the approach, as steps'), s('people', 'the people behind the practice'), CTA] },
    { id: 'approach-first', sections: [s('approach', 'the approach and what it means for a client'), s('offer', 'the practice areas'), FAQ, CTA] },
    { id: 'people-first', sections: [s('people', 'the people behind the practice'), s('offer', 'the practice areas'), APPROACH, FAQ] },
  ],
  wellness: [
    { id: 'steps-first', sections: [s('approach', 'who it helps and how'), s('steps', 'what a first visit is like, as steps'), s('offer', 'the services'), FAQ] },
    { id: 'offer-first', sections: [s('offer', 'the services'), s('approach', 'the approach to care'), s('people', 'the people who give it'), CTA] },
    { id: 'story-first', sections: [s('story', 'the story of the practice'), s('offer', 'the services'), s('steps', 'what a first visit is like, as steps'), CTA] },
  ],
  restaurant: [
    { id: 'menu-first', sections: [s('menu', 'the menu highlights'), s('story', 'the story of the place'), s('gallery', 'the room and the food in pictures'), s('facts', 'visiting, with hours and address only as the brief gives them')] },
    { id: 'story-first', sections: [s('story', 'the story of the place'), s('menu', 'the menu highlights'), s('gallery', 'the room and the food in pictures'), CTA] },
    { id: 'gallery-first', sections: [s('gallery', 'the food and the room in pictures'), s('menu', 'the menu highlights'), s('story', 'the story of the place'), FAQ] },
    { id: 'visit-first', sections: [s('facts', 'visiting, with hours and address only as the brief gives them'), s('menu', 'the menu highlights'), s('story', 'the story of the place'), s('gallery', 'the room and the food in pictures')] },
  ],
  store: [
    { id: 'bestsellers-first', sections: [s('products', '"Bestsellers"'), s('collections', '"Shop by collection"'), s('story', 'the brand story'), s('why', 'why buy here'), s('reviews', '"Customer reviews"'), s('signup', '"Newsletter sign-up"')] },
    { id: 'collections-first', sections: [s('collections', '"Shop by collection"'), s('products', '"Bestsellers"'), s('why', 'why buy here'), s('story', 'the brand story'), s('reviews', '"Customer reviews"'), s('signup', '"Newsletter sign-up"')] },
    { id: 'story-first', sections: [s('products', '"Bestsellers"'), s('story', 'the brand story'), s('collections', '"Shop by collection"'), s('reviews', '"Customer reviews"'), s('why', 'why buy here'), s('signup', '"Newsletter sign-up"')] },
  ],
  portfolio: [
    { id: 'work-first', sections: [s('work', 'selected work in pictures'), s('story', 'a short about'), s('offer', 'what the work is available for, such as commissions'), CTA] },
    { id: 'statement-first', sections: [s('story', 'a short statement about the work'), s('work', 'selected work in pictures'), s('steps', 'the process, as steps'), CTA] },
    { id: 'process-led', sections: [s('work', 'selected work in pictures'), s('steps', 'the process, as steps'), FAQ, s('story', 'a short about')] },
  ],
  studio: [
    { id: 'work-first', sections: [s('work', 'selected case studies'), s('offer', 'the services, as a short list'), s('steps', 'how the studio works, as steps'), CTA] },
    { id: 'beliefs-first', sections: [s('story', 'what the studio believes'), s('work', 'selected case studies'), s('offer', 'the services, as a short list'), FAQ] },
    { id: 'offer-first', sections: [s('offer', 'the services'), s('work', 'selected case studies'), s('people', 'the team'), CTA] },
  ],
  photography: [
    { id: 'gallery-first', sections: [s('work', 'galleries by subject'), s('story', 'a short personal about'), s('steps', 'what a session is like, as steps'), CTA] },
    { id: 'about-first', sections: [s('story', 'a short personal about'), s('work', 'galleries by subject'), s('offer', 'the sessions, with packages only as the brief gives them'), FAQ] },
    { id: 'session-first', sections: [s('steps', 'what a session is like, as steps'), s('work', 'galleries by subject'), APPROACH, CTA] },
  ],
  blog: [
    { id: 'writing-first', sections: [s('writing', 'featured writing'), s('topics', 'the topics covered'), s('story', 'about the writer'), CTA] },
    { id: 'writer-first', sections: [s('story', 'about the writer'), s('writing', 'featured writing'), s('topics', 'the topics covered'), FAQ] },
    { id: 'topics-first', sections: [s('topics', 'the topics covered'), s('writing', 'featured writing'), s('steps', 'where a new reader starts, as steps'), s('story', 'about the writer')] },
  ],
  events: [
    { id: 'about-first', sections: [s('story', 'what it is and why to come'), s('steps', 'the schedule, as steps'), FAQ, CTA] },
    { id: 'schedule-first', sections: [s('steps', 'the schedule, as steps'), s('facts', 'the venue and travel, only as the brief gives them'), FAQ, CTA] },
    { id: 'gallery-first', sections: [s('gallery', 'the place in pictures'), s('story', 'what it is and why to come'), s('steps', 'the schedule, as steps'), FAQ] },
  ],
  fitness: [
    { id: 'offer-first', sections: [s('offer', 'the classes or programs'), s('steps', 'how to start, as steps'), s('people', 'the coaches'), CTA] },
    { id: 'why-first', sections: [s('why', 'why train here'), s('offer', 'the classes or programs'), FAQ, CTA] },
    { id: 'steps-first', sections: [s('steps', 'how to start, as steps'), s('offer', 'the classes or programs'), s('gallery', 'the space in pictures'), FAQ] },
    { id: 'people-first', sections: [s('people', 'the coaches'), s('offer', 'the classes or programs'), s('facts', 'memberships, only as the brief gives them'), CTA] },
  ],
  yoga: [
    { id: 'offer-first', sections: [s('offer', 'the classes'), s('steps', 'what a first class is like, as steps'), s('story', 'a gentle about'), CTA] },
    { id: 'story-first', sections: [s('story', 'the story of the studio'), s('offer', 'the classes'), s('gallery', 'the space in pictures'), FAQ] },
    { id: 'steps-first', sections: [s('steps', 'what a first class is like, as steps'), s('offer', 'the classes'), s('people', 'the teachers'), CTA] },
  ],
  beauty: [
    { id: 'menu-first', sections: [s('menu', 'the services menu, with prices only as the brief gives them'), s('gallery', 'the look and feel of the place in pictures'), s('people', 'the team'), CTA] },
    { id: 'gallery-first', sections: [s('gallery', 'the look and feel of the place in pictures'), s('menu', 'the services menu, with prices only as the brief gives them'), s('steps', 'what a visit is like, as steps'), FAQ] },
    { id: 'people-first', sections: [s('people', 'the team'), s('menu', 'the services menu, with prices only as the brief gives them'), s('gallery', 'the place in pictures'), CTA] },
  ],
  realestate: [
    { id: 'area-first', sections: [s('area', 'the areas served'), s('steps', 'how buying or selling works, as steps'), s('work', 'featured listings as picture cards the owner fills in'), CTA] },
    { id: 'people-first', sections: [s('people', 'about the agent or team'), s('area', 'the areas served'), FAQ, CTA] },
    { id: 'listings-first', sections: [s('work', 'featured listings as picture cards the owner fills in'), s('area', 'the areas served'), s('steps', 'how selling works, as steps'), FAQ] },
  ],
  education: [
    { id: 'offer-first', sections: [s('offer', 'the courses or subjects'), s('steps', 'how it works, as steps'), s('people', 'the teachers'), FAQ] },
    { id: 'result-first', sections: [s('why', 'who it is for and what they come away with'), s('offer', 'the courses or subjects'), s('approach', 'what a lesson is like'), CTA] },
    { id: 'people-first', sections: [s('people', 'the teachers'), s('offer', 'the courses or subjects'), s('steps', 'how enrolling works, as steps'), CTA] },
  ],
  nonprofit: [
    { id: 'work-first', sections: [s('offer', 'what the organization does'), s('facts', 'its impact, only as the brief gives it'), s('steps', 'how to help, as steps'), CTA] },
    { id: 'story-first', sections: [s('story', 'the story of the cause'), s('offer', 'the programs'), s('steps', 'how to help, as steps'), FAQ] },
    { id: 'help-first', sections: [s('steps', 'how to help, as steps'), s('offer', 'what the organization does'), s('gallery', 'the community in pictures'), CTA] },
  ],
  music: [
    { id: 'listen-first', sections: [s('listen', 'a listen section'), s('work', 'releases or shows, only as the brief gives them'), s('story', 'a short bio'), CTA] },
    { id: 'bio-first', sections: [s('story', 'a short bio'), s('listen', 'a listen section'), s('gallery', 'the band live in pictures'), CTA] },
    { id: 'shows-first', sections: [s('work', 'releases or shows, only as the brief gives them'), s('listen', 'a listen section'), s('gallery', 'the band live in pictures'), s('story', 'a short bio')] },
  ],
  personal: [
    { id: 'offer-first', sections: [s('offer', 'what they do'), s('steps', 'experience or highlights, as steps'), s('work', 'selected work, only as the brief names some'), CTA] },
    { id: 'story-first', sections: [s('story', 'a short story'), s('offer', 'what they do'), s('steps', 'experience or highlights, as steps'), CTA] },
    { id: 'questions-led', sections: [s('offer', 'what they do'), s('story', 'a short story'), FAQ, CTA] },
  ],
  landing: [
    { id: 'benefits-first', sections: [s('why', 'the benefits'), s('steps', 'how it works, as steps'), FAQ, s('cta', 'the call to action again')] },
    { id: 'steps-first', sections: [s('steps', 'how it works, as steps'), s('why', 'the benefits'), s('approach', 'who it is for'), s('cta', 'the call to action again')] },
    { id: 'problem-first', sections: [s('story', 'the problem it solves'), s('why', 'the benefits'), FAQ, s('cta', 'the call to action again')] },
  ],
  'coming-soon': [
    { id: 'promise-first', sections: [s('story', 'what is coming'), s('why', 'two or three reasons to care'), s('people', 'who is behind it'), s('cta', 'a way to hear first')] },
    { id: 'reasons-first', sections: [s('why', 'two or three reasons to care'), s('story', 'what is coming'), FAQ, s('cta', 'a way to hear first')] },
    { id: 'people-first', sections: [s('people', 'who is behind it'), s('story', 'what is coming'), s('why', 'two or three reasons to care'), s('cta', 'a way to hear first')] },
  ],
}

/** The arcs a kind's home may follow. */
export function aiSiteHomeArcsFor(kind: string | null | undefined): readonly AiSiteHomeArc[] {
  return (kind && ARCS[kind]) || (ARCS['business'] as readonly AiSiteHomeArc[])
}

/** A small deterministic generator over a seed (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The arc a job's home follows: one of its kind's, picked by the job's seed
 * (`aiSiteSeed` of the job id) under a salt of its own, so the arc is drawn
 * apart from the look and the compiler's choices, which read the same seed.
 */
export function aiSiteHomeArc(input: { kind: string | null | undefined; seed: number }): AiSiteHomeArc {
  const arcs = aiSiteHomeArcsFor(input.kind)
  const next = random((input.seed ^ 0x51ed2701) >>> 0)
  return arcs[Math.floor(next() * arcs.length) % arcs.length] as AiSiteHomeArc
}

/** An arc's sections as one phrase: "the services, why choose it and a call to action". */
function listed(sections: readonly AiSiteHomeArcSection[]): string {
  const words = sections.map((section) => section.words)
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/**
 * The plan's one line for its arc: the hero first, then the arc's sections in
 * its order, more only where the brief gives them and the plan has room.
 */
export function aiSiteHomeArcSentence(arc: AiSiteHomeArc): string {
  return `This site's home tells its story in its own order: the hero first, then ${listed(arc.sections)}. Keep that order, name each section for what this business has to say there, and add a section the brief needs only where the plan has room.`
}
