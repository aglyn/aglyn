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
import { BOOKING_FIELD_ASKS } from '../model/booking-contact-fields'
import { BOOKING_PRICE_DISPLAYS } from '../model/booking-price'
import { BOOKING_MAX_DURATION_MINUTES, BOOKING_MIN_DURATION_MINUTES } from '../model/bookings'
import {
  BOOKING_SERVICE_DESCRIPTION_MAX,
  BOOKING_SERVICE_DRAFT_RESOURCE,
  BOOKING_SERVICE_NAME_MAX,
  BOOKING_SERVICE_PRICE_MAX_USD,
} from './booking-service-drafts'

/**
 * WHAT AN AI BUILD CAN MAKE IN BOOKINGS (AGL-3616): a bookable service, as a
 * draft.
 *
 * The capability the AI plugin's build planner offers for "a way to book
 * me". Its item is written by this plugin's `booking-service` draft writer,
 * so every rule is the writer's: the plan's `bookings` feature and service
 * allowance, the member's role, the shape a service takes. The service is
 * born a draft and takes no bookings until a person activates it on the
 * Bookings page.
 *
 * The arguments are flat, as the contract requires: one set of opening hours
 * on the weekdays named, which `draftContent` turns into the weekly windows
 * the service stores. A page that places the Booking block depends on the
 * service; when the service cannot be made, the page is built without the
 * block (`degrade: 'omit'`).
 */

/** The operation's name in a build plan. */
export const BOOKING_SERVICE_AI_OP = 'booking-service'

/** Weekday names as the planner writes them, in the model's order (0 = Sunday). */
export const BOOKING_SERVICE_AI_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** "09:30" → 570; anything else → `null`. */
function minutesOf(value: unknown): number | null {
  const match = typeof value === 'string' ? value.trim().match(/^(\d{1,2}):(\d{2})$/) : null
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null
  return hours * 60 + minutes
}

/**
 * The writer's content for an item. Hours that cannot be read are handed on
 * as a window the writer refuses, so the item fails with the writer's own
 * sentence rather than being stored with hours nobody asked for.
 */
export function bookingServiceDraftContentFromArgs(
  args: PluginAiCapabilityArgs,
): Readonly<Record<string, unknown>> {
  const opens = minutesOf(args['opensAt'])
  const closes = minutesOf(args['closesAt'])
  const window = opens === null || closes === null ? { start: -1, end: -1 } : { start: opens, end: closes }
  const days = Array.isArray(args['days']) ? (args['days'] as readonly string[]) : []
  const windows: Record<number, Array<{ start: number; end: number }>> = {}
  for (const day of days) {
    const weekday = (BOOKING_SERVICE_AI_DAYS as readonly string[]).indexOf(day)
    if (weekday >= 0) windows[weekday] = [window]
  }
  const copied = ['name', 'durationMinutes', 'description', 'timezone', 'priceDisplay', 'priceUsd', 'askPhone', 'askAddress']
  return {
    ...Object.fromEntries(copied.filter((key) => args[key] !== undefined).map((key) => [key, args[key]])),
    windows,
  }
}

export const bookingServiceAiCapability: PluginAiCapability = {
  op: BOOKING_SERVICE_AI_OP,
  noun: 'booking service',
  where: 'Bookings → Services',
  intents: [
    'a service visitors can book online, with its length, weekly hours and price — set up as a draft to activate',
    'a way for visitors to book an appointment, consultation or estimate visit',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'What the service is called on the booking widget, e.g. "Free estimate visit".',
        maxLength: BOOKING_SERVICE_NAME_MAX,
      },
      durationMinutes: {
        type: 'integer',
        description: 'How long one booking takes, in minutes.',
        minimum: BOOKING_MIN_DURATION_MINUTES,
        maximum: BOOKING_MAX_DURATION_MINUTES,
      },
      description: {
        type: 'string',
        description: 'One or two sentences on what the visitor is booking.',
        maxLength: BOOKING_SERVICE_DESCRIPTION_MAX,
      },
      days: {
        type: 'array',
        description: 'The weekdays it can be booked on.',
        items: { type: 'string', enum: BOOKING_SERVICE_AI_DAYS },
        maxItems: 7,
      },
      opensAt: {
        type: 'string',
        description: 'When bookable hours start on those days, 24-hour "HH:MM", e.g. "09:00".',
        maxLength: 5,
      },
      closesAt: {
        type: 'string',
        description: 'When bookable hours end on those days, 24-hour "HH:MM", e.g. "17:00".',
        maxLength: 5,
      },
      timezone: {
        type: 'string',
        description: 'The IANA time zone the hours are in, e.g. "America/Chicago".',
        maxLength: 64,
      },
      priceDisplay: {
        type: 'string',
        description:
          'How the price is stated: "fixed" charges priceUsd when booked; "varies", "estimate" ' +
          '(a free estimate) and "contact" show a label and book with no charge. Use "fixed" only ' +
          'when the request states the price; otherwise "contact" unless it says otherwise.',
        enum: BOOKING_PRICE_DISPLAYS,
      },
      priceUsd: {
        type: 'integer',
        description: 'The price in whole dollars, only with priceDisplay "fixed" and only when the request states it.',
        minimum: 0,
        maximum: BOOKING_SERVICE_PRICE_MAX_USD,
      },
      askPhone: {
        type: 'string',
        description: 'Whether the booking form asks for a phone number.',
        enum: BOOKING_FIELD_ASKS,
      },
      askAddress: {
        type: 'string',
        description: 'Whether the booking form asks for the address the job is at, for work done on site.',
        enum: BOOKING_FIELD_ASKS,
      },
    },
    required: ['name', 'durationMinutes', 'days', 'opensAt', 'closesAt', 'timezone'],
    additionalProperties: false,
  },
  maxPerPlan: 5,
  // Free includes no services (`servicesPerHost: 0`) and no bookings.
  freeAllowed: false,
  feature: 'bookings',
  quota: 'servicesPerHost',
  draftResource: BOOKING_SERVICE_DRAFT_RESOURCE,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  degrade: 'omit',
  // A page that books this service places the Booking block.
  pageBlocks: ['booking'],
  draftContent: (item) => bookingServiceDraftContentFromArgs(item.args),
}

/**
 * Registers the capability; the console surface calls it beside the writer,
 * since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerBookingServiceAiCapability(): void {
  registerPluginAiCapability(bookingServiceAiCapability, { pluginId: BUNDLE_ID })
}
