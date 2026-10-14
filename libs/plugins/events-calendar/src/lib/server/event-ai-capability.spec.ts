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
 * The `event` AI capability (AGL-3743): it registers under its op, points at
 * this plugin's writer, places the Event List, and its arguments — as the
 * planner fills them and the contract checks them — become content the
 * writer accepts. Nothing the event cannot store is offered.
 */

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { ID as EVENT_LIST_ID } from '../components/event-list'
import { checkEventDraftContent, EVENT_DRAFT_RESOURCE } from '../model/event-draft-content'
import {
  EVENT_AI_MAX_PER_PLAN,
  EVENT_AI_OP,
  EVENT_AI_PAGE_BLOCK,
  eventAiCapability,
  registerEventAiCapability,
} from './event-ai-capability'

/** What a planner writes for a bakery's workshop. */
const ARGS = {
  title: 'Autumn sourdough workshop',
  startsAt: '2026-11-14T10:00',
  endsAt: '2026-11-14T13:00',
  timezone: 'America/Chicago',
  location: 'Hearth & Crumb Bakery, 412 Elm St, Austin',
  organizer: 'Hearth & Crumb Bakery',
  description: 'Mix, shape and bake a country loaf with our head baker. You take home your loaf and a jar of starter.',
}

const contentOf = (args: Record<string, unknown>) =>
  eventAiCapability.draftContent?.({ name: 'Workshop', args: args as never }, { hostId: 'host-1', dependencies: {} })

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the event capability', () => {
  it('is well-formed, and registers under its op owned by events-calendar, written by its writer', () => {
    expect(pluginAiCapabilityProblem(eventAiCapability)).toBeNull()
    registerEventAiCapability()
    registerEventAiCapability()
    expect(pluginAiCapability(EVENT_AI_OP)).toEqual({ pluginId: 'events-calendar', capability: eventAiCapability })
    expect(eventAiCapability).toMatchObject({
      op: 'event',
      draftResource: EVENT_DRAFT_RESOURCE,
      feature: 'eventCalendar',
      // The add-on is the gate on every plan; a draft spends no credits.
      freeAllowed: true,
      maxPerPlan: EVENT_AI_MAX_PER_PLAN,
      degrade: 'omit',
      pageBlocks: ['eventList'],
      // Published as the Events page publishes (AGL-3755).
      live: true,
      where: 'Events',
    })
    expect(eventAiCapability.quota).toBeUndefined()
    expect(eventAiCapability.estimateCredits(ARGS)).toBe(0)
  })

  it('places the Event List by the id the page palette knows it by', () => {
    expect(EVENT_AI_PAGE_BLOCK).toBe(EVENT_LIST_ID)
  })

  it('turns arguments the schema admits into content the writer accepts', () => {
    expect(pluginAiCapabilityArgsProblems(eventAiCapability.argsSchema, ARGS)).toEqual([])
    const content = contentOf(ARGS)
    expect(content).toEqual(ARGS)
    expect(checkEventDraftContent(content ?? {})).toMatchObject({
      ok: true,
      facts: { status: 'draft', startsAt: '2026-11-14 10:00', timezone: 'America/Chicago' },
    })
  })

  it('leaves blank arguments out, so the writer stores no empty field', () => {
    expect(contentOf({ ...ARGS, endsAt: ' ', location: '' })).toEqual({
      title: ARGS.title,
      startsAt: ARGS.startsAt,
      timezone: ARGS.timezone,
      organizer: ARGS.organizer,
      description: ARGS.description,
    })
  })

  it('offers only what an event stores: no recurrence, tickets, RSVP, link or status', () => {
    expect(Object.keys(eventAiCapability.argsSchema.properties).sort()).toEqual(
      ['description', 'endsAt', 'location', 'organizer', 'startsAt', 'timezone', 'title'],
    )
    for (const extra of ['recurrence', 'ticketUrl', 'rsvp', 'status']) {
      expect(pluginAiCapabilityArgsProblems(eventAiCapability.argsSchema, { ...ARGS, [extra]: 'x' })).toEqual([
        `"${extra}" is not an argument`,
      ])
    }
  })

  it('needs a title, a start, a zone and a description, and holds them to the event’s bounds', () => {
    expect(pluginAiCapabilityArgsProblems(eventAiCapability.argsSchema, { title: 'x' })).toEqual([
      '"startsAt" is required',
      '"timezone" is required',
      '"description" is required',
    ])
    expect(pluginAiCapabilityArgsProblems(eventAiCapability.argsSchema, { ...ARGS, title: 'x'.repeat(151) })).toEqual([
      '"title" must be at most 150 characters',
    ])
  })

  it('tells the planner to write events for this business, dated after today, with nothing it was not given', () => {
    const { title, startsAt, description, organizer } = eventAiCapability.argsSchema.properties
    expect(title.description).toContain('never a placeholder')
    expect(startsAt.description).toContain("After today's date")
    expect(description.description).toContain('No price, ticket, sign-up or link the request does not state')
    expect(organizer.description).toContain('Never a person’s name the request does not give')
  })
})
