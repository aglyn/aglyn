/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
 *
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
 * The `booking-service` AI capability (AGL-3616): it registers under its op,
 * points at this plugin's writer, and its arguments — as the planner fills
 * them and the contract checks them — become content the writer accepts.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  BOOKING_SERVICE_AI_OP,
  bookingServiceAiCapability,
  registerBookingServiceAiCapability,
} from './booking-service-ai-capability'
import { BOOKING_SERVICE_DRAFT_RESOURCE, checkBookingServiceContent } from './booking-service-drafts'

const ARGS = {
  name: 'Free estimate visit',
  durationMinutes: 60,
  days: ['mon', 'wed', 'fri'],
  opensAt: '09:00',
  closesAt: '17:30',
  timezone: 'America/Chicago',
  priceDisplay: 'estimate',
  askAddress: 'required',
}

const contentOf = (args: Record<string, unknown>) =>
  bookingServiceAiCapability.draftContent?.({ name: 'visit', args: args as never }, { hostId: 'host-1', dependencies: {} })

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the booking-service capability', () => {
  it('is well-formed, and registers under its op owned by bookings, written by its writer', () => {
    expect(pluginAiCapabilityProblem(bookingServiceAiCapability)).toBeNull()
    registerBookingServiceAiCapability()
    registerBookingServiceAiCapability()
    expect(pluginAiCapability(BOOKING_SERVICE_AI_OP)).toEqual({
      pluginId: 'bookings',
      capability: bookingServiceAiCapability,
    })
    expect(bookingServiceAiCapability).toMatchObject({
      draftResource: BOOKING_SERVICE_DRAFT_RESOURCE,
      feature: 'bookings',
      quota: 'servicesPerHost',
      freeAllowed: false,
      degrade: 'omit',
      pageBlocks: ['booking'],
    })
    expect(bookingServiceAiCapability.estimateCredits(ARGS as never)).toBe(0)
  })

  it('turns arguments the schema admits into content the writer accepts', () => {
    expect(pluginAiCapabilityArgsProblems(bookingServiceAiCapability.argsSchema, ARGS)).toEqual([])
    const content = contentOf(ARGS)
    expect(content).toEqual({
      name: 'Free estimate visit',
      durationMinutes: 60,
      timezone: 'America/Chicago',
      priceDisplay: 'estimate',
      askAddress: 'required',
      windows: { 1: [{ start: 540, end: 1050 }], 3: [{ start: 540, end: 1050 }], 5: [{ start: 540, end: 1050 }] },
    })
    expect(checkBookingServiceContent(content ?? {})).toMatchObject({
      ok: true,
      facts: { status: 'draft', openWeekdays: [1, 3, 5], priceText: 'Free estimate' },
    })
  })

  it('hands on hours it cannot read as a window the writer refuses, never as hours nobody asked for', () => {
    const check = checkBookingServiceContent(contentOf({ ...ARGS, opensAt: '9am' }) ?? {})
    expect(check.ok).toBe(false)
  })

  it('holds the planner to the writer’s bounds', () => {
    expect(pluginAiCapabilityArgsProblems(bookingServiceAiCapability.argsSchema, { ...ARGS, durationMinutes: 600 })).toEqual([
      '"durationMinutes" must be at most 480',
    ])
    expect(pluginAiCapabilityArgsProblems(bookingServiceAiCapability.argsSchema, { ...ARGS, days: ['someday'] })).toHaveLength(1)
    expect(pluginAiCapabilityArgsProblems(bookingServiceAiCapability.argsSchema, { ...ARGS, windows: {} })).toEqual([
      '"windows" is not an argument',
    ])
  })
})
