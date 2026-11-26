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

import type { PluginConfigSchema } from '@aglyn/aglyn'

/** Where the site's Calendar element is, when the owner has not said. */
export const EVENTS_CALENDAR_PATH_DEFAULT = '/events'

/**
 * Events Calendar settings (AGL-4252). PURE DATA (type-only aglyn import),
 * registered from the console half and the server half alike.
 *
 * Two pages a link to an event needs and nothing else records: the page
 * holding the Calendar element (site search and the feed link there, and the
 * Calendar opens the event named in `?event=`), and, when the owner built
 * one, the page holding the Event details element.
 */
export const EVENTS_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: 'events-calendar',
  fields: [
    {
      key: 'calendarPath',
      label: 'Calendar page path',
      type: 'string',
      description:
        'The page on your site that holds the Calendar element, e.g. /events. ' +
        'Site search results for an event open this page on that event.',
    },
    {
      key: 'eventPagePath',
      label: 'Event details page path',
      type: 'string',
      description:
        'The page that holds the Event details element, e.g. /event. Leave it ' +
        'empty to open each event in a window over the calendar.',
    },
  ],
  defaults: { calendarPath: EVENTS_CALENDAR_PATH_DEFAULT, eventPagePath: '' },
}

/** `/book`, `book/`, ` /book?x ` → `/book`; empty → `fallback`. */
export function normalizeEventsPath(raw: unknown, fallback: string): string {
  const text = String(raw ?? '')
    .trim()
    .split(/[?#]/)[0]
  if (!text) return fallback
  const leading = text.startsWith('/') ? text : `/${text}`
  if (leading.startsWith('//')) return fallback
  return leading.replace(/\/+$/, '') || '/'
}

/**
 * Where one event's date opens on the site: the Event details page when the
 * owner has one, else the Calendar page with the event named.
 */
export function eventHref(
  config: { calendarPath?: unknown; eventPagePath?: unknown },
  eventId: string,
  dayKey?: string,
): string {
  const detail = normalizeEventsPath(config.eventPagePath, '')
  const path =
    detail ||
    normalizeEventsPath(config.calendarPath, EVENTS_CALENDAR_PATH_DEFAULT)
  const query = new URLSearchParams({
    event: eventId,
    ...(dayKey ? { on: dayKey } : {}),
  })
  return `${path}?${query.toString()}`
}
