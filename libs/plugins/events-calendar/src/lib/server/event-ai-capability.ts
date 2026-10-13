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
  registerPluginAiCapability,
  type PluginAiCapability,
  type PluginAiCapabilityArgs,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { BUNDLE_ID } from '../constants/bundle-common'
import { EVENT_DRAFT_RESOURCE } from '../model/event-draft-content'
import {
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_ORGANIZER_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
} from '../model/event-write'

/**
 * WHAT AN AI BUILD CAN MAKE IN EVENTS (AGL-3743): a dated event, published
 * when the member may publish (AGL-3755), and the Event List block that
 * shows the site's events on a page.
 *
 * The capability the AI plugin's build planner offers for "add our fall
 * workshops" or "an events page". Its item is written by this plugin's
 * `event` draft writer, so every rule is the writer's: the `eventCalendar`
 * add-on, the member's role, a start after the write, and the shape
 * `eventWrite` stores. One item is one event; a page section that uses any
 * of them places the Event List block, which lists the site's published
 * events, so the events show there at once. A member who may write but not
 * publish gets drafts, and the job row says so (`live` with the writer's
 * `live: false`).
 *
 * The arguments are flat, as the contract requires, and are the event's own
 * fields: an event has no recurrence, tickets, RSVP or meeting link, so none
 * is offered. The planner fills them in, so no model runs
 * (`estimateCredits` 0).
 */

/** The operation's name in a build plan. */
export const EVENT_AI_OP = 'event'

/**
 * The Event List's component id, as the page palette names the block. Spelled
 * here rather than imported: the component module brings React and MUI, and
 * the console server's boot registers this capability.
 */
export const EVENT_AI_PAGE_BLOCK = 'eventList'

/** How many events one build may draft. */
export const EVENT_AI_MAX_PER_PLAN = 6

const WALL_TIME = 'local date and time "YYYY-MM-DDTHH:MM", in timezone'

/** The writer's content for an item: the arguments, which are the content's own keys. Pure. */
export function eventDraftContentFromArgs(args: PluginAiCapabilityArgs): Readonly<Record<string, unknown>> {
  const keys = ['title', 'startsAt', 'endsAt', 'timezone', 'location', 'organizer', 'description']
  return Object.fromEntries(
    keys
      .filter((key) => typeof args[key] === 'string' && (args[key] as string).trim())
      .map((key) => [key, (args[key] as string).trim()]),
  )
}

export const eventAiCapability: PluginAiCapability = {
  op: EVENT_AI_OP,
  noun: 'event',
  where: 'Events',
  intents: [
    'dated events on the site’s events calendar — classes, workshops, tastings, shows, open houses, meetups — each with its time, place and description, published to the site’s Event List; use this rather than a dataset for anything held on a date',
    'an events page or section that lists the site’s upcoming events',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'What the event is called, specific to this business, e.g. "Autumn sourdough workshop" — never a placeholder such as "Event 1" or "Sample event".',
        maxLength: EVENT_TITLE_MAX_LENGTH,
      },
      startsAt: {
        type: 'string',
        description:
          `When it starts, as ${WALL_TIME}. After today's date, within the next few months, on a day and at an hour this business would hold it; a date the request gives, as given.`,
        maxLength: 16,
      },
      endsAt: {
        type: 'string',
        description: `When it ends, as ${WALL_TIME}, after the start; leave it out for a one-hour event.`,
        maxLength: 16,
      },
      timezone: {
        type: 'string',
        description: 'The IANA time zone the business is in, e.g. "America/Chicago".',
        maxLength: 64,
      },
      location: {
        type: 'string',
        description:
          'Where it happens, as a visitor reads it: the venue or address the request gives, or the business’s own place; "Online" for an online event. Leave it out rather than invent an address.',
        maxLength: EVENT_LOCATION_MAX_LENGTH,
      },
      organizer: {
        type: 'string',
        description: 'Who hosts it: the business’s name, or a host the request names. Never a person’s name the request does not give.',
        maxLength: EVENT_ORGANIZER_MAX_LENGTH,
      },
      description: {
        type: 'string',
        description:
          'Two to four sentences a visitor reads: what happens, who it is for and what to bring or expect, in the business’s voice. No price, ticket, sign-up or link the request does not state, and no lorem ipsum.',
        maxLength: EVENT_DESCRIPTION_MAX_LENGTH,
      },
    },
    required: ['title', 'startsAt', 'timezone', 'description'],
    additionalProperties: false,
  },
  maxPerPlan: EVENT_AI_MAX_PER_PLAN,
  // The add-on is the gate, on every plan alike; a draft costs no credits.
  freeAllowed: true,
  feature: 'eventCalendar',
  draftResource: EVENT_DRAFT_RESOURCE,
  // Published as the Events page publishes, for the publishing role (AGL-3755).
  live: true,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  degrade: 'omit',
  // A page that shows the events places the Event List block.
  pageBlocks: [EVENT_AI_PAGE_BLOCK],
  draftContent: (item) => eventDraftContentFromArgs(item.args),
}

/**
 * Registers the capability; the console-server declarations call it beside
 * the writer, since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerEventAiCapability(): void {
  registerPluginAiCapability(eventAiCapability, { pluginId: BUNDLE_ID })
}
