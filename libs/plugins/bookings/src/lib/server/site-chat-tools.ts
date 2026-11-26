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

import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/app-utils/api-plugins'
import { buildSectionIndex, rankSections } from '@aglyn/aglyn/app-utils/section-retrieval'
import {
  registerPluginSiteChatTool,
  type SiteChatProposalField,
  type SiteChatToolAnswer,
  type SiteChatToolRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'

/**
 * Bookings' tools for the AI chat on a site (AGL-4250): a service's open
 * times, and a card to book one of them. The times come from the booking
 * widget's own slot door, run in-process, so the chat offers exactly the
 * times the widget would; the card posts to the booking door from the
 * visitor's browser, so a booking (free or paid) is only ever the visitor's
 * own press, held to every rule that door applies.
 *
 * The slot handler is handed in by `registerBookingsSiteChatTools`, so this
 * module imports nothing heavy and the handler module loads with the tenant's
 * own API registrar, as it always has.
 */

interface SlotsService {
  $id: string
  name: string
  durationMinutes: number
  priceUsd: number
  priceDisplay?: string | null
  description?: string
  askPhone?: boolean
  askAddress?: boolean
}

interface Slot {
  startsAtMs: number
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const DAY = /^\d{4}-\d{2}-\d{2}$/
const SLOTS_SHOWN = 12

async function answerOf(handler: PluginApiHandler, query: Record<string, string>): Promise<{ status: number; body: any }> {
  let status = 200
  let body: unknown = null
  const res = {
    status(code: number) {
      status = code
      return res
    },
    json(value: unknown) {
      body = value
    },
    send(value: unknown) {
      body = value
    },
    setHeader: () => undefined,
    redirect: () => undefined,
    end: () => undefined,
  }
  const req: PluginApiRequest = { method: 'GET', query, body: undefined, headers: {}, cookies: {} } as never
  await handler(req, res as never)
  return { status, body }
}

const priceLine = (service: SlotsService): string =>
  service.priceDisplay ? String(service.priceDisplay) : service.priceUsd > 0 ? `$${service.priceUsd}` : 'free'

function timeLabel(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

async function findService(slots: PluginApiHandler, hostId: string, name: string): Promise<SlotsService | null> {
  const { status, body } = await answerOf(slots, { hostId })
  if (status !== 200) return null
  const services = (body?.services ?? []) as SlotsService[]
  if (!services.length) return null
  if (!name) return services.length === 1 ? services[0] : null
  const exact = services.find((service) => service.name.toLowerCase() === name.toLowerCase())
  if (exact) return exact
  return (
    rankSections(
      buildSectionIndex(
        services.map((service) => ({ title: service.name, heading: '', text: service.description ?? '', service })),
      ),
      name,
      { limit: 1 },
    )[0]?.section.service ?? null
  )
}

async function openSlots(
  slots: PluginApiHandler,
  hostId: string,
  service: SlotsService,
  fromMs: number,
): Promise<{ slots: Slot[]; timeZone: string }> {
  const { status, body } = await answerOf(slots, { hostId, serviceId: service.$id, from: String(fromMs) })
  if (status !== 200) return { slots: [], timeZone: 'UTC' }
  return { slots: (body?.slots ?? []) as Slot[], timeZone: str(body?.service?.timezone) || 'UTC' }
}

export function createBookingsSiteChatRunners(slots: PluginApiHandler) {
  async function listServices(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
    const { status, body } = await answerOf(slots, { hostId: request.hostId })
    const services = status === 200 ? ((body?.services ?? []) as SlotsService[]) : []
    if (!services.length) return { text: 'This site takes no bookings online.' }
    return {
      text: services
        .map((service) => `- ${service.name}: ${service.durationMinutes} minutes, ${priceLine(service)}${service.description ? `. ${service.description.slice(0, 160)}` : ''}`)
        .join('\n'),
      cards: services.slice(0, 6).map((service) => ({
        kind: 'service' as const,
        title: service.name,
        caption: `${service.durationMinutes} min · ${priceLine(service)}`,
      })),
    }
  }

  async function openTimes(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
    const service = await findService(slots, request.hostId, str(request.input['service']))
    if (!service) return { text: 'Ask which service the visitor means; it did not match one this site offers.' }
    const day = str(request.input['day'])
    const fromMs = DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : Date.now()
    const found = await openSlots(slots, request.hostId, service, fromMs)
    if (!found.slots.length) return { text: `${service.name} has no open times from then.` }
    return {
      text: [
        `${service.name} (${service.durationMinutes} minutes, ${priceLine(service)}), open times (start times, ${found.timeZone}):`,
        ...found.slots.slice(0, SLOTS_SHOWN).map((slot) => `- ${timeLabel(slot.startsAtMs, found.timeZone)} [startsAt ${new Date(slot.startsAtMs).toISOString()}]`),
      ].join('\n'),
    }
  }

  async function proposeBooking(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
    const service = await findService(slots, request.hostId, str(request.input['service']))
    if (!service) return { text: 'Ask which service the visitor means; it did not match one this site offers.' }
    const startsAtMs = Date.parse(str(request.input['startsAt']))
    if (!Number.isFinite(startsAtMs)) return { text: 'Ask the visitor which open time they want.' }
    const found = await openSlots(slots, request.hostId, service, startsAtMs - 60_000)
    if (!found.slots.some((slot) => slot.startsAtMs === startsAtMs)) {
      return { text: 'That time is not open; offer the open times instead.' }
    }
    const fields: SiteChatProposalField[] = [
      { name: 'name', label: 'Your name', type: 'text', required: true },
      { name: 'email', label: 'Your email', type: 'email', required: true },
      ...(service.askPhone ? [{ name: 'phone', label: 'Phone', type: 'tel' as const, required: true }] : []),
    ]
    if (service.askAddress) {
      return { text: `${service.name} asks for an address; send the visitor to the booking page to book it.` }
    }
    const when = timeLabel(startsAtMs, found.timeZone)
    return {
      text: `Offered the visitor a card to book ${service.name} at ${when}.`,
      proposal: {
        kind: 'book',
        title: `Book ${service.name}?`,
        summary: `${when}, ${service.durationMinutes} minutes, ${priceLine(service)}.${service.priceUsd > 0 ? ' You pay at checkout.' : ''}`,
        confirmLabel: service.priceUsd > 0 ? 'Book and pay' : 'Book',
        fields,
        card: { kind: 'slot', title: service.name, caption: when },
        request: {
          path: 'bookings/book',
          body: { hostId: request.hostId, serviceId: service.$id, startsAtMs },
        },
      },
    }
  }

  return { listServices, openTimes, proposeBooking }
}

export function registerBookingsSiteChatTools(slots: PluginApiHandler): void {
  const runners = createBookingsSiteChatRunners(slots)
  registerPluginSiteChatTool(
    {
      name: 'bookings_services',
      kind: 'lookup',
      capability: 'answer',
      description: 'The services this site takes bookings for: lessons, rentals, appointments, with length and price.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: runners.listServices,
    },
    { pluginId: 'bookings' },
  )
  registerPluginSiteChatTool(
    {
      name: 'bookings_open_times',
      kind: 'lookup',
      capability: 'answer',
      description:
        "A service's open booking times from a day (default today). Use it whenever a visitor asks when they can book or come.",
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: "The service's name." },
          day: { type: 'string', description: 'First day to look from, YYYY-MM-DD; empty for today.' },
        },
        required: ['service', 'day'],
        additionalProperties: false,
      },
      run: runners.openTimes,
    },
    { pluginId: 'bookings' },
  )
  registerPluginSiteChatTool(
    {
      name: 'bookings_propose_booking',
      kind: 'proposal',
      capability: 'book',
      endpoints: ['bookings/book'],
      description:
        'Offer the visitor a card to book one open time of a service, after bookings_open_times showed it open and the visitor chose it. The visitor enters their name and email on the card; nothing is booked before they press it.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: "The service's name." },
          startsAt: { type: 'string', description: 'The chosen start time, exactly as bookings_open_times gave it (ISO).' },
        },
        required: ['service', 'startsAt'],
        additionalProperties: false,
      },
      run: runners.proposeBooking,
    },
    { pluginId: 'bookings' },
  )
}
