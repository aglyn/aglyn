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

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import {
  AI_BUILD_EVENT_PAGE,
  aiBuildUnlistedEvents,
  aiBuildUnlistedEventsCheck,
  aiSettleBuildEventPage,
} from './ai-build-event-page'
import type { AiBuildItem, AiBuildPlan, AiBuildPlanScreen } from './ai-build-plan'

/**
 * Where a build's events are listed (AGL-3755): the live eval of 2026-10-13
 * made three events and no page. Settled in code where there is one answer,
 * re-asked where there is not.
 */

const OPS = new Map([['event', { op: 'event' } as PluginAiCapability]])
const CONTEXT = { ops: OPS, siteSlugs: ['/'], pageLimit: 8, siteLayout: 'lay-site' }

const event = (name: string): AiBuildItem => ({
  slot: 'i0',
  op: 'event',
  name,
  why: '',
  dependsOn: [],
  degrade: 'omit',
  args: { title: name, startsAt: '2026-10-16T20:00', timezone: 'America/Chicago', description: 'Jazz.' },
})

const EVENTS = [event('Jazz — Oct 16'), event('Jazz — Oct 23'), event('Jazz — Oct 30')]
const REFS = EVENTS.map((one) => `new:${one.name}`)

const screen = (patch: Partial<AiBuildPlanScreen>): AiBuildPlanScreen => ({
  title: 'About',
  slug: '/about',
  layout: 'lay-site',
  template: null,
  duplicateOf: null,
  nav: true,
  seoTitle: 'About',
  seoDescription: 'About us',
  sections: [{ name: 'Story', uses: [], items: 0 }],
  record: null,
  ...patch,
})

const plan = (screens: AiBuildPlanScreen[], items: AiBuildItem[] = EVENTS): AiBuildPlan => ({ reuse: [], create: [], screens, items })

describe('a build’s events page (AGL-3755)', () => {
  it('adds an Events page at /events, in the site’s layout, whose one section lists every unlisted event', () => {
    const settled = aiSettleBuildEventPage(plan([]), CONTEXT)
    expect(settled.screens).toEqual([
      {
        title: AI_BUILD_EVENT_PAGE.title,
        slug: '/events',
        layout: 'lay-site',
        template: null,
        duplicateOf: null,
        nav: true,
        seoTitle: 'Events',
        seoDescription: 'Upcoming events: Jazz — Oct 16, Jazz — Oct 23 and Jazz — Oct 30.',
        sections: [{ name: 'Upcoming events', uses: REFS, items: 0 }],
        record: null,
      },
    ])
    expect(aiBuildUnlistedEvents(settled)).toEqual([])
    expect(aiBuildUnlistedEventsCheck(OPS)(settled)).toEqual([])
  })

  it('takes the layout the plan’s other pages render in over the site’s', () => {
    const settled = aiSettleBuildEventPage(plan([screen({ layout: 'new:Frame' })]), CONTEXT)
    expect(settled.screens[1]?.layout).toBe('new:Frame')
  })

  it('lists them on the page the plan makes about them: its section named for them, else its second', () => {
    const named = aiSettleBuildEventPage(
      plan([
        screen({
          title: "What's on",
          slug: '/whats-on',
          sections: [
            { name: 'Hero', uses: [], items: 0 },
            { name: 'Intro', uses: [], items: 0 },
            { name: 'Upcoming shows', uses: [], items: 0 },
          ],
        }),
      ]),
      CONTEXT,
    )
    expect(named.screens).toHaveLength(1)
    expect(named.screens[0]?.sections[2]?.uses).toEqual(REFS)
    const second = aiSettleBuildEventPage(
      plan([screen({ title: 'Events', slug: '/events', sections: [{ name: 'Hero', uses: [], items: 0 }, { name: 'Intro', uses: [], items: 0 }] })]),
      CONTEXT,
    )
    expect(second.screens[0]?.sections[1]?.uses).toEqual(REFS)
  })

  it('places only the events no section names, and leaves a plan that lists them all as it came', () => {
    const partly = plan([screen({ title: 'Home', slug: '/', sections: [{ name: 'Hero', uses: [], items: 0 }, { name: 'Next up', uses: [REFS[0] as string], items: 0 }] })])
    const settled = aiSettleBuildEventPage(partly, { ...CONTEXT, siteSlugs: [] })
    expect(settled.screens[1]?.sections[0]?.uses).toEqual(REFS.slice(1))
    const listed = plan([screen({ title: 'Events', slug: '/events', sections: [{ name: 'Calendar', uses: REFS, items: 0 }] })])
    expect(aiSettleBuildEventPage(listed, CONTEXT)).toBe(listed)
  })

  it('settles nothing where there is no one answer: the site has an events page, the plan is at its page cap, or no events here', () => {
    const empty = plan([])
    expect(aiSettleBuildEventPage(empty, { ...CONTEXT, siteSlugs: ['/', 'events'] })).toBe(empty)
    const full = plan([screen({}), screen({ slug: '/contact', title: 'Contact' })])
    expect(aiSettleBuildEventPage(full, { ...CONTEXT, pageLimit: 2 })).toBe(full)
    expect(aiSettleBuildEventPage(empty, { ...CONTEXT, ops: new Map() })).toBe(empty)
    expect(aiSettleBuildEventPage(empty, { ...CONTEXT, ops: null })).toBe(empty)
  })

  it('re-asks a plan whose events are still listed nowhere, naming them, and only where events are an operation here', () => {
    const [violation] = aiBuildUnlistedEventsCheck(OPS)(plan([]))
    expect(violation).toMatchObject({ rule: null, code: 'plan-job-shape' })
    expect(violation?.message).toContain('new:Jazz — Oct 16, new:Jazz — Oct 23, new:Jazz — Oct 30 are listed on no page')
    expect(aiBuildUnlistedEventsCheck(null)(plan([]))).toEqual([])
    // Other operations keep their own rules.
    expect(aiBuildUnlistedEventsCheck(OPS)(plan([], [{ ...event('Consult'), op: 'booking-service' }]))).toEqual([])
  })
})
