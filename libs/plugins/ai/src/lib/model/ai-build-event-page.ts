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

import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import type { AiBuildOps } from './ai-build-job'
import {
  AI_BUILD_PLAN_LIMITS,
  aiPlanSlugKey,
  type AiBuildItem,
  type AiBuildPlan,
  type AiBuildPlanScreen,
} from './ai-build-plan'

/**
 * THE PAGE A BUILD'S EVENTS ARE LISTED ON (AGL-3755).
 *
 * A build's `event` items are written as events, and an event is seen on the
 * site only through an Event List a page section places — the section whose
 * uses name the event. The live eval of 2026-10-13 asked "add our next three
 * Friday night jazz shows at 8pm to an events page" of a site with only a
 * Home page, and the plan made the three events and no page: they landed
 * nowhere a visitor could see. So, settled in code where there is one right
 * answer ({@link aiSettleBuildEventPage}), and re-asked where there is not
 * ({@link aiBuildUnlistedEventsCheck}):
 *
 *  1. Events no section names, and a page the plan makes about them (its
 *     address or title says events): the events are named in that page's
 *     section about them, else its second section, else its first.
 *  2. None such, the site has no page at `/events`, and the plan has room
 *     for one more page: the plan gains an Events page at `/events`, linked
 *     in the navigation and in the layout the other pages render in, whose
 *     one section lists them.
 *  3. Anything else — a site that already has an events page, a plan at its
 *     page cap — is left to the plan's one re-ask, which names the events.
 *
 * Only the `event` operation: other placed operations keep their own rules.
 */

/** The operation whose items this settles; the events-calendar plugin's, named, never imported. */
export const AI_BUILD_EVENT_OP = 'event'

const EVENT_PAGE_TITLE = 'Events'

/**
 * The page a build adds for its events. Its address is the SITE's page,
 * spelled from its title so it is never read as the console's Events page.
 */
export const AI_BUILD_EVENT_PAGE = {
  title: EVENT_PAGE_TITLE,
  slug: `/${EVENT_PAGE_TITLE.toLowerCase()}`,
  section: 'Upcoming events',
} as const

/** A page or section that is about events. */
const ABOUT_EVENTS = /\b(events?|calendar|upcoming|what'?s on|shows?|gigs?|schedule|classes|workshops?)\b/i

const refOf = (item: Pick<AiBuildItem, 'name'>) => `new:${item.name}`

/** The plan's event items that no page section names. */
export function aiBuildUnlistedEvents(plan: Pick<AiBuildPlan, 'items' | 'screens'>): AiBuildItem[] {
  const uses = new Set(
    plan.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses.map((ref) => ref.trim().toLowerCase()))),
  )
  return (plan.items ?? []).filter((item) => item.op === AI_BUILD_EVENT_OP && !uses.has(refOf(item).trim().toLowerCase()))
}

/** Whether a planned page is about events: its address or its title says so. */
function aboutEvents(screen: Pick<AiBuildPlanScreen, 'slug' | 'title'>): boolean {
  const first = screen.slug.trim().replace(/^\/+/, '').split('/')[0] ?? ''
  return first !== '' && ABOUT_EVENTS.test(`${first.replace(/-/g, ' ')} ${screen.title}`)
}

/** The section of an events page that lists them: the one named for them, else its second, else its first. */
function listingSection(screen: AiBuildPlanScreen): number {
  const named = screen.sections.findIndex((section) => ABOUT_EVENTS.test(section.name))
  if (named !== -1) return named
  return screen.sections.length > 1 ? 1 : 0
}

export interface AiBuildEventPageContext {
  /** The operations this site has; the settling runs only where it has `event`. */
  ops: AiBuildOps | null
  /** The site's pages, by address. */
  siteSlugs: readonly string[]
  /** How many pages the build may plan. */
  pageLimit: number
  /** The layout the site's pages render in (its home page's, else its one layout), or null. */
  siteLayout: string | null
}

/** A build plan with its unlisted events placed where there is one right answer; otherwise as it came. */
export function aiSettleBuildEventPage<T extends AiBuildPlan>(plan: T, context: AiBuildEventPageContext): T {
  if (!context.ops?.has(AI_BUILD_EVENT_OP)) return plan
  const unlisted = aiBuildUnlistedEvents(plan)
  if (!unlisted.length) return plan
  const refs = unlisted.map(refOf)
  // 1. A page the plan makes about them lists them.
  const page = plan.screens.findIndex((screen) => !screen.record && screen.sections.length && aboutEvents(screen))
  if (page !== -1) {
    const screen = plan.screens[page] as AiBuildPlanScreen
    const at = listingSection(screen)
    const section = screen.sections[at]
    if (!section || section.uses.length + refs.length > AI_BUILD_PLAN_LIMITS.uses) return plan
    const sections = screen.sections.map((one, index) => (index === at ? { ...one, uses: [...one.uses, ...refs] } : one))
    return { ...plan, screens: plan.screens.map((one, index) => (index === page ? { ...screen, sections } : one)) }
  }
  // 2. An Events page of its own, where the address is free and the plan has room.
  const taken = new Set([...context.siteSlugs, ...plan.screens.map((screen) => screen.slug)].map(aiPlanSlugKey))
  if (taken.has(aiPlanSlugKey(AI_BUILD_EVENT_PAGE.slug)) || plan.screens.length >= context.pageLimit) return plan
  if (refs.length > AI_BUILD_PLAN_LIMITS.uses) return plan
  const names = unlisted.map((item) => item.name)
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const events: AiBuildPlanScreen = {
    title: AI_BUILD_EVENT_PAGE.title,
    slug: AI_BUILD_EVENT_PAGE.slug,
    // The layout the plan's other pages render in, else the site's.
    layout: plan.screens.find((screen) => screen.layout)?.layout ?? context.siteLayout,
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: AI_BUILD_EVENT_PAGE.title,
    seoDescription: `Upcoming events: ${listed}.`.slice(0, AI_BUILD_PLAN_LIMITS.seoDescription),
    sections: [{ name: AI_BUILD_EVENT_PAGE.section, uses: refs, items: 0 }],
    record: null,
  }
  return { ...plan, screens: [...plan.screens, events] }
}

/** The re-ask for events the settling could not place: each named, and where to put it. */
export function aiBuildUnlistedEventsCheck(ops: AiBuildOps | null): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  return (plan) => {
    if (!ops?.has(AI_BUILD_EVENT_OP)) return []
    const unlisted = aiBuildUnlistedEvents(plan)
    if (!unlisted.length) return []
    const named = unlisted.map((item) => `new:${item.name}`).join(', ')
    return [
      {
        rule: null,
        code: 'plan-job-shape',
        message: `The events ${named} are listed on no page, so no visitor would see them. Put each in the uses of the section that lists the events, on the page the request names for them or a page about events this plan makes.`,
      },
    ]
  }
}
