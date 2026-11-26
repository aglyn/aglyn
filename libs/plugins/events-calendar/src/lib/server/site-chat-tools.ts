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
  registerPluginSiteChatTool,
  type SiteChatCard,
  type SiteChatToolAnswer,
  type SiteChatToolRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * The events calendar's tool for the AI chat on a site (AGL-4250): what is
 * on, from today or from a day the visitor names, read from the site's own
 * published events. A lookup only; nothing is booked from here.
 *
 * Registered by `registerEventsSiteChatTools`, called from the plugin's
 * published-site registrar, whose module already reads the Admin SDK.
 */

export const EVENTS_UPCOMING_TOOL = 'events_upcoming'
const EVENTS_SCAN = 50
const EVENTS_SHOWN = 8
const DAY = /^\d{4}-\d{2}-\d{2}$/

interface StoredEvent {
  title: string
  startsAtMs: number
  endsAtMs: number
  location: string | null
  description: string | null
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The events of a site from `fromMs`, soonest first, through `toMs`. */
export function upcomingEventsAnswer(
  events: readonly StoredEvent[],
  input: { fromMs: number; toMs: number | null; query: string; timeZone?: string },
): SiteChatToolAnswer {
  const words = input.query.toLowerCase().split(/\s+/).filter((word) => word.length > 2)
  const matching = events.filter(
    (event) =>
      event.startsAtMs >= input.fromMs &&
      (input.toMs === null || event.startsAtMs <= input.toMs) &&
      (!words.length ||
        words.some((word) => `${event.title} ${event.description ?? ''} ${event.location ?? ''}`.toLowerCase().includes(word))),
  )
  if (!matching.length) return { text: 'No published events on this site match that.' }
  const when = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    })
  const shown = matching.slice(0, EVENTS_SHOWN)
  const cards: SiteChatCard[] = shown.map((event) => ({
    kind: 'event',
    title: event.title,
    caption: [when(event.startsAtMs), event.location].filter(Boolean).join(' · '),
  }))
  return {
    text: shown
      .map(
        (event) =>
          `- ${event.title}: ${when(event.startsAtMs)}${event.endsAtMs > event.startsAtMs ? ` to ${when(event.endsAtMs)}` : ''}${
            event.location ? `, ${event.location}` : ''
          }${event.description ? `. ${event.description.slice(0, 200)}` : ''}`,
      )
      .join('\n'),
    cards,
  }
}

async function runUpcoming(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
  const nowMs = Date.now()
  const from = str(request.input['from'])
  const to = str(request.input['to'])
  const fromMs = Math.max(nowMs, DAY.test(from) ? Date.parse(`${from}T00:00:00Z`) : nowMs)
  const toMs = DAY.test(to) ? Date.parse(`${to}T23:59:59Z`) : null
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(request.hostId)
    .collection('events')
    .where('status', '==', 'published')
    .where('startsAtMs', '>=', fromMs)
    .orderBy('startsAtMs', 'asc')
    .limit(EVENTS_SCAN)
    .get()
  const events = snapshot.docs
    .filter((doc) => !doc.get('deletedAt'))
    .map((doc) => ({
      title: str(doc.get('title')),
      startsAtMs: Number(doc.get('startsAtMs') ?? 0),
      endsAtMs: Number(doc.get('endsAtMs') ?? 0),
      location: str(doc.get('location')) || null,
      description: str(doc.get('description')) || null,
    }))
  return upcomingEventsAnswer(events, { fromMs, toMs, query: str(request.input['query']), timeZone: request.timeZone })
}

export function registerEventsSiteChatTools(): void {
  registerPluginSiteChatTool(
    {
      name: EVENTS_UPCOMING_TOOL,
      kind: 'lookup',
      capability: 'answer',
      description:
        "The site's upcoming published events, soonest first: from a day (default today) to a day (default open), optionally narrowed by a few words. Use it for \"what's on this weekend\" or \"when is the next race\".",
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'First day, YYYY-MM-DD; empty for today.' },
          to: { type: 'string', description: 'Last day, YYYY-MM-DD; empty for no end.' },
          query: { type: 'string', description: 'A few words the event is about; empty for every event.' },
        },
        required: ['from', 'to', 'query'],
        additionalProperties: false,
      },
      run: runUpcoming,
    },
    { pluginId: 'events-calendar' },
  )
}
